#!/usr/bin/env node

/**
 * jira-cli.mjs — General-purpose Jira CLI
 *
 * Usage:
 *   node jira-cli.mjs <command> [options]
 *
 * Commands:
 *   create        Create a new Jira ticket
 *   view          View ticket details
 *   update        Update ticket fields
 *   delete        Delete a ticket
 *   transition    Change ticket status (API + browser fallback)
 *   lifecycle     Run full JCP lifecycle (To Do → Closed)
 *   comment       Manage comments (add, list, edit, delete)
 *   search        Search issues via JQL
 *   label         Manage labels (add, remove, list)
 *   help          Show help for a command
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import {
  config, jcpFields, JIRA_BASE, AUTH_HEADER,
  jiraGet, jiraPost, jiraPut, jiraDelete,
} from './lib/api.mjs';
import { hasAuthState } from './lib/auth.mjs';
import { performTransition } from './lib/transition.mjs';
import { markdownToAdf, adfToMarkdown } from './lib/markdown.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Arg parsing utilities ───────────────────────────────────────────

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
      // Boolean flags (no value)
      const booleanFlags = ['json', 'jcp', 'visible', 'list', 'dry-run', 'cleanup', 'yes'];
      if (booleanFlags.includes(name)) {
        flags[name] = true;
        i++;
        continue;
      }
      // Repeatable flags
      if (name === 'field') {
        if (!flags.field) flags.field = [];
        flags.field.push(argv[++i]);
        i++;
        continue;
      }
      // Regular key=value flags
      flags[name] = argv[++i];
      i++;
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { flags, positional };
}

// ── Utility helpers ─────────────────────────────────────────────────

function addBusinessDays(startDate, days) {
  const date = new Date(startDate);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Parse --field key=value pairs into an object.
 * Handles JSON values and short aliases.
 */
function parseFieldArgs(fieldArgs) {
  if (!fieldArgs || fieldArgs.length === 0) return {};
  const fields = {};

  for (const entry of fieldArgs) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) {
      console.error(`  Invalid --field format: "${entry}" (expected key=value)`);
      continue;
    }
    const key = entry.slice(0, eqIdx);
    let value = entry.slice(eqIdx + 1);

    // Try parsing as JSON (for objects/arrays)
    try {
      value = JSON.parse(value);
    } catch {
      // Keep as string — check for numeric
      if (/^\d+(\.\d+)?$/.test(value)) {
        value = Number(value);
      }
    }

    // Short alias: story-points=N sets all 4 story point fields
    if (key === 'story-points') {
      const n = Number(value);
      fields.customfield_10016 = n;
      fields.customfield_10026 = n;
      fields.customfield_10075 = n;
      fields.customfield_10444 = n * 2;
      continue;
    }

    fields[key] = value;
  }

  return fields;
}

/**
 * Build ADF from plain text (used internally for lifecycle/simple strings).
 */
function textToAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/**
 * Read description/comment content from --description, --description-file, or --file.
 * Parses as Markdown → ADF. Falls back to textToAdf for plain strings.
 */
function resolveContentToAdf(flags, textKey = 'description', fileKey = 'description-file') {
  let raw;
  if (flags[fileKey]) {
    const filePath = resolve(flags[fileKey]);
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    raw = readFileSync(filePath, 'utf8');
  } else if (flags[textKey]) {
    raw = flags[textKey];
  } else {
    return null;
  }
  return markdownToAdf(raw);
}

// ── handleCreate ────────────────────────────────────────────────────

async function handleCreate({ flags, positional }) {
  const project = flags.project;
  const type = flags.type || 'Task';
  const summary = flags.summary;

  if (!project || !summary) {
    console.error('Usage: jira-cli.mjs create --project <KEY> --summary "Title" [options]');
    console.error('');
    console.error('Required:');
    console.error('  --project <KEY>       Project key (JCP, PLAT, ACM, etc.)');
    console.error('  --summary <text>      Ticket title');
    console.error('');
    console.error('Optional:');
    console.error('  --type <name>         Issue type (Task, Bug, Story, Epic) [default: Task]');
    console.error('  --description <text>  Ticket description (supports Markdown)');
    console.error('  --description-file <path>  Read description from a Markdown file');
    console.error('  --assignee <id>       Assignee account ID [default: self]');
    console.error('  --priority <name>     Priority name (Highest, High, Medium, Low, Lowest)');
    console.error('  --labels <l1,l2>      Comma-separated labels');
    console.error('  --field <key=value>   Custom field (repeatable)');
    console.error('  --jcp                 Use JCP defaults (component, env, cluster, channel, PM)');
    console.error('  --json                Output raw JSON response');
    process.exit(1);
  }

  const payload = {
    fields: {
      project: { key: project.toUpperCase() },
      issuetype: { name: type },
      summary,
      assignee: { accountId: flags.assignee || config.user.accountId },
    },
  };

  const descriptionAdf = resolveContentToAdf(flags, 'description', 'description-file');
  if (descriptionAdf) {
    payload.fields.description = descriptionAdf;
  } else if (project.toUpperCase() === 'JCP') {
    // JCP requires a description field
    payload.fields.description = textToAdf(summary);
  }

  if (flags.priority) {
    payload.fields.priority = { name: flags.priority };
  }

  if (flags.labels) {
    payload.fields.labels = flags.labels.split(',').map((l) => l.trim());
  }

  // JCP defaults
  if (flags.jcp || project.toUpperCase() === 'JCP') {
    payload.fields.components = [{ id: jcpFields.defaults.component.id }];
    payload.fields.customfield_12691 = { id: jcpFields.defaults.environment.id };
    payload.fields.customfield_11371 = { id: jcpFields.defaults.jcpCluster.id };
    payload.fields.customfield_10455 = { id: jcpFields.defaults.jcpChannel.id };
    payload.fields.customfield_10261 = { accountId: jcpFields.defaults.productManager.accountId };
    payload.fields.customfield_10091 = { accountId: config.user.accountId };
    payload.fields.customfield_10054 = { accountId: config.user.accountId };
  }

  // Custom fields
  const customFields = parseFieldArgs(flags.field);
  Object.assign(payload.fields, customFields);

  const result = await jiraPost('/rest/api/3/issue', payload);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Created: ${result.key} (${JIRA_BASE}/browse/${result.key})`);
  }
}

// ── handleView ──────────────────────────────────────────────────────

async function handleView({ flags, positional }) {
  const issueKey = positional[0];
  if (!issueKey) {
    console.error('Usage: jira-cli.mjs view <ISSUE_KEY> [--fields status,summary,...] [--json]');
    process.exit(1);
  }

  let fieldsParam = '';
  if (flags.fields) {
    fieldsParam = `?fields=${flags.fields}`;
  }

  const data = await jiraGet(`/rest/api/3/issue/${issueKey}${fieldsParam}`);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Formatted output
  const f = data.fields;
  console.log(`${data.key}: ${f.summary || '(no summary)'}`);
  console.log('─'.repeat(60));

  if (f.status) console.log(`  Status:      ${f.status.name}`);
  if (f.issuetype) console.log(`  Type:        ${f.issuetype.name}`);
  if (f.priority) console.log(`  Priority:    ${f.priority.name}`);
  if (f.assignee) console.log(`  Assignee:    ${f.assignee.displayName}`);
  if (f.reporter) console.log(`  Reporter:    ${f.reporter.displayName}`);
  if (f.project) console.log(`  Project:     ${f.project.key} — ${f.project.name}`);
  if (f.labels && f.labels.length) console.log(`  Labels:      ${f.labels.join(', ')}`);
  if (f.components && f.components.length) {
    console.log(`  Components:  ${f.components.map((c) => c.name).join(', ')}`);
  }
  if (f.duedate) console.log(`  Due Date:    ${f.duedate}`);
  if (f.created) console.log(`  Created:     ${f.created.slice(0, 10)}`);
  if (f.updated) console.log(`  Updated:     ${f.updated.slice(0, 10)}`);

  // Description
  if (f.description) {
    console.log('');
    console.log('  Description:');
    const text = adfToMarkdown(f.description);
    for (const line of text.split('\n')) {
      console.log(`    ${line}`);
    }
  }

  console.log('');
  console.log(`  URL: ${JIRA_BASE}/browse/${data.key}`);
}

// ── handleUpdate ────────────────────────────────────────────────────

async function handleUpdate({ flags, positional }) {
  const issueKey = positional[0];
  if (!issueKey) {
    console.error('Usage: jira-cli.mjs update <ISSUE_KEY> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --summary <text>      Update summary');
    console.error('  --description <text>  Update description (supports Markdown)');
    console.error('  --description-file <path>  Read description from a Markdown file');
    console.error('  --assignee <id>       Change assignee');
    console.error('  --priority <name>     Change priority');
    console.error('  --labels <l1,l2>      Set labels');
    console.error('  --field <key=value>   Set custom field (repeatable)');
    console.error('  --json                Output raw JSON response');
    process.exit(1);
  }

  const fields = {};

  if (flags.summary) fields.summary = flags.summary;
  const descAdf = resolveContentToAdf(flags, 'description', 'description-file');
  if (descAdf) fields.description = descAdf;
  if (flags.assignee) fields.assignee = { accountId: flags.assignee };
  if (flags.priority) fields.priority = { name: flags.priority };
  if (flags.labels) fields.labels = flags.labels.split(',').map((l) => l.trim());

  const customFields = parseFieldArgs(flags.field);
  Object.assign(fields, customFields);

  if (Object.keys(fields).length === 0) {
    console.error('No fields to update. Use --summary, --description, --field, etc.');
    process.exit(1);
  }

  await jiraPut(`/rest/api/3/issue/${issueKey}`, { fields });
  console.log(`Updated ${issueKey}`);

  if (flags.json) {
    const data = await jiraGet(`/rest/api/3/issue/${issueKey}`);
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── handleDelete ────────────────────────────────────────────────────

async function handleDelete({ flags, positional }) {
  const issueKey = positional[0];
  if (!issueKey) {
    console.error('Usage: jira-cli.mjs delete <ISSUE_KEY> [--yes]');
    process.exit(1);
  }

  if (!flags.yes) {
    const ok = await confirm(`Delete ${issueKey}? This cannot be undone.`);
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  await jiraDelete(`/rest/api/3/issue/${issueKey}`);
  console.log(`Deleted ${issueKey}`);
}

// ── handleTransition ────────────────────────────────────────────────

async function handleTransition({ flags, positional }) {
  const issueKey = positional[0];

  if (!issueKey) {
    console.error('Usage: jira-cli.mjs transition <ISSUE_KEY> <TRANSITION_NAME> [options]');
    console.error('       jira-cli.mjs transition <ISSUE_KEY> --list');
    console.error('');
    console.error('Options:');
    console.error('  --list                List available transitions');
    console.error('  --field <key=value>   Transition fields (repeatable)');
    console.error('  --visible             Show browser for browser transitions');
    console.error('  --slowmo <ms>         Slow browser actions');
    process.exit(1);
  }

  // --list mode: show available transitions
  if (flags.list) {
    const data = await jiraGet(`/rest/api/3/issue/${issueKey}/transitions`);
    const status = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
    console.log(`${issueKey} — current status: "${status.fields.status.name}"`);
    console.log('');
    console.log('Available transitions:');
    console.log('  ID    Name                        To Status');
    console.log('  ────  ──────────────────────────  ─────────────────');
    for (const t of data.transitions) {
      const id = t.id.padEnd(4);
      const name = t.name.padEnd(26);
      const to = t.to?.name || '';
      const screen = t.hasScreen ? ' [has screen]' : '';
      console.log(`  ${id}  ${name}  ${to}${screen}`);
    }
    return;
  }

  const transitionName = positional[1];
  if (!transitionName) {
    console.error('Error: Expected transition name. Use --list to see available transitions.');
    process.exit(1);
  }

  const customFields = parseFieldArgs(flags.field);

  // Try API first
  console.log(`Transitioning ${issueKey} via "${transitionName}"...`);

  try {
    const data = await jiraGet(`/rest/api/3/issue/${issueKey}/transitions`);
    const match = data.transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    );

    if (!match) {
      const available = data.transitions.map((t) => `"${t.name}" (id: ${t.id})`).join(', ');
      console.error(`  Transition "${transitionName}" not found. Available: ${available}`);
      process.exit(1);
    }

    // If the transition has a screen, it may need browser
    if (match.hasScreen) {
      console.log(`  Transition has a screen — trying API first...`);
    }

    const body = { transition: { id: match.id } };
    if (Object.keys(customFields).length > 0) {
      body.fields = customFields;
    }

    await jiraPost(`/rest/api/3/issue/${issueKey}/transitions`, body);
    console.log(`  API transition successful (id: ${match.id})`);

    await sleep(1500);
    const status = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
    console.log(`  New status: "${status.fields.status.name}"`);
  } catch (apiErr) {
    // If the API fails (e.g., hasScreen with required fields), fall back to browser
    console.log(`  API transition failed: ${apiErr.message}`);
    console.log(`  Falling back to browser transition...`);

    if (!hasAuthState()) {
      console.error('  No browser auth state. Run: node jira-transition.mjs --setup');
      process.exit(1);
    }

    const visible = flags.visible || false;
    const slowMo = parseInt(flags.slowmo || '0', 10);

    const result = await performTransition(issueKey, transitionName, { visible, slowMo });
    console.log(`  Browser transition: "${result.previousStatus}" → "${result.newStatus}"`);
  }
}

// ── handleComment ───────────────────────────────────────────────────

async function handleComment({ flags, positional }) {
  const subcommand = positional[0];
  const issueKey = positional[1];

  if (!subcommand || !issueKey) {
    console.error('Usage:');
    console.error('  jira-cli.mjs comment add <ISSUE_KEY> "Comment text"');
    console.error('  jira-cli.mjs comment list <ISSUE_KEY> [--json]');
    console.error('  jira-cli.mjs comment edit <ISSUE_KEY> <COMMENT_ID> "Updated text"');
    console.error('  jira-cli.mjs comment delete <ISSUE_KEY> <COMMENT_ID>');
    process.exit(1);
  }

  switch (subcommand) {
    case 'add': {
      let commentAdf;
      if (flags.file) {
        const filePath = resolve(flags.file);
        if (!existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        commentAdf = markdownToAdf(readFileSync(filePath, 'utf8'));
      } else {
        const text = positional[2];
        if (!text) {
          console.error('Error: Comment text or --file required.');
          console.error('Usage: jira-cli.mjs comment add <ISSUE_KEY> "text"');
          console.error('       jira-cli.mjs comment add <ISSUE_KEY> --file comment.md');
          process.exit(1);
        }
        commentAdf = markdownToAdf(text);
      }

      const result = await jiraPost(`/rest/api/3/issue/${issueKey}/comment`, {
        body: commentAdf,
      });
      console.log(`Comment added (id: ${result.id})`);
      break;
    }

    case 'list': {
      const data = await jiraGet(`/rest/api/3/issue/${issueKey}/comment`);

      if (flags.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.comments.length === 0) {
        console.log(`${issueKey}: No comments.`);
        return;
      }

      console.log(`${issueKey}: ${data.comments.length} comment(s)`);
      console.log('─'.repeat(60));

      for (const c of data.comments) {
        const author = c.author?.displayName || 'Unknown';
        const date = c.created?.slice(0, 10) || '';
        const text = adfToMarkdown(c.body);
        const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
        console.log(`  [${c.id}] ${author} (${date})`);
        for (const line of preview.split('\n')) {
          console.log(`    ${line}`);
        }
        console.log('');
      }
      break;
    }

    case 'edit': {
      const commentId = positional[2];
      let editAdf;
      if (flags.file) {
        const filePath = resolve(flags.file);
        if (!existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        editAdf = markdownToAdf(readFileSync(filePath, 'utf8'));
      } else {
        const text = positional[3];
        if (!commentId || !text) {
          console.error('Usage: jira-cli.mjs comment edit <ISSUE_KEY> <COMMENT_ID> "text"');
          console.error('       jira-cli.mjs comment edit <ISSUE_KEY> <COMMENT_ID> --file comment.md');
          process.exit(1);
        }
        editAdf = markdownToAdf(text);
      }

      if (!commentId) {
        console.error('Error: Comment ID required.');
        process.exit(1);
      }

      await jiraPut(`/rest/api/3/issue/${issueKey}/comment/${commentId}`, {
        body: editAdf,
      });
      console.log(`Comment ${commentId} updated.`);
      break;
    }

    case 'delete': {
      const commentId = positional[2];
      if (!commentId) {
        console.error('Usage: jira-cli.mjs comment delete <ISSUE_KEY> <COMMENT_ID>');
        process.exit(1);
      }

      await jiraDelete(`/rest/api/3/issue/${issueKey}/comment/${commentId}`);
      console.log(`Comment ${commentId} deleted.`);
      break;
    }

    default:
      console.error(`Unknown comment subcommand: "${subcommand}". Use add, list, edit, or delete.`);
      process.exit(1);
  }
}

// ── handleSearch ────────────────────────────────────────────────────

async function handleSearch({ flags, positional }) {
  const jql = flags.jql || positional[0];

  if (!jql) {
    console.error('Usage: jira-cli.mjs search --jql "project = JCP" [options]');
    console.error('       jira-cli.mjs search "project = JCP"');
    console.error('');
    console.error('Options:');
    console.error('  --jql <query>         JQL query (or pass as first positional arg)');
    console.error('  --max-results <N>     Max results to return [default: 50]');
    console.error('  --fields <f1,f2>      Comma-separated fields [default: summary,status,assignee,labels,priority,issuetype]');
    console.error('  --json                Output raw JSON');
    process.exit(1);
  }

  const maxResults = parseInt(flags['max-results'] || '50', 10);
  const fields = flags.fields
    ? flags.fields.split(',').map((f) => f.trim())
    : ['summary', 'status', 'assignee', 'labels', 'priority', 'issuetype'];

  const body = { jql, maxResults, fields };
  const data = await jiraPost('/rest/api/3/search/jql', body);

  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const shown = data.issues?.length || 0;

  if (shown === 0) {
    console.log('No results found.');
    return;
  }

  const hasMore = !!data.nextPageToken;
  console.log(`Found ${shown} result(s)${hasMore ? ' (more available)' : ''}`);
  if (hasMore) {
    console.log(`  Hint: use --max-results to retrieve more results`);
  }
  console.log('');

  // Table header
  console.log('  Key            Status                  Type        Assignee                  Summary');
  console.log('  ─────────────  ──────────────────────  ──────────  ────────────────────────  ─────────────────────────');

  for (const issue of data.issues) {
    const f = issue.fields;
    const key = (issue.key || '').padEnd(13);
    const status = (f.status?.name || '').padEnd(22);
    const type = (f.issuetype?.name || '').padEnd(10);
    const assignee = (f.assignee?.displayName || 'Unassigned').padEnd(24);
    const summary = f.summary || '';
    // Truncate summary to keep table readable
    const summaryTrunc = summary.length > 50 ? summary.slice(0, 47) + '...' : summary;
    console.log(`  ${key}  ${status}  ${type}  ${assignee}  ${summaryTrunc}`);
  }
}

// ── handleLabel ─────────────────────────────────────────────────────

async function handleLabel({ flags, positional }) {
  const subcommand = positional[0];
  const issueKey = positional[1];

  if (!subcommand || !issueKey) {
    console.error('Usage:');
    console.error('  jira-cli.mjs label add <ISSUE_KEY> <label1> [label2 ...]');
    console.error('  jira-cli.mjs label remove <ISSUE_KEY> <label1> [label2 ...]');
    console.error('  jira-cli.mjs label list <ISSUE_KEY> [--json]');
    process.exit(1);
  }

  switch (subcommand) {
    case 'add': {
      const labels = positional.slice(2);
      if (labels.length === 0) {
        console.error('Error: At least one label is required.');
        console.error('Usage: jira-cli.mjs label add <ISSUE_KEY> <label1> [label2 ...]');
        process.exit(1);
      }

      const update = { labels: labels.map((l) => ({ add: l })) };
      await jiraPut(`/rest/api/3/issue/${issueKey}`, { update });
      console.log(`Added label(s) to ${issueKey}: ${labels.join(', ')}`);

      if (flags.json) {
        const data = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=labels`);
        console.log(JSON.stringify(data.fields.labels, null, 2));
      }
      break;
    }

    case 'remove': {
      const labels = positional.slice(2);
      if (labels.length === 0) {
        console.error('Error: At least one label is required.');
        console.error('Usage: jira-cli.mjs label remove <ISSUE_KEY> <label1> [label2 ...]');
        process.exit(1);
      }

      const update = { labels: labels.map((l) => ({ remove: l })) };
      await jiraPut(`/rest/api/3/issue/${issueKey}`, { update });
      console.log(`Removed label(s) from ${issueKey}: ${labels.join(', ')}`);

      if (flags.json) {
        const data = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=labels`);
        console.log(JSON.stringify(data.fields.labels, null, 2));
      }
      break;
    }

    case 'list': {
      const data = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=labels`);
      const labels = data.fields.labels || [];

      if (flags.json) {
        console.log(JSON.stringify(labels, null, 2));
        return;
      }

      if (labels.length === 0) {
        console.log(`${issueKey}: No labels.`);
      } else {
        console.log(`${issueKey}: ${labels.length} label(s)`);
        for (const label of labels) {
          console.log(`  - ${label}`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown label subcommand: "${subcommand}". Use add, remove, or list.`);
      process.exit(1);
  }
}

// ── handleLifecycle ─────────────────────────────────────────────────

const LIFECYCLE_STEPS = [
  {
    step: 0, name: 'Dev Started', method: 'api-discover',
    transitionName: 'Dev Started', expectedStatus: 'In Progress',
    fields: { customfield_10055: { accountId: config.user.accountId } },
  },
  {
    step: 1, name: 'Dev Testing', method: 'browser',
    transitionId: '321', transitionName: 'Dev Testing', expectedStatus: 'Dev Verification',
  },
  {
    step: 2, name: 'EM Review', method: 'api',
    transitionId: '331', transitionName: 'EM Review', expectedStatus: 'LEAD REVIEW',
  },
  {
    step: 3, name: 'Ready For SIT', method: 'api',
    transitionId: '261', transitionName: 'Ready For SIT', expectedStatus: 'SIT Deployment',
  },
  {
    step: 4, name: 'Ready For SIT Testing', method: 'api',
    transitionId: '3', transitionName: 'Ready For SIT Testing', expectedStatus: 'SIT Verification To Do',
  },
  {
    step: 5, name: 'SIT Testing In-Progress', method: 'api',
    transitionId: '6', transitionName: 'SIT Testing In-Progress', expectedStatus: 'SIT Verification',
    fields: { customfield_10417: null, customfield_10054: { accountId: config.user.accountId } },
  },
  {
    step: 6, name: 'Ready For UAT', method: 'browser',
    transitionId: '101', transitionName: 'Ready For UAT', expectedStatus: 'UAT Deployment',
  },
  {
    step: 7, name: 'Ready For UAT Testing', method: 'api',
    transitionId: '4', transitionName: 'Ready For UAT Testing', expectedStatus: 'UAT Verification To Do',
  },
  {
    step: 8, name: 'UAT Testing In-Progress', method: 'api',
    transitionId: '7', transitionName: 'UAT Testing In-Progress', expectedStatus: 'UAT Verification',
  },
  {
    step: 9, name: 'Ready For Prod', method: 'browser',
    transitionId: '121', transitionName: 'Ready For Prod', expectedStatus: 'Prod Deployment',
  },
  {
    step: 10, name: 'Ready For Prod Testing', method: 'api',
    transitionId: '5', transitionName: 'Ready For Prod Testing', expectedStatus: 'PROD Verification To Do',
  },
  {
    step: 11, name: 'Prod Testing In-Progress', method: 'api',
    transitionId: '8', transitionName: 'Prod Testing In-Progress', expectedStatus: 'Prod Verification',
  },
  {
    step: 12, name: 'Done', method: 'api',
    transitionId: '141', transitionName: 'Done', expectedStatus: 'Closed',
  },
];

const RANDOM_IMAGE_DIR = '/Users/vaibhavpratihar/Downloads/JIRA - SS';

async function handleLifecycle({ flags }) {
  const ticketFlag = flags.ticket;
  const fromStep = parseInt(flags['from-step'] || '0', 10);
  const dryRun = flags['dry-run'] || false;
  const cleanup = flags.cleanup || false;
  const visible = flags.visible || false;
  const slowMo = parseInt(flags.slowmo || '0', 10);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       JCP Lifecycle — End-to-End Runner      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // Dry run
  if (dryRun) {
    console.log('DRY RUN — showing execution plan:\n');
    console.log(ticketFlag ? `  Ticket: ${ticketFlag} (existing)` : '  Ticket: (will create new)');
    console.log(`  Starting from step: ${fromStep}`);
    console.log(`  Browser visible: ${visible}`);
    console.log(`  Cleanup after: ${cleanup}`);
    console.log('');

    const stepsToRun = LIFECYCLE_STEPS.filter((s) => s.step >= fromStep);
    console.log(`  Steps to execute (${stepsToRun.length}):`);
    console.log('  ─────────────────────────────────────────');
    for (const s of stepsToRun) {
      const method = s.method === 'browser' ? 'BROWSER' : 'API';
      console.log(`  ${String(s.step).padStart(2)}. ${s.name.padEnd(25)} [${method}]`);
      console.log(`      → Expected status: "${s.expectedStatus}"`);
    }
    console.log('');
    console.log('Run without --dry-run to execute.');
    return;
  }

  // Pre-flight
  console.log('━━━ Pre-flight Checks ━━━\n');
  let preflightOk = true;

  if (hasAuthState()) {
    console.log('  ✓ Browser auth state found');
  } else {
    console.log('  ✗ Browser auth state missing. Run: node jira-transition.mjs --setup');
    preflightOk = false;
  }

  try {
    const me = await jiraGet('/rest/api/3/myself');
    console.log(`  ✓ API auth works (${me.displayName})`);
  } catch (e) {
    console.log(`  ✗ API auth failed: ${e.message}`);
    preflightOk = false;
  }

  if (existsSync(RANDOM_IMAGE_DIR)) {
    const images = readdirSync(RANDOM_IMAGE_DIR).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f)
    );
    if (images.length > 0) {
      console.log(`  ✓ Random images found (${images.length} files)`);
    } else {
      console.log(`  ✗ No images in ${RANDOM_IMAGE_DIR}`);
      preflightOk = false;
    }
  } else {
    console.log(`  ✗ Image directory missing: ${RANDOM_IMAGE_DIR}`);
    preflightOk = false;
  }

  console.log('');
  if (!preflightOk) {
    throw new Error('Pre-flight checks failed. Fix the issues above and retry.');
  }

  // Get or create ticket
  let issueKey;
  if (ticketFlag) {
    issueKey = ticketFlag.toUpperCase();
    const data = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
    console.log(`Using existing ticket: ${issueKey} (status: "${data.fields.status.name}")\n`);
  } else {
    console.log('━━━ Creating Test JCP Ticket ━━━\n');
    const today = new Date().toISOString().slice(0, 10);
    const dueDate = addBusinessDays(new Date(), 3).toISOString().slice(0, 10);

    const payload = {
      fields: {
        project: { key: 'JCP' },
        issuetype: { name: 'Task' },
        summary: `[Lifecycle Test] Automated lifecycle run — ${today}`,
        description: textToAdf(
          `Automated lifecycle test ticket created by jira-cli.mjs on ${today}. ` +
          `This ticket will be moved through all workflow stages and closed automatically. Safe to ignore/delete.`
        ),
        assignee: { accountId: config.user.accountId },
        components: [{ id: jcpFields.defaults.component.id }],
        customfield_12691: { id: jcpFields.defaults.environment.id },
        customfield_11371: { id: jcpFields.defaults.jcpCluster.id },
        customfield_10455: { id: jcpFields.defaults.jcpChannel.id },
        customfield_10261: { accountId: jcpFields.defaults.productManager.accountId },
        customfield_10091: { accountId: config.user.accountId },
        customfield_10054: { accountId: config.user.accountId },
        customfield_10016: 1,
        customfield_10026: 1,
        customfield_10075: 1,
        customfield_10444: 2,
        customfield_10015: today,
        customfield_10416: today,
        customfield_12790: dueDate,
        customfield_12856: dueDate,
        duedate: dueDate,
      },
    };

    const result = await jiraPost('/rest/api/3/issue', payload);
    issueKey = result.key;
    console.log(`  Created: ${issueKey} (${JIRA_BASE}/browse/${issueKey})\n`);
  }

  // Execute steps
  const stepsToRun = LIFECYCLE_STEPS.filter((s) => s.step >= fromStep);
  const results = [];
  const overallStart = Date.now();

  console.log('━━━ Executing Lifecycle Steps ━━━\n');

  for (const step of stepsToRun) {
    const method = step.method === 'browser' ? 'BROWSER' : 'API';
    console.log(`┌─ Step ${step.step}/12: ${step.name} [${method}]`);

    const statusData = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
    const statusBefore = statusData.fields.status.name;
    console.log(`│  Status before: "${statusBefore}"`);

    const stepStart = Date.now();

    try {
      // Execute the step
      switch (step.method) {
        case 'api-discover': {
          const transData = await jiraGet(`/rest/api/3/issue/${issueKey}/transitions`);
          const match = transData.transitions.find(
            (t) => t.name.toLowerCase() === step.transitionName.toLowerCase()
          );
          if (!match) {
            const available = transData.transitions.map((t) => `"${t.name}" (${t.id})`).join(', ');
            throw new Error(`Transition "${step.transitionName}" not found. Available: ${available}`);
          }
          console.log(`│  Discovered transition ID: ${match.id}`);
          const body = { transition: { id: match.id } };
          if (step.fields) body.fields = { ...step.fields };
          await jiraPost(`/rest/api/3/issue/${issueKey}/transitions`, body);
          break;
        }

        case 'api': {
          let fields = null;
          if (step.fields) {
            fields = { ...step.fields };
            if (fields.customfield_10417 === null) {
              fields.customfield_10417 = addBusinessDays(new Date(), 2).toISOString().slice(0, 10);
            }
          }
          const body = { transition: { id: step.transitionId } };
          if (fields) body.fields = fields;
          await jiraPost(`/rest/api/3/issue/${issueKey}/transitions`, body);
          break;
        }

        case 'browser':
          await performTransition(issueKey, step.transitionName, { visible, slowMo });
          break;
      }

      // Wait for consistency
      if (step.method !== 'browser') await sleep(1500);

      const afterData = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
      let statusAfter = afterData.fields.status.name;
      let elapsed = Date.now() - stepStart;

      if (statusAfter.toLowerCase() === statusBefore.toLowerCase()) {
        console.log(`│  Status unchanged, waiting 3s...`);
        await sleep(3000);
        const retryData = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
        statusAfter = retryData.fields.status.name;
        elapsed = Date.now() - stepStart;
      }

      if (statusAfter.toLowerCase() !== statusBefore.toLowerCase()) {
        console.log(`│  Status after:  "${statusAfter}"`);
        console.log(`└─ ✓ Step ${step.step} passed (${formatDuration(elapsed)})\n`);
        results.push({ step: step.step, name: step.name, status: 'passed', elapsed, statusAfter });
      } else {
        console.log(`│  Status still: "${statusAfter}" — expected: "${step.expectedStatus}"`);
        console.log(`└─ ✗ Step ${step.step} FAILED\n`);
        results.push({ step: step.step, name: step.name, status: 'failed', elapsed, statusAfter });
        throw new Error(`Step ${step.step} (${step.name}) failed: status remained "${statusAfter}"`);
      }
    } catch (err) {
      const elapsed = Date.now() - stepStart;
      if (!results.find((r) => r.step === step.step)) {
        results.push({ step: step.step, name: step.name, status: 'failed', elapsed, error: err.message });
      }
      console.error(`│  Error: ${err.message}`);
      console.log(`└─ ✗ Step ${step.step} FAILED (${formatDuration(elapsed)})\n`);
      printLifecycleSummary(issueKey, results, overallStart);
      console.log(`\nTo resume: node jira-cli.mjs lifecycle --ticket ${issueKey} --from-step ${step.step}`);
      process.exit(1);
    }
  }

  printLifecycleSummary(issueKey, results, overallStart);

  if (cleanup) {
    console.log(`\nCleaning up: deleting ${issueKey}...`);
    try {
      await jiraDelete(`/rest/api/3/issue/${issueKey}`);
      console.log(`  Deleted ${issueKey}.`);
    } catch (e) {
      console.log(`  Cleanup failed: ${e.message}`);
    }
  }
}

function printLifecycleSummary(issueKey, results, overallStart) {
  const totalElapsed = Date.now() - overallStart;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log('━━━ Summary ━━━\n');
  console.log(`  Ticket:   ${issueKey} (${JIRA_BASE}/browse/${issueKey})`);
  console.log(`  Steps:    ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`  Duration: ${formatDuration(totalElapsed)}`);
  console.log('');

  console.log('  Step  Name                       Result   Time     Status After');
  console.log('  ────  ─────────────────────────  ───────  ───────  ─────────────');
  for (const r of results) {
    const icon = r.status === 'passed' ? '✓' : '✗';
    const stepStr = String(r.step).padStart(2);
    const nameStr = r.name.padEnd(25);
    const resultStr = (r.status === 'passed' ? 'passed' : 'FAILED').padEnd(7);
    const timeStr = formatDuration(r.elapsed).padEnd(7);
    const statusStr = r.statusAfter || r.error || '';
    console.log(`   ${stepStr}  ${nameStr}  ${icon} ${resultStr}  ${timeStr}  ${statusStr}`);
  }

  console.log('');
  if (failed === 0 && results.length === LIFECYCLE_STEPS.length) {
    console.log('  All steps passed! Ticket is now Closed.');
  } else if (failed > 0) {
    const lastFailed = results.find((r) => r.status === 'failed');
    console.log(`  Failed at step ${lastFailed.step} (${lastFailed.name}).`);
  }
}

// ── Help ────────────────────────────────────────────────────────────

function showHelp(command) {
  if (command === 'create') {
    console.log(`
jira-cli.mjs create — Create a new Jira ticket

Usage:
  node jira-cli.mjs create --project <KEY> --summary "Title" [options]

Required:
  --project <KEY>       Project key (JCP, PLAT, ACM, etc.)
  --summary <text>      Ticket title

Optional:
  --type <name>         Issue type (Task, Bug, Story, Epic) [default: Task]
  --description <text>  Ticket description (supports Markdown)
  --description-file <path>  Read description from a Markdown file
  --assignee <id>       Assignee account ID [default: self]
  --priority <name>     Priority (Highest, High, Medium, Low, Lowest)
  --labels <l1,l2>      Comma-separated labels
  --field <key=value>   Custom field (repeatable)
  --jcp                 Use JCP defaults (component, env, cluster, channel, PM)
  --json                Output raw JSON
`);
  } else if (command === 'view') {
    console.log(`
jira-cli.mjs view — View ticket details

Usage:
  node jira-cli.mjs view <ISSUE_KEY> [--fields status,summary,...] [--json]
`);
  } else if (command === 'update') {
    console.log(`
jira-cli.mjs update — Update ticket fields

Usage:
  node jira-cli.mjs update <ISSUE_KEY> [options]

Options:
  --summary <text>      Update summary
  --description <text>  Update description (supports Markdown)
  --description-file <path>  Read description from a Markdown file
  --assignee <id>       Change assignee
  --priority <name>     Change priority
  --labels <l1,l2>      Set labels
  --field <key=value>   Set custom field (repeatable)
  --json                Output raw JSON
`);
  } else if (command === 'delete') {
    console.log(`
jira-cli.mjs delete — Delete a ticket

Usage:
  node jira-cli.mjs delete <ISSUE_KEY> [--yes]
`);
  } else if (command === 'transition') {
    console.log(`
jira-cli.mjs transition — Change ticket status

Usage:
  node jira-cli.mjs transition <ISSUE_KEY> <TRANSITION_NAME> [options]
  node jira-cli.mjs transition <ISSUE_KEY> --list

Options:
  --list                List available transitions
  --field <key=value>   Transition fields (repeatable)
  --visible             Show browser for browser-based transitions
  --slowmo <ms>         Slow browser actions

Logic:
  1. Tries REST API first
  2. Falls back to browser (Playwright) if API fails
`);
  } else if (command === 'lifecycle') {
    console.log(`
jira-cli.mjs lifecycle — Run full JCP lifecycle (To Do → Closed)

Usage:
  node jira-cli.mjs lifecycle [options]

Options:
  --ticket <KEY>        Use existing ticket (skip creation)
  --from-step <N>       Resume from step N (0-12)
  --visible             Show browser
  --slowmo <ms>         Slow browser actions
  --dry-run             Print plan only
  --cleanup             Delete ticket after success
`);
  } else if (command === 'comment') {
    console.log(`
jira-cli.mjs comment — Manage comments

Usage:
  node jira-cli.mjs comment add <ISSUE_KEY> "text"           Inline (supports Markdown)
  node jira-cli.mjs comment add <ISSUE_KEY> --file comment.md Read from file
  node jira-cli.mjs comment list <ISSUE_KEY> [--json]
  node jira-cli.mjs comment edit <ISSUE_KEY> <ID> "text"      Inline (supports Markdown)
  node jira-cli.mjs comment edit <ISSUE_KEY> <ID> --file f.md Read from file
  node jira-cli.mjs comment delete <ISSUE_KEY> <COMMENT_ID>
`);
  } else if (command === 'search') {
    console.log(`
jira-cli.mjs search — Search issues via JQL

Usage:
  node jira-cli.mjs search --jql "project = JCP" [options]
  node jira-cli.mjs search "project = JCP"

Options:
  --jql <query>         JQL query (or pass as first positional arg)
  --max-results <N>     Max results to return [default: 50]
  --fields <f1,f2>      Comma-separated fields [default: summary,status,assignee,labels,priority,issuetype]
  --json                Output raw JSON

Examples:
  node jira-cli.mjs search --jql "labels = auto-dev AND project = JCP" --max-results 10
  node jira-cli.mjs search "assignee = currentUser() ORDER BY updated DESC" --json
  node jira-cli.mjs search --jql "project = JCP" --fields summary,status
`);
  } else if (command === 'label') {
    console.log(`
jira-cli.mjs label — Manage labels

Usage:
  node jira-cli.mjs label add <ISSUE_KEY> <label1> [label2 ...]
  node jira-cli.mjs label remove <ISSUE_KEY> <label1> [label2 ...]
  node jira-cli.mjs label list <ISSUE_KEY> [--json]

Options:
  --json                Output raw JSON (on add/remove: re-fetches updated labels)

Examples:
  node jira-cli.mjs label list JCP-1234
  node jira-cli.mjs label add JCP-1234 auto-dev sprint-42
  node jira-cli.mjs label remove JCP-1234 auto-dev
  node jira-cli.mjs label list JCP-1234 --json
`);
  } else {
    console.log(`
jira-cli.mjs — General-purpose Jira CLI

Usage:
  node jira-cli.mjs <command> [options]

Commands:
  create        Create a new Jira ticket
  view          View ticket details
  update        Update ticket fields
  delete        Delete a ticket
  transition    Change ticket status (API + browser fallback)
  lifecycle     Run full JCP lifecycle (To Do → Closed)
  comment       Manage comments (add, list, edit, delete)
  search        Search issues via JQL
  label         Manage labels (add, remove, list)
  help          Show help for a command

Examples:
  node jira-cli.mjs create --project JCP --type Task --summary "Fix login bug" --jcp
  node jira-cli.mjs view JCP-9903
  node jira-cli.mjs update JCP-9903 --summary "Updated title" --field duedate=2026-03-01
  node jira-cli.mjs transition JCP-9903 --list
  node jira-cli.mjs transition JCP-9903 "Dev Started"
  node jira-cli.mjs comment add JCP-9903 "Work in progress"
  node jira-cli.mjs comment list JCP-9903
  node jira-cli.mjs search --jql "project = JCP AND labels = auto-dev"
  node jira-cli.mjs label add JCP-9903 auto-dev sprint-42
  node jira-cli.mjs label list JCP-9903
  node jira-cli.mjs delete JCP-9903
  node jira-cli.mjs lifecycle --dry-run
  node jira-cli.mjs lifecycle --ticket JCP-9903 --from-step 6

Config:
  User:    ${config.user.name} (${config.user.email})
  Site:    ${JIRA_BASE}
`);
  }
}

// ── Main router ─────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    const helpTopic = rest[0];
    showHelp(helpTopic);
    process.exit(0);
  }

  const parsed = parseArgs(rest);

  switch (command) {
    case 'create':
      await handleCreate(parsed);
      break;
    case 'view':
      await handleView(parsed);
      break;
    case 'update':
      await handleUpdate(parsed);
      break;
    case 'delete':
      await handleDelete(parsed);
      break;
    case 'transition':
      await handleTransition(parsed);
      break;
    case 'lifecycle':
      await handleLifecycle(parsed);
      break;
    case 'comment':
      await handleComment(parsed);
      break;
    case 'search':
      await handleSearch(parsed);
      break;
    case 'label':
      await handleLabel(parsed);
      break;
    default:
      console.error(`Unknown command: "${command}". Run "node jira-cli.mjs help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
