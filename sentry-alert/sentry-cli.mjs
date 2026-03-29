#!/usr/bin/env node

/**
 * sentry-cli.mjs — General-purpose Sentry CLI
 *
 * Mirrors the style of jira-creator/jira-cli.mjs.
 * Reads credentials from sentry-config.json in this directory.
 *
 * Usage:
 *   node sentry-cli.mjs <command> [options]
 *
 * Commands:
 *   projects                       List all projects in org
 *   issues   <project>             List unresolved issues for a project
 *   view     <issue-id>            View a single issue in detail
 *   events   <issue-id>            List events for an issue
 *   event    <issue-id>            Get latest event + full stack trace
 *   resolve  <issue-id>            Mark issue as resolved
 *   ignore   <issue-id>            Mark issue as ignored
 *   unresolve <issue-id>           Mark issue as unresolved
 *   comment  <issue-id> "text"     Add a comment to an issue
 *   search   <project> --query "…" Search issues (Sentry search syntax)
 *   jira     <issue-id>            Create a Jira ticket for a Sentry issue
 *   teams                          List all teams in org
 *   help     [command]             Show help
 */

import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  config, ORG_SLUG, DEFAULT_PROJECT,
  sentryGet, sentryGetList, sentryPost, sentryPut,
} from './lib/api.mjs';

import {
  formatIssue,
  formatIssueTable,
  formatProjectTable,
  formatEventTable,
  formatStackTrace,
  formatTeamTable,
} from './lib/format.mjs';

const __sentryCliDir = dirname(fileURLToPath(import.meta.url));
const JIRA_CLI_DIR = process.env.JIRA_CLI_DIR || resolve(__sentryCliDir, '..', 'jira-creator');

// ── Jira helpers ─────────────────────────────────────────────────────

/** Maps Sentry project slug → JCP Affected Systems field ID (customfield_10056) */
const AFFECTED_SYSTEMS_MAP = {
  blitzkrieg:  { id: '10262', name: 'Blitzkrieg' },
  convex:      { id: '10143', name: 'convex' },
  highbrow:    { id: '10291', name: 'Highbrow' },
  jetfire:     { id: '10083', name: 'jetfire' },
  skyfire:     { id: '11125', name: 'Skyfire' },
  scattershot: { id: '10315', name: 'Scattershot' },
};

/**
 * Fetch unreleased fix versions for a Jira project.
 * Reads credentials from jira-config.json inside JIRA_CLI_DIR.
 * Returns array of { id, name } sorted newest-first.
 */
async function fetchJiraFixVersions(project = 'JCP') {
  let jiraConfig;
  try {
    const raw = await readFile(resolve(JIRA_CLI_DIR, 'jira-config.json'), 'utf-8');
    jiraConfig = JSON.parse(raw);
  } catch {
    return [];
  }

  const { siteUrl, user: { email } = {}, apiToken } = jiraConfig;
  if (!siteUrl || !email || !apiToken) return [];

  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  try {
    const res = await fetch(
      `${siteUrl}/rest/api/3/project/${project}/versions?status=unreleased&orderBy=-sequence`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const versions = await res.json();
    return (Array.isArray(versions) ? versions : versions.values || [])
      .filter((v) => !v.released)
      .map((v) => ({ id: String(v.id), name: v.name }));
  } catch {
    return [];
  }
}

/**
 * Given the Sentry platform_version tag (e.g. "v1.10.6-RC228") and the list
 * of unreleased Jira fix versions, pick the best match.
 * Strategy: find version whose numeric part is the next minor/patch after the
 * platform version, or fall back to the first unreleased version.
 */
function pickFixVersion(platformVersion, versions) {
  if (!versions.length) return null;
  if (versions.length === 1) return versions[0];

  if (platformVersion) {
    const m = platformVersion.match(/v?(\d+)\.(\d+)\.(\d+)/i);
    if (m) {
      const [, maj, min, pat] = m.map(Number);
      // Look for next patch, then next minor
      const candidates = [
        `${maj}.${min}.${pat + 1}`,
        `${maj}.${min + 1}.0`,
        `${maj}.${min + 1}.${pat}`,
      ];
      for (const candidate of candidates) {
        const found = versions.find((v) => v.name.includes(candidate));
        if (found) return found;
      }
    }
  }

  return versions[0]; // newest unreleased
}

function buildJiraDescription(issue, event, serviceName) {
  const tag = (key) => event?.tags?.find((t) => t.key === key)?.value;
  const envTag        = tag('environment') || 'unknown';
  const releaseTag    = tag('release');
  const platformVer   = tag('platform_version');
  const sentryUrl     = issue.permalink || `https://sentry.io/issues/${issue.id}/`;

  const lines = [
    '## Sentry Error Alert',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| **Service** | ${serviceName} |`,
    `| **Sentry Project** | ${issue.project?.slug || 'unknown'} |`,
    `| **Environment** | ${envTag} |`,
    `| **Level** | ${issue.level || 'error'} |`,
    `| **First Seen** | ${issue.firstSeen ? issue.firstSeen.slice(0, 10) : 'unknown'} |`,
    `| **Last Seen** | ${issue.lastSeen ? issue.lastSeen.slice(0, 10) : 'unknown'} |`,
    `| **Times Seen** | ${issue.count || 'unknown'} |`,
    `| **Sentry URL** | [View in Sentry](${sentryUrl}) |`,
    '',
    '## Error Details',
    '',
    `**Title:** ${issue.title}`,
  ];

  if (issue.culprit)  lines.push(`**Culprit:** \`${issue.culprit}\``);
  if (releaseTag)     lines.push(`**Release:** ${releaseTag}`);
  if (platformVer)    lines.push(`**Platform Version:** ${platformVer}`);
  lines.push('');

  const stack = extractStackForJira(event);
  if (stack) lines.push('## Stack Trace', '', '```', stack, '```', '');

  lines.push(
    '## Resolution Notes',
    '',
    `> Investigate the stack trace above and fix the root cause.`,
    `> Once fixed, verify in **${envTag}** and link the fix commit here.`,
    '',
  );

  return lines.join('\n');
}

function extractStackForJira(event) {
  const exceptions = event?.exception?.values;
  if (!exceptions?.length) return null;

  const lines = [];
  for (const exc of exceptions.slice(-2)) {
    lines.push(`${exc.type}: ${exc.value}`);
    const frames = exc.stacktrace?.frames;
    if (frames?.length) {
      for (const f of frames.slice(-15).reverse()) {
        const loc = [f.module || f.filename, f.function, f.lineno].filter(Boolean).join(' › ');
        lines.push(`  at ${loc}`);
        if (f.context_line?.trim()) lines.push(`     ${f.context_line.trim()}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildStepsAdf(issue, event) {
  const tag = (key) => event?.tags?.find((t) => t.key === key)?.value;
  const envTag    = tag('environment') || 'production';
  const sentryUrl = issue.permalink || `https://sentry.io/issues/${issue.id}/`;

  const steps = [
    `Sentry automatically detected an unresolved error: "${issue.title}"`,
    `Culprit: ${issue.culprit || '(see stack trace in description)'}`,
    `Open the Sentry issue for full event context: ${sentryUrl}`,
    `Identify the failing code path from the stack trace in the description`,
    `Reproduce the error in the ${envTag} environment using the release/transaction context provided`,
  ];

  return JSON.stringify({
    type: 'doc',
    version: 1,
    content: [{
      type: 'orderedList',
      content: steps.map((text) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    }],
  });
}

function spawnCommand(cmd, args, cwd) {
  return new Promise((res) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(cmd, args, { cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.end();
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const cleaned = stderr.replace(/\(node.*?\) Warning:.*?\n/g, '').trim();
      if (cleaned) process.stderr.write(`[jira-cli:stderr] ${cleaned.substring(0, 400)}\n`);
      res({ success: code === 0, output: stdout, exitCode: code });
    });
    proc.on('error', (e) => res({ success: false, output: e.message, exitCode: null }));
  });
}

// ── Arg parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const boolFlags = ['json', 'resolved', 'all'];
      if (boolFlags.includes(name)) {
        flags[name] = true;
        i++;
        continue;
      }
      flags[name] = argv[++i];
      i++;
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { flags, positional };
}

// ── helpers ──────────────────────────────────────────────────────────

function resolveProject(positional, flags) {
  return positional[0] || flags.project || DEFAULT_PROJECT;
}

// ── Command handlers ─────────────────────────────────────────────────

async function handleProjects({ flags }) {
  const projects = await sentryGetList(`/organizations/${ORG_SLUG}/projects/`, { all_projects: 1 });

  if (flags.json) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  console.log(formatProjectTable(projects));
}

async function handleIssues({ flags, positional }) {
  const project = resolveProject(positional, flags);
  if (!project) {
    console.error('Usage: sentry-cli.mjs issues <project-slug> [options]');
    console.error('  --query "text"       Sentry search query (default: is:unresolved)');
    console.error('  --environment "prod" Filter by environment');
    console.error('  --limit N            Max results (default: 25)');
    console.error('  --all                Include resolved issues');
    console.error('  --json               Output raw JSON');
    process.exit(1);
  }

  const query = flags.query || (flags.all ? '' : 'is:unresolved');
  const limit = flags.limit || '25';

  const params = { query, limit, sort: 'date' };
  if (flags.environment) params.environment = flags.environment;

  const issues = await sentryGetList(
    `/projects/${ORG_SLUG}/${project}/issues/`,
    params
  );

  if (flags.json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  console.log(`Project: ${project}`);
  console.log('');
  console.log(formatIssueTable(issues));
}

async function handleView({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs view <issue-id>');
    process.exit(1);
  }

  const issue = await sentryGet(`/issues/${issueId}/`);

  // The issue endpoint returns tags without values (only key/name aggregates).
  // Fetch the latest event to get real {key, value} tag pairs.
  try {
    const latestEvent = await sentryGet(`/issues/${issueId}/events/latest/`);
    if (Array.isArray(latestEvent?.tags) && latestEvent.tags.length) {
      issue.tags = latestEvent.tags;
    }
  } catch {
    // Latest event unavailable — fall back to whatever tags the issue has
  }

  if (flags.json) {
    console.log(JSON.stringify(issue, null, 2));
    return;
  }

  console.log(formatIssue(issue));
}

async function handleEvents({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs events <issue-id> [--limit N] [--json]');
    process.exit(1);
  }

  const limit = flags.limit || '25';
  const list = await sentryGetList(`/issues/${issueId}/events/`, { limit });

  if (flags.json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  console.log(`Events for issue ${issueId}:`);
  console.log('');
  console.log(formatEventTable(list));
}

async function handleEvent({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs event <issue-id> [--json]');
    process.exit(1);
  }

  const event = await sentryGet(`/issues/${issueId}/events/latest/`);

  if (flags.json) {
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  console.log(`Latest event for issue ${issueId}:`);
  console.log('─'.repeat(70));
  console.log('');
  console.log(formatStackTrace(event));
}

async function handleResolve({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs resolve <issue-id>');
    process.exit(1);
  }

  await sentryPut(`/issues/${issueId}/`, { status: 'resolved' });
  console.log(`Resolved: ${issueId}`);
}

async function handleUnresolve({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs unresolve <issue-id>');
    process.exit(1);
  }

  await sentryPut(`/issues/${issueId}/`, { status: 'unresolved' });
  console.log(`Unresolved: ${issueId}`);
}

async function handleIgnore({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs ignore <issue-id>');
    process.exit(1);
  }

  await sentryPut(`/issues/${issueId}/`, { status: 'ignored' });
  console.log(`Ignored: ${issueId}`);
}

async function handleComment({ flags, positional }) {
  const issueId = positional[0];
  const text = positional[1] || flags.text;

  if (!issueId || !text) {
    console.error('Usage: sentry-cli.mjs comment <issue-id> "Comment text"');
    console.error('       sentry-cli.mjs comment <issue-id> --text "..."');
    process.exit(1);
  }

  const result = await sentryPost(`/issues/${issueId}/notes/`, { text });
  console.log(`Comment added (id: ${result?.id || '?'})`);
}

async function handleSearch({ flags, positional }) {
  const project = resolveProject(positional, flags);
  if (!project) {
    console.error('Usage: sentry-cli.mjs search <project-slug> --query "error text"');
    console.error('       sentry-cli.mjs search <project-slug> --query "is:unresolved level:fatal"');
    console.error('');
    console.error('Sentry search syntax examples:');
    console.error('  is:unresolved                  Unresolved issues');
    console.error('  is:unresolved level:fatal       Fatal errors only');
    console.error('  is:unresolved !has:assignee     Unassigned issues');
    console.error('  user.email:user@example.com     Issues affecting specific user');
    console.error('  release:1.2.3                   Issues in specific release');
    console.error('  transaction:/api/v1/users       Issues in specific transaction');
    process.exit(1);
  }

  const query = flags.query || 'is:unresolved';
  const limit = flags.limit || '25';
  const params = { query, limit, sort: 'date' };
  if (flags.environment) params.environment = flags.environment;

  const issues = await sentryGetList(`/projects/${ORG_SLUG}/${project}/issues/`, params);

  if (flags.json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  console.log(`Search: "${query}" in ${project}`);
  console.log('');
  console.log(formatIssueTable(issues));
}

async function handleTeams({ flags }) {
  const teams = await sentryGetList(`/organizations/${ORG_SLUG}/teams/`);

  if (flags.json) {
    console.log(JSON.stringify(teams, null, 2));
    return;
  }

  console.log(formatTeamTable(teams));
}

/**
 * Search Jira for an existing ticket tagged with sentry-<issueId>.
 * Returns the first matching issue object (with .key and .fields), or null.
 */
async function findExistingJiraTicket(sentryIssueId, project) {
  const jql = `labels = "sentry-${sentryIssueId}" AND project = ${project} ORDER BY created DESC`;
  const result = await spawnCommand(
    'node',
    ['jira-cli.mjs', 'search', '--jql', jql, '--json', '--max-results', '5'],
    JIRA_CLI_DIR
  );
  if (!result.success) return null;
  try {
    const data = JSON.parse(result.output.trim());
    const issues = Array.isArray(data) ? data : (data.issues || []);
    return issues.length ? issues[0] : null;
  } catch {
    return null;
  }
}

async function handleJira({ flags, positional }) {
  const issueId = positional[0];
  if (!issueId) {
    console.error('Usage: sentry-cli.mjs jira <issue-id> [--project JCP] [--type Bug]');
    console.error('       [--affected-system-id <id>] [--fix-version-id <id>] [--force-create]');
    process.exit(1);
  }

  const project   = flags.project || 'JCP';
  const issueType = flags.type    || 'Bug';
  const sentryLabel = `sentry-${issueId}`;

  console.log(`Fetching Sentry issue ${issueId}...`);
  const issue = await sentryGet(`/issues/${issueId}/`);

  let event = null;
  try {
    event = await sentryGet(`/issues/${issueId}/events/latest/`);
  } catch {
    // latest event unavailable
  }

  const serviceName     = issue.project?.slug || 'unknown';
  const platformVersion = event?.tags?.find((t) => t.key === 'platform_version')?.value;
  const summary         = `[Sentry][${serviceName}] ${issue.title}`.substring(0, 200);

  // ── Resolve Affected Systems ────────────────────────────────────────
  let affectedSystemId = flags['affected-system-id'];
  let affectedSystemName = affectedSystemId ? `(id: ${affectedSystemId})` : null;
  if (!affectedSystemId) {
    const mapped = AFFECTED_SYSTEMS_MAP[serviceName.toLowerCase()];
    if (mapped) {
      affectedSystemId   = mapped.id;
      affectedSystemName = mapped.name;
      console.log(`Affected System : ${mapped.name} (id: ${mapped.id}) [auto-detected from "${serviceName}"]`);
    } else {
      console.warn(`Warning: No Affected Systems mapping for "${serviceName}". Use --affected-system-id to set manually.`);
    }
  }

  // ── Resolve Fix Version ────────────────────────────────────────────
  let fixVersionId   = flags['fix-version-id'];
  let fixVersionName = fixVersionId ? `(id: ${fixVersionId})` : null;
  if (!fixVersionId) {
    console.log(`Fetching unreleased fix versions for ${project}...`);
    const versions = await fetchJiraFixVersions(project);
    const picked   = pickFixVersion(platformVersion, versions);
    if (picked) {
      fixVersionId   = picked.id;
      fixVersionName = picked.name;
      console.log(`Fix Version     : ${picked.name} (id: ${picked.id}) [${platformVersion ? `auto-selected for platform ${platformVersion}` : 'latest unreleased'}]`);
    } else {
      console.warn('Warning: Could not auto-detect fix version. Use --fix-version-id to set manually.');
    }
  }

  // ── Check for existing ticket (unless --force-create) ──────────────
  if (!flags['force-create']) {
    console.log(`\nSearching for existing Jira ticket (label: ${sentryLabel})...`);
    const existing = await findExistingJiraTicket(issueId, project);

    if (existing) {
      const ticketKey = existing.key;
      console.log(`Found existing ticket: ${ticketKey} — updating missing fields instead of creating a new one.`);

      const existingAffected = existing.fields?.customfield_10056;
      const existingFix      = existing.fields?.fixVersions;
      const hasAffected      = Array.isArray(existingAffected) && existingAffected.length > 0;
      const hasFix           = Array.isArray(existingFix) && existingFix.length > 0;

      const updateArgs = ['update', ticketKey];
      let changed = false;

      if (!hasAffected && affectedSystemId) {
        updateArgs.push('--field', `customfield_10056=[{"id":"${affectedSystemId}"}]`);
        console.log(`  + Affected System : ${affectedSystemName}`);
        changed = true;
      } else if (hasAffected) {
        console.log(`  ✓ Affected System already set`);
      }

      if (!hasFix && fixVersionId) {
        updateArgs.push('--field', `fixVersions=[{"id":"${fixVersionId}"}]`);
        console.log(`  + Fix Version     : ${fixVersionName}`);
        changed = true;
      } else if (hasFix) {
        console.log(`  ✓ Fix Version already set`);
      }

      if (changed) {
        const upd = await spawnCommand('node', ['jira-cli.mjs', ...updateArgs], JIRA_CLI_DIR);
        if (!upd.success) {
          console.error(`Update failed (exit ${upd.exitCode}):\n${upd.output}`);
          process.exit(1);
        }
        console.log(`\nUpdated: ${ticketKey}`);
      } else {
        console.log(`\nNo updates needed — ticket already has all required fields.`);
      }

      console.log(`URL: https://gofynd.atlassian.net/browse/${ticketKey}`);
      return;
    }

    console.log(`No existing ticket found — creating a new one.`);
  }

  // ── Create new ticket ──────────────────────────────────────────────
  const description = buildJiraDescription(issue, event, serviceName);
  const tmpFile = `${tmpdir()}/sentry-jira-${issueId}-${Date.now()}.md`;
  try {
    await writeFile(tmpFile, description, 'utf-8');

    const args = [
      'create',
      '--project',          project,
      '--type',             issueType,
      '--summary',          summary,
      '--description-file', tmpFile,
      '--labels',           'sentry-alert',
    ];

    if (project.toUpperCase() === 'JCP') {
      args.push('--jcp');
      args.push('--field', `customfield_10034=${buildStepsAdf(issue, event)}`);
    }
    if (affectedSystemId) args.push('--field', `customfield_10056=[{"id":"${affectedSystemId}"}]`);
    if (fixVersionId)     args.push('--field', `fixVersions=[{"id":"${fixVersionId}"}]`);

    console.log(`\nCreating ${project} ${issueType} ticket...`);
    const result = await spawnCommand('node', ['jira-cli.mjs', ...args], JIRA_CLI_DIR);

    if (!result.success) {
      console.error(`Ticket creation failed (exit ${result.exitCode}):\n${result.output}`);
      process.exit(1);
    }

    console.log(result.output.trim());

    const match = result.output.match(/Created:\s+([A-Z]+-\d+)/);
    if (match) {
      const ticketKey = match[1];

      // Tag with sentry-<issueId> so future runs find this ticket
      await spawnCommand('node', ['jira-cli.mjs', 'label', 'add', ticketKey, sentryLabel], JIRA_CLI_DIR);

      console.log(`\nJira ticket: ${ticketKey}`);
      console.log(`URL: https://gofynd.atlassian.net/browse/${ticketKey}`);
    }
  } finally {
    try { await unlink(tmpFile); } catch { /* best effort */ }
  }
}

async function handleWhoami({ flags }) {
  const data = await sentryGet('/auth/');
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const user = data.user || {};
  console.log('Auth OK');
  console.log('─'.repeat(40));
  console.log(`  User:  ${user.name || user.email || '(unknown)'}`);
  console.log(`  Email: ${user.email || '—'}`);
  console.log(`  Org:   ${ORG_SLUG}`);
  console.log(`  Base:  ${config.baseUrl}`);
}

// ── Help ─────────────────────────────────────────────────────────────

function showHelp(command) {
  if (command === 'issues') {
    console.log(`
sentry-cli.mjs issues — List unresolved issues for a project

Usage:
  node sentry-cli.mjs issues <project-slug> [options]

Options:
  --query "text"       Sentry search query (default: is:unresolved)
  --environment "prod" Filter by environment (e.g. production, staging)
  --limit N            Max results to return (default: 25)
  --all                Include all statuses (not just unresolved)
  --json               Output raw JSON

Examples:
  node sentry-cli.mjs issues blitzkrieg
  node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal"
  node sentry-cli.mjs issues blitzkrieg --environment production --limit 10
`);
  } else if (command === 'search') {
    console.log(`
sentry-cli.mjs search — Search issues with Sentry query syntax

Usage:
  node sentry-cli.mjs search <project-slug> --query "…" [options]

Query syntax:
  is:unresolved                  Unresolved only
  is:unresolved level:fatal      Fatal errors
  is:unresolved !has:assignee    Unassigned
  release:1.2.3                  Specific release
  transaction:/api/v1/path       Specific transaction
  user.email:user@example.com    Affecting specific user
  assigned:me                    Assigned to me
  firstSeen:>2026-01-01          First seen after date

Options:
  --environment "prod"   Filter by environment
  --limit N              Max results (default: 25)
  --json                 Output raw JSON
`);
  } else if (command === 'event') {
    console.log(`
sentry-cli.mjs event — Get latest event with full stack trace

Usage:
  node sentry-cli.mjs event <issue-id> [--json]

Shows:
  - Event ID, date, release, platform
  - Environment / transaction / URL tags
  - Full exception stack trace (innermost 20 frames)
  - In-app frames marked with ● (others with ○)
  - Context lines for in-app frames
  - Last 10 breadcrumbs
`);
  } else {
    console.log(`
sentry-cli.mjs — Sentry CLI

Usage:
  node sentry-cli.mjs <command> [options]

Commands:
  projects                     List all projects in org
  issues   <project>           List unresolved issues (alias: ls)
  view     <issue-id>          View issue details
  events   <issue-id>          List events for an issue
  event    <issue-id>          Get latest event + full stack trace
  resolve  <issue-id>          Mark issue as resolved
  unresolve <issue-id>         Mark issue as unresolved
  ignore   <issue-id>          Mark issue as ignored
  comment  <issue-id> "text"   Add a comment
  search   <project>           Search issues (--query "…")
  jira     <issue-id>          Create a Jira ticket for a Sentry issue
  teams                        List all teams in org
  whoami                       Verify auth token and show current user
  help     [command]           Show help for a command

Global options:
  --json   Output raw JSON response

Examples:
  node sentry-cli.mjs projects
  node sentry-cli.mjs issues blitzkrieg
  node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal" --limit 10
  node sentry-cli.mjs view 123456789
  node sentry-cli.mjs event 123456789
  node sentry-cli.mjs search blitzkrieg --query "TypeError" --environment production
  node sentry-cli.mjs resolve 123456789
  node sentry-cli.mjs comment 123456789 "Investigating — related to deploy v1.2.3"

Config:
  Org:     ${ORG_SLUG}
  Project: ${DEFAULT_PROJECT || '(set defaultProject in sentry-config.json)'}
  Base:    ${config.baseUrl}
`);
  }
}

// ── Main router ──────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const helpTopic = rest[0];
    showHelp(helpTopic);
    process.exit(0);
  }

  const parsed = parseArgs(rest);

  switch (command) {
    case 'projects':
      await handleProjects(parsed);
      break;
    case 'issues':
    case 'ls':
      await handleIssues(parsed);
      break;
    case 'view':
      await handleView(parsed);
      break;
    case 'events':
      await handleEvents(parsed);
      break;
    case 'event':
    case 'latest-event':
      await handleEvent(parsed);
      break;
    case 'resolve':
      await handleResolve(parsed);
      break;
    case 'unresolve':
      await handleUnresolve(parsed);
      break;
    case 'ignore':
      await handleIgnore(parsed);
      break;
    case 'comment':
      await handleComment(parsed);
      break;
    case 'search':
      await handleSearch(parsed);
      break;
    case 'teams':
      await handleTeams(parsed);
      break;
    case 'jira':
      await handleJira(parsed);
      break;
    case 'whoami':
    case 'auth':
      await handleWhoami(parsed);
      break;
    default:
      console.error(`Unknown command: "${command}". Run "node sentry-cli.mjs help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
