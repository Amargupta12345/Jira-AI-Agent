/**
 * Creates JCP (or any project) Jira tickets from Sentry issues.
 *
 * Uses jira-cli.mjs for ticket creation — same pattern as the rest of the
 * agent (see src/jira/transitions.js). Writes a temp markdown description
 * file and passes it via --description-file.
 *
 * Key fields set per ticket:
 *   - Label:           nexus        (so the Dr. Nexus daemon picks it up)
 *   - Label:           sentry-alert (added post-create for traceability)
 *   - affectedSystems: auto-detected from Sentry project slug
 *   - fixVersions:     auto-selected from latest unreleased Jira fix version
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { log, warn } from '../utils/logger.js';

const JIRA_CLI_DIR = process.env.JIRA_CLI_DIR || path.join(process.cwd(), '..', 'jira-creator');
const CREATE_TIMEOUT_MS = 90 * 1000;

// ── Affected Systems mapping ──────────────────────────────────────────
// Maps Sentry project slug → Jira customfield_10056 option ID.
// Add new entries as new services are onboarded.

const AFFECTED_SYSTEMS_MAP = {
  blitzkrieg:  { id: '10262', name: 'Blitzkrieg' },
  convex:      { id: '10143', name: 'convex' },
  highbrow:    { id: '10291', name: 'Highbrow' },
  jetfire:     { id: '10083', name: 'jetfire' },
  skyfire:     { id: '11125', name: 'Skyfire' },
  scattershot: { id: '10315', name: 'Scattershot' },
  // mirage: add ID when the JCP Affected Systems option is created
};

// ── Fix version helpers ───────────────────────────────────────────────

/**
 * Fetch unreleased fix versions for a Jira project using config.jira credentials.
 * Returns array of { id, name } sorted newest-first.
 */
async function fetchJiraFixVersions(config, project = 'JCP') {
  const { baseUrl, email, apiToken } = config.jira || {};
  if (!baseUrl || !email || !apiToken) return [];

  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  try {
    const res = await fetch(
      `${baseUrl}/rest/api/3/project/${project}/versions?status=unreleased&orderBy=-sequence`,
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
 * Strategy: look for next patch/minor after the platform version,
 * fall back to the first (newest) unreleased version.
 */
function pickFixVersion(platformVersion, versions) {
  if (!versions.length) return null;
  if (versions.length === 1) return versions[0];

  if (platformVersion) {
    const m = platformVersion.match(/v?(\d+)\.(\d+)\.(\d+)/i);
    if (m) {
      const [, maj, min, pat] = m.map(Number);
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

// ── jira-cli.mjs runner ───────────────────────────────────────────────

/**
 * Spawn jira-cli.mjs with the given args. Never throws.
 * Returns { success, output, exitCode }.
 */
async function runJiraCli(args, label) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('node', ['jira-cli.mjs', ...args], {
      cwd: JIRA_CLI_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, output: `Timed out (${CREATE_TIMEOUT_MS / 1000}s)`, exitCode: null });
    }, CREATE_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.trim()) {
        const cleaned = stderr.trim().replace(/\(node.*\) Warning:.*\n?/g, '').trim();
        if (cleaned) warn(`[jira-cli:${label}:stderr] ${cleaned.substring(0, 300)}`);
      }
      resolve({ success: code === 0, output: stdout, exitCode: code });
    });

    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, output: e.message, exitCode: null });
    });
  });
}

// ── Description builders ──────────────────────────────────────────────

/**
 * Extract the most relevant stack trace lines from a Sentry event.
 */
function extractStackTrace(event) {
  if (!event) return null;

  const exceptions = event.exception?.values;
  if (!exceptions?.length) return null;

  const lines = [];

  for (const exc of exceptions.slice(-2)) {
    lines.push(`${exc.type}: ${exc.value}`);

    const frames = exc.stacktrace?.frames;
    if (frames?.length) {
      const relevant = frames.slice(-15).reverse();
      for (const f of relevant) {
        const parts = [f.module || f.filename, f.function, f.lineno].filter(Boolean);
        lines.push(`  at ${parts.join(' › ')}`);
        if (f.context_line?.trim()) {
          lines.push(`     ${f.context_line.trim()}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Build the full markdown description for the Jira ticket.
 */
function buildDescription(issue, event, serviceName) {
  const envTag = event?.tags?.find((t) => t.key === 'environment')?.value || 'production';
  const releaseTag = event?.tags?.find((t) => t.key === 'release')?.value;
  const transactionTag = event?.tags?.find((t) => t.key === 'transaction')?.value;
  const platformVersion = event?.tags?.find((t) => t.key === 'platform_version')?.value;
  const sentryUrl = issue.permalink || `https://sentry.io/issues/${issue.id}/`;

  const lines = [
    '## Sentry Error Alert',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Service** | ${serviceName} |`,
    `| **Sentry Project** | ${issue.project?.slug || 'unknown'} |`,
    `| **Environment** | ${envTag} |`,
    `| **Level** | ${issue.level || 'error'} |`,
    `| **First seen** | ${issue.firstSeen ? issue.firstSeen.slice(0, 10) : 'unknown'} |`,
    `| **Last seen** | ${issue.lastSeen ? issue.lastSeen.slice(0, 10) : 'unknown'} |`,
    `| **Times seen** | ${issue.count || 'unknown'} |`,
    `| **Sentry URL** | [View in Sentry](${sentryUrl}) |`,
    '',
  ];

  lines.push('## Error Details', '');
  lines.push(`**Title:** ${issue.title}`);
  if (issue.culprit) lines.push(`**Culprit:** \`${issue.culprit}\``);
  if (releaseTag) lines.push(`**Release:** ${releaseTag}`);
  if (platformVersion) lines.push(`**Platform Version:** ${platformVersion}`);
  if (transactionTag) lines.push(`**Transaction:** \`${transactionTag}\``);
  lines.push('');

  const stack = extractStackTrace(event);
  if (stack) {
    lines.push('## Stack Trace', '', '```', stack, '```', '');
  }

  lines.push(
    '## Resolution Notes',
    '',
    '> Investigate the stack trace above and fix the root cause.',
    `> Once fixed, verify in **${envTag}** and link the fix commit here.`,
    '',
  );

  return lines.join('\n');
}

/**
 * Build the ADF document for Jira's Steps to Reproduce field (customfield_10034).
 */
function buildStepsAdf(issue, event) {
  const sentryUrl = issue.permalink || `https://sentry.io/issues/${issue.id}/`;
  const envTag = event?.tags?.find((t) => t.key === 'environment')?.value || 'production';

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
    content: [
      {
        type: 'orderedList',
        content: steps.map((text) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      },
    ],
  });
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Create a Jira ticket for a Sentry issue.
 *
 * Sets all fields required for Dr. Nexus to pick up and process the ticket:
 *   - label: nexus  (daemon polls for this)
 *   - affectedSystems: auto-mapped from Sentry project slug
 *   - fixVersions: auto-selected from latest unreleased JCP version
 *
 * @param {object} config         - Full Dr. Nexus config
 * @param {object} issue          - Sentry issue object
 * @param {object|null} event     - Sentry latest event (may be null)
 * @param {string} serviceName    - Service name (e.g. "blitzkrieg")
 * @param {string} jiraProject    - Jira project key (default: "JCP")
 * @returns {{ success: boolean, ticketKey: string|null }}
 */
export async function createJiraTicket(config, issue, event, serviceName, jiraProject = 'JCP') {
  const summary = `[Sentry] ${issue.title}`.substring(0, 200);
  const description = buildDescription(issue, event, serviceName);
  const stepsAdf = buildStepsAdf(issue, event);

  // ── Resolve Affected System ────────────────────────────────────────
  const slugLower = (issue.project?.slug || serviceName).toLowerCase();
  const affectedSystem = AFFECTED_SYSTEMS_MAP[slugLower];
  if (affectedSystem) {
    log(`[sentry:jira] Affected System: ${affectedSystem.name} (id: ${affectedSystem.id})`);
  } else {
    warn(`[sentry:jira] No affected system mapping for "${slugLower}". Ticket will need manual Affected Systems field before Dr. Nexus can process it.`);
  }

  // ── Resolve Fix Version ────────────────────────────────────────────
  const platformVersion = event?.tags?.find((t) => t.key === 'platform_version')?.value;
  log(`[sentry:jira] Fetching unreleased fix versions for ${jiraProject}...`);
  const versions = await fetchJiraFixVersions(config, jiraProject);
  const fixVersion = pickFixVersion(platformVersion, versions);
  if (fixVersion) {
    log(`[sentry:jira] Fix Version: ${fixVersion.name} (id: ${fixVersion.id})${platformVersion ? ` [auto-selected for platform ${platformVersion}]` : ' [newest unreleased]'}`);
  } else {
    warn(`[sentry:jira] Could not resolve fix version for ${jiraProject}. Ticket will need manual Fix Version before Dr. Nexus can process it.`);
  }

  const tmpFile = path.join(os.tmpdir(), `sentry-desc-${issue.id}-${Date.now()}.md`);

  try {
    await fs.writeFile(tmpFile, description, 'utf-8');

    const args = [
      'create',
      '--project', jiraProject,
      '--type', 'Bug',
      '--summary', summary,
      '--description-file', tmpFile,
      '--labels', 'nexus',          // REQUIRED: daemon polls for this label
      '--field', `customfield_10034=${stepsAdf}`,
    ];

    // JCP project requires extra default fields (component, env, cluster, channel, PM)
    if (jiraProject.toUpperCase() === 'JCP') {
      args.push('--jcp');
    }

    // Affected Systems (customfield_10056)
    if (affectedSystem?.id) {
      args.push('--field', `customfield_10056=[{"id":"${affectedSystem.id}"}]`);
    }

    // Fix Version
    if (fixVersion) {
      args.push('--field', `fixVersions=[{"id":"${fixVersion.id}"}]`);
    }

    log(`[sentry:jira] Creating ${jiraProject} ticket for Sentry issue ${issue.id}...`);
    const result = await runJiraCli(args, `sentry-create-${issue.id}`);

    if (!result.success) {
      warn(`[sentry:jira] Ticket creation failed (exit ${result.exitCode}): ${result.output.substring(0, 300)}`);
      return { success: false, ticketKey: null };
    }

    // Extract key from output: "Created: JCP-XXXXX (https://...)"
    const match = result.output.match(/Created:\s+([A-Z]+-\d+)/);
    const ticketKey = match?.[1] ?? null;

    log(`[sentry:jira] Ticket created: ${ticketKey || '(key not parsed)'}`);

    // Add sentry-alert label post-create for traceability (non-blocking)
    if (ticketKey) {
      runJiraCli(
        ['label', 'add', ticketKey, 'sentry-alert'],
        `label-${ticketKey}`
      ).catch(() => {});
    }

    return { success: true, ticketKey };

  } catch (error) {
    warn(`[sentry:jira] createJiraTicket error: ${error.message}`);
    return { success: false, ticketKey: null };
  } finally {
    try { await fs.unlink(tmpFile); } catch { /* best effort */ }
  }
}
