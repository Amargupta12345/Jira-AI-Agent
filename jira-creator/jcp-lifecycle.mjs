#!/usr/bin/env node

/**
 * jcp-lifecycle.mjs — End-to-end JCP ticket lifecycle automation
 *
 * Creates a test JCP ticket and moves it through all 13 transitions
 * (To Do → In-Progress → ... → Closed), verifying each step.
 *
 * Usage:
 *   node jcp-lifecycle.mjs                          # Full run: create ticket + close it
 *   node jcp-lifecycle.mjs --ticket JCP-XXXX        # Use existing ticket
 *   node jcp-lifecycle.mjs --ticket JCP-XXXX --from-step 6  # Resume from step 6
 *   node jcp-lifecycle.mjs --dry-run                # Print plan without executing
 *   node jcp-lifecycle.mjs --visible --slowmo 300   # Visible browser for debugging
 *   node jcp-lifecycle.mjs --cleanup                # Delete ticket after success
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAuthState } from './lib/auth.mjs';
import { performTransition } from './lib/transition.mjs';

// Work around corporate/local TLS certificate issues (Node fetch can't find issuer cert)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load config ─────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(resolve(__dirname, 'jira-config.json'), 'utf8'));
const jcpFields = JSON.parse(readFileSync(resolve(__dirname, 'jcp-fields.json'), 'utf8'));

const JIRA_BASE = config.siteUrl;
const AUTH_HEADER = `Basic ${btoa(`${config.user.email}:${config.apiToken}`)}`;
const RANDOM_IMAGE_DIR = '/Users/vaibhavpratihar/Downloads/JIRA - SS';

// ── Step definitions ────────────────────────────────────────────────

const STEPS = [
  {
    step: 0,
    name: 'Dev Started',
    method: 'api-discover',
    transitionName: 'Dev Started',
    expectedStatus: 'In Progress',
    fields: {
      customfield_10055: { accountId: config.user.accountId },
    },
    notes: 'Auto-discovers transition ID; requires Engineering Lead',
  },
  {
    step: 1,
    name: 'Dev Testing',
    method: 'browser',
    transitionId: '321',
    transitionName: 'Dev Testing',
    expectedStatus: 'Dev Verification',
    notes: 'Attachment upload required',
  },
  {
    step: 2,
    name: 'EM Review',
    method: 'api',
    transitionId: '331',
    transitionName: 'EM Review',
    expectedStatus: 'LEAD REVIEW',
  },
  {
    step: 3,
    name: 'Ready For SIT',
    method: 'api',
    transitionId: '261',
    transitionName: 'Ready For SIT',
    expectedStatus: 'SIT Deployment',
  },
  {
    step: 4,
    name: 'Ready For SIT Testing',
    method: 'api',
    transitionId: '3',
    transitionName: 'Ready For SIT Testing',
    expectedStatus: 'SIT Verification To Do',
  },
  {
    step: 5,
    name: 'SIT Testing In-Progress',
    method: 'api',
    transitionId: '6',
    transitionName: 'SIT Testing In-Progress',
    expectedStatus: 'SIT Verification',
    fields: {
      customfield_10417: null, // QA Due Date — computed at runtime
      customfield_10054: { accountId: config.user.accountId },
    },
    notes: 'Requires QA Due Date + Assigned QA',
  },
  {
    step: 6,
    name: 'Ready For UAT',
    method: 'browser',
    transitionId: '101',
    transitionName: 'Ready For UAT',
    expectedStatus: 'UAT Deployment',
    notes: 'QC Report validator — ADO Link + Comment',
  },
  {
    step: 7,
    name: 'Ready For UAT Testing',
    method: 'api',
    transitionId: '4',
    transitionName: 'Ready For UAT Testing',
    expectedStatus: 'UAT Verification To Do',
  },
  {
    step: 8,
    name: 'UAT Testing In-Progress',
    method: 'api',
    transitionId: '7',
    transitionName: 'UAT Testing In-Progress',
    expectedStatus: 'UAT Verification',
  },
  {
    step: 9,
    name: 'Ready For Prod',
    method: 'browser',
    transitionId: '121',
    transitionName: 'Ready For Prod',
    expectedStatus: 'Prod Deployment',
    notes: 'QC Report validator — ADO Link + Comment',
  },
  {
    step: 10,
    name: 'Ready For Prod Testing',
    method: 'api',
    transitionId: '5',
    transitionName: 'Ready For Prod Testing',
    expectedStatus: 'PROD Verification To Do',
  },
  {
    step: 11,
    name: 'Prod Testing In-Progress',
    method: 'api',
    transitionId: '8',
    transitionName: 'Prod Testing In-Progress',
    expectedStatus: 'Prod Verification',
  },
  {
    step: 12,
    name: 'Done',
    method: 'api',
    transitionId: '141',
    transitionName: 'Done',
    expectedStatus: 'Closed',
  },
];

// ── Arg parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getFlagValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// ── Help ────────────────────────────────────────────────────────────

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
jcp-lifecycle — End-to-end JCP ticket lifecycle automation

Creates a test JCP ticket and moves it through all 13 transitions
(To Do → In-Progress → ... → Closed), verifying each step.

Usage:
  node jcp-lifecycle.mjs [options]

Options:
  --ticket <KEY>    Use existing ticket (skip creation)
  --from-step <N>   Resume from step N (0-12)
  --visible         Show browser for browser transitions
  --slowmo <ms>     Slow down browser actions
  --dry-run         Print plan without executing
  --cleanup         Delete ticket after success
  --help, -h        Show this help

Steps (0-12):
  0  Start Progress        (API - auto-discover)
  1  Dev Testing           (Browser - attachment)
  2  EM Review             (API)
  3  Ready For SIT         (API)
  4  Ready For SIT Testing (API)
  5  SIT Testing In-Prog   (API - QA date + assignee)
  6  Ready For UAT         (Browser - QC Report)
  7  Ready For UAT Testing (API)
  8  UAT Testing In-Prog   (API)
  9  Ready For Prod        (Browser - QC Report)
  10 Ready For Prod Testing(API)
  11 Prod Testing In-Prog  (API)
  12 Done                  (API)
`);
  process.exit(0);
}

// ── Jira API helpers ────────────────────────────────────────────────

async function jiraGet(path) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function jiraPost(path, body) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  // Some endpoints return 204 No Content
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return null;
}

async function jiraDelete(path) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: AUTH_HEADER },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE ${path} failed (${res.status}): ${body}`);
  }
}

// ── Pre-flight checks ───────────────────────────────────────────────

async function preflight() {
  console.log('━━━ Pre-flight Checks ━━━\n');
  let ok = true;

  // 1. Auth state for browser transitions
  if (hasAuthState()) {
    console.log('  ✓ Browser auth state found (.auth-state.json)');
  } else {
    console.log('  ✗ Browser auth state missing. Run: node jira-transition.mjs --setup');
    ok = false;
  }

  // 2. API token works
  try {
    const me = await jiraGet('/rest/api/3/myself');
    console.log(`  ✓ API auth works (logged in as ${me.displayName})`);
  } catch (e) {
    console.log(`  ✗ API auth failed: ${e.message}`);
    ok = false;
  }

  // 3. Random images directory
  if (existsSync(RANDOM_IMAGE_DIR)) {
    const images = readdirSync(RANDOM_IMAGE_DIR).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f)
    );
    if (images.length > 0) {
      console.log(`  ✓ Random images found (${images.length} files in ${RANDOM_IMAGE_DIR})`);
    } else {
      console.log(`  ✗ No images in ${RANDOM_IMAGE_DIR}`);
      ok = false;
    }
  } else {
    console.log(`  ✗ Image directory missing: ${RANDOM_IMAGE_DIR}`);
    ok = false;
  }

  console.log('');
  if (!ok) {
    throw new Error('Pre-flight checks failed. Fix the issues above and retry.');
  }
}

// ── Ticket creation ─────────────────────────────────────────────────

async function createTestTicket() {
  console.log('━━━ Creating Test JCP Ticket ━━━\n');

  const today = new Date().toISOString().slice(0, 10);
  // Due date: 3 business days from today
  const dueDate = addBusinessDays(new Date(), 3).toISOString().slice(0, 10);

  const payload = {
    fields: {
      project: { key: 'JCP' },
      issuetype: { name: 'Task' },
      summary: `[Lifecycle Test] Automated lifecycle run — ${today}`,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Automated lifecycle test ticket created by jcp-lifecycle.mjs on ${today}. This ticket will be moved through all workflow stages and closed automatically. Safe to ignore/delete.`,
              },
            ],
          },
        ],
      },
      assignee: { accountId: config.user.accountId },
      // JCP required fields
      components: [{ id: jcpFields.defaults.component.id }],
      customfield_12691: { id: jcpFields.defaults.environment.id },
      customfield_11371: { id: jcpFields.defaults.jcpCluster.id },
      customfield_10455: { id: jcpFields.defaults.jcpChannel.id },
      // Product Manager (Mahima)
      customfield_10261: { accountId: jcpFields.defaults.productManager.accountId },
      // Assigned Developer + QA = self
      customfield_10091: { accountId: config.user.accountId },
      customfield_10054: { accountId: config.user.accountId },
      // Story points: minimal (1h dev, 1h QA, 2h total)
      customfield_10016: 1,
      customfield_10026: 1,
      customfield_10075: 1,
      customfield_10444: 2,
      // Dates
      customfield_10015: today,
      customfield_10416: today,
      customfield_12790: dueDate,
      customfield_12856: dueDate,
      duedate: dueDate,
    },
  };

  const result = await jiraPost('/rest/api/3/issue', payload);
  const key = result.key;
  console.log(`  Created: ${key} (${JIRA_BASE}/browse/${key})\n`);
  return key;
}

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

// ── Get current ticket status ───────────────────────────────────────

async function getStatus(issueKey) {
  const data = await jiraGet(`/rest/api/3/issue/${issueKey}?fields=status`);
  return data.fields.status.name;
}

// ── API transition ──────────────────────────────────────────────────

async function apiTransition(issueKey, transitionId, fields) {
  const body = { transition: { id: transitionId } };
  if (fields && Object.keys(fields).length > 0) {
    body.fields = fields;
  }
  await jiraPost(`/rest/api/3/issue/${issueKey}/transitions`, body);
}

// ── Discover and execute transition by name (for step 0) ────────────

async function discoverAndTransition(issueKey, transitionName, fields) {
  const data = await jiraGet(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = data.transitions.find(
    (t) => t.name.toLowerCase() === transitionName.toLowerCase()
  );
  if (!match) {
    const available = data.transitions.map((t) => `"${t.name}" (id: ${t.id})`).join(', ');
    throw new Error(
      `Transition "${transitionName}" not found. Available: ${available}`
    );
  }
  console.log(`    Discovered transition ID: ${match.id}`);
  await apiTransition(issueKey, match.id, fields);
}

// ── Execute a single step ───────────────────────────────────────────

async function executeStep(issueKey, step, opts) {
  const { visible, slowMo } = opts;

  switch (step.method) {
    case 'api-discover':
      await discoverAndTransition(issueKey, step.transitionName, step.fields);
      break;

    case 'api': {
      let fields = null;
      if (step.fields) {
        fields = { ...step.fields };
        // Compute dynamic QA due date for step 5
        if (fields.customfield_10417 === null) {
          fields.customfield_10417 = addBusinessDays(new Date(), 2).toISOString().slice(0, 10);
        }
      }
      await apiTransition(issueKey, step.transitionId, fields);
      break;
    }

    case 'browser':
      await performTransition(issueKey, step.transitionName, { visible, slowMo });
      break;

    default:
      throw new Error(`Unknown method: ${step.method}`);
  }
}

// ── Sleep helper ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Format elapsed time ─────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const ticketFlag = getFlagValue('--ticket');
  const fromStep = parseInt(getFlagValue('--from-step') || '0', 10);
  const dryRun = hasFlag('--dry-run');
  const cleanup = hasFlag('--cleanup');
  const visible = hasFlag('--visible');
  const slowMo = parseInt(getFlagValue('--slowmo') || '0', 10);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       JCP Lifecycle — End-to-End Runner      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // ── Dry run mode ──────────────────────────────────────────────
  if (dryRun) {
    console.log('DRY RUN — showing execution plan:\n');
    if (ticketFlag) {
      console.log(`  Ticket: ${ticketFlag} (existing)`);
    } else {
      console.log('  Ticket: (will create new)');
    }
    console.log(`  Starting from step: ${fromStep}`);
    console.log(`  Browser visible: ${visible}`);
    console.log(`  Cleanup after: ${cleanup}`);
    console.log('');

    const stepsToRun = STEPS.filter((s) => s.step >= fromStep);
    console.log(`  Steps to execute (${stepsToRun.length}):`);
    console.log('  ─────────────────────────────────────────');
    for (const s of stepsToRun) {
      const method = s.method === 'browser' ? 'BROWSER' : 'API';
      const notes = s.notes ? ` — ${s.notes}` : '';
      console.log(`  ${String(s.step).padStart(2)}. ${s.name.padEnd(25)} [${method}]${notes}`);
      console.log(`      → Expected status: "${s.expectedStatus}"`);
    }
    console.log('');
    console.log('Run without --dry-run to execute.');
    return;
  }

  // ── Pre-flight ────────────────────────────────────────────────
  await preflight();

  // ── Get or create ticket ──────────────────────────────────────
  let issueKey;
  if (ticketFlag) {
    issueKey = ticketFlag.toUpperCase();
    const status = await getStatus(issueKey);
    console.log(`Using existing ticket: ${issueKey} (current status: "${status}")\n`);
  } else {
    issueKey = await createTestTicket();
  }

  // ── Execute steps ─────────────────────────────────────────────
  const stepsToRun = STEPS.filter((s) => s.step >= fromStep);
  const results = [];
  const overallStart = Date.now();

  console.log('━━━ Executing Lifecycle Steps ━━━\n');

  for (const step of stepsToRun) {
    const method = step.method === 'browser' ? 'BROWSER' : 'API';
    const notes = step.notes ? ` (${step.notes})` : '';
    console.log(`┌─ Step ${step.step}/12: ${step.name} [${method}]${notes}`);

    const statusBefore = await getStatus(issueKey);
    console.log(`│  Status before: "${statusBefore}"`);

    const stepStart = Date.now();

    try {
      await executeStep(issueKey, step, { visible, slowMo });

      // Wait for Jira eventual consistency
      if (step.method !== 'browser') {
        // Browser steps already have internal waits
        await sleep(1500);
      }

      const statusAfter = await getStatus(issueKey);
      const elapsed = Date.now() - stepStart;

      if (statusAfter.toLowerCase() !== statusBefore.toLowerCase()) {
        console.log(`│  Status after:  "${statusAfter}"`);
        console.log(`└─ ✓ Step ${step.step} passed (${formatDuration(elapsed)})\n`);
        results.push({ step: step.step, name: step.name, status: 'passed', elapsed, statusAfter });
      } else {
        // Status didn't change — may need a longer wait for eventual consistency
        console.log(`│  Status unchanged, waiting 3s for consistency...`);
        await sleep(3000);
        const retryStatus = await getStatus(issueKey);
        const retryElapsed = Date.now() - stepStart;

        if (retryStatus.toLowerCase() !== statusBefore.toLowerCase()) {
          console.log(`│  Status after:  "${retryStatus}"`);
          console.log(`└─ ✓ Step ${step.step} passed (${formatDuration(retryElapsed)})\n`);
          results.push({ step: step.step, name: step.name, status: 'passed', elapsed: retryElapsed, statusAfter: retryStatus });
        } else {
          console.log(`│  Status still: "${retryStatus}" — expected: "${step.expectedStatus}"`);
          console.log(`└─ ✗ Step ${step.step} FAILED — status unchanged\n`);
          results.push({ step: step.step, name: step.name, status: 'failed', elapsed: retryElapsed, statusAfter: retryStatus });
          throw new Error(
            `Step ${step.step} (${step.name}) failed: status remained "${retryStatus}", expected "${step.expectedStatus}"`
          );
        }
      }
    } catch (err) {
      const elapsed = Date.now() - stepStart;
      if (!results.find((r) => r.step === step.step)) {
        results.push({ step: step.step, name: step.name, status: 'failed', elapsed, error: err.message });
      }
      console.error(`│  Error: ${err.message}`);
      console.log(`└─ ✗ Step ${step.step} FAILED (${formatDuration(elapsed)})\n`);
      printSummary(issueKey, results, overallStart);
      console.log(`\nTo resume: node jcp-lifecycle.mjs --ticket ${issueKey} --from-step ${step.step}`);
      process.exit(1);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  printSummary(issueKey, results, overallStart);

  // ── Cleanup ───────────────────────────────────────────────────
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

function printSummary(issueKey, results, overallStart) {
  const totalElapsed = Date.now() - overallStart;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log('━━━ Summary ━━━\n');
  console.log(`  Ticket:   ${issueKey} (${JIRA_BASE}/browse/${issueKey})`);
  console.log(`  Steps:    ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`  Duration: ${formatDuration(totalElapsed)}`);
  console.log('');

  // Step-by-step table
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
  if (failed === 0 && results.length === STEPS.length) {
    console.log('  All steps passed! Ticket is now Closed.');
  } else if (failed > 0) {
    const lastFailed = results.find((r) => r.status === 'failed');
    console.log(`  Failed at step ${lastFailed.step} (${lastFailed.name}).`);
  }
}

// ── Entry point ─────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
