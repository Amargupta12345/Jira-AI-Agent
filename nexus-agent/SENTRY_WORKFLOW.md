# Dr. Nexus — Sentry Interactive Workflow

> **Goal:** Give the agent a list of Sentry errors → you pick which ones to solve → the agent solves them end-to-end automatically.

---

## Table of Contents

1. [What the Agent Can Do Today](#1-what-the-agent-can-do-today)
2. [What Is Missing](#2-what-is-missing)
3. [Current Manual Flow (How It Works Now)](#3-current-manual-flow-how-it-works-now)
4. [Target Flow (What You Want)](#4-target-flow-what-you-want)
5. [Gap Analysis — File by File](#5-gap-analysis--file-by-file)
6. [How to Build It — Step by Step](#6-how-to-build-it--step-by-step)
   - [Step 1: Refactor `pollOnce()` to return structured data](#step-1-refactor-pollonce-to-return-structured-data)
   - [Step 2: Create `sentry-select` interactive command](#step-2-create-sentry-select-interactive-command)
   - [Step 3: Add batch Jira creation helper](#step-3-add-batch-jira-creation-helper)
   - [Step 4: Wire everything into `src/index.js`](#step-4-wire-everything-into-srcindexjs)
7. [Complete Code for Each Change](#7-complete-code-for-each-change)
8. [Testing the New Flow](#8-testing-the-new-flow)
9. [Architecture Diagram](#9-architecture-diagram)

---

## 1. What the Agent Can Do Today

The agent is **production-grade** for everything after a Jira ticket exists. The following all work correctly:

| Capability | File | Status |
|---|---|---|
| Poll Sentry for unresolved errors | `src/sentry/poller.js:66` | Works |
| Fetch full issue detail + stack trace | `src/sentry/client.js:132` | Works |
| Auto-map Sentry project → Jira Affected Systems | `src/sentry/jira-creator.js:28` | Works |
| Auto-select Jira fix version from platform tag | `src/sentry/jira-creator.js:70` | Works |
| Create a Jira ticket for one Sentry issue | `src/sentry/poller.js:115` | Works |
| Pick up `nexus`-labeled Jira tickets | `src/index.js:171` | Works |
| Multi-agent council: debate implementation plan | `src/council/` | Works |
| Execute the plan (cheap model) | `src/agent/index.js` | Works |
| Validate result + PR-review council | `src/pipeline/steps.js` | Works |
| Create Azure DevOps PR | `src/service/azure.js` | Works |
| Notify Jira + Slack | `src/notification/` | Works |
| Resume failed run from any step | `src/pipeline/checkpoint.js` | Works |
| Fallback to Codex if Claude rate-limits | `src/ai-provider/strategies/fallback.js` | Works |

**The pipeline is solid.** Once a ticket exists, the agent handles everything autonomously.

---

## 2. What Is Missing

The problem is **the gap between Sentry errors and Jira tickets** — this bridge requires three manual commands today.

| Missing Piece | Impact |
|---|---|
| `pollOnce()` returns a count (number), not a list | You can't programmatically work with the issues |
| No interactive terminal UI to select issues | You must manually copy an issue ID from log output |
| No batch Jira creation | You must run `sentry-jira <ID>` one at a time |
| No single command that does: poll → select → create → process | Multi-terminal manual workflow |

---

## 3. Current Manual Flow (How It Works Now)

```
Terminal 1:
  node src/index.js sentry-poll
  # Output: logs like "[blitzkrieg] 135345 [error] [unresolved] [new] TypeError: Cannot read..."
  # You manually read this and find the ID you want

Terminal 2:
  node src/index.js sentry-jira 135345
  # Creates ONE Jira ticket: JCP-XXXXX

Terminal 3:
  pnpm start
  # Daemon picks up JCP-XXXXX (labeled 'nexus') and solves it
```

**Problems:**
- Three terminals, three commands
- ID must be manually copied from log text
- One ticket at a time
- No visibility into which errors are already in Jira

---

## 4. Target Flow (What You Want)

```
node src/index.js sentry-select

# Output:
# Polling Sentry...
#
# ┌─────────────────────────────────────────────────────────────────┐
# │  SENTRY ISSUES — Select which to solve                          │
# └─────────────────────────────────────────────────────────────────┘
#
#  [1] blitzkrieg   │ error   │ TypeError: Cannot read props of undefined
#                   │ ID: 135345 │ seen 42x │ last: 2026-04-11 │ prod
#
#  [2] convex       │ error   │ MongoServerError: Connection refused
#                   │ ID: 138901 │ seen 10x │ last: 2026-04-10 │ prod
#
#  [3] jetfire      │ warning │ UnhandledPromiseRejection in queue worker
#                   │ ID: 140012 │ seen 5x  │ last: 2026-04-09 │ staging
#
# Enter issue numbers to solve (e.g. 1,3) or 'all', or press Enter to cancel:
# > 1,2

# Creating Jira ticket for blitzkrieg issue 135345...  → JCP-9981
# Creating Jira ticket for convex issue 138901...      → JCP-9982

# 2 ticket(s) created. Starting daemon...
# [daemon] Picking up JCP-9981 (blitzkrieg)...
# [daemon] Picking up JCP-9982 (convex)...
```

**One command. You see the errors, pick numbers, the agent does everything else.**

---

## 5. Gap Analysis — File by File

### `src/sentry/poller.js` — `pollOnce()` (lines 66–106)

**Current code returns:**
```js
return listedIssues; // number (count only)
```

**What it needs to return:**
```js
return {
  issues: [
    {
      num: 1,                    // display number for selection
      id: '135345',              // Sentry issue ID
      service: 'blitzkrieg',     // resolved service name
      title: 'TypeError: ...',   // error title
      level: 'error',            // fatal / error / warning
      status: 'unresolved',
      count: 42,                 // times seen
      lastSeen: '2026-04-11',
      environment: 'production',
      alreadyInJira: false,      // true if state says it's processed
      jiraKey: null,             // JCP-XXXX if already created
    },
    // ...
  ]
}
```

All the raw data already exists in the `issue` objects at line 90 — it's just being logged instead of returned.

---

### `src/sentry/jira-creator.js` — no batch function

**Current:** `createJiraTicket()` handles one issue.  
**Needed:** Loop caller or a thin `createJiraForIssues(config, issueIds)` wrapper in `poller.js`.

The existing `createJiraForIssue()` at `poller.js:115` already works perfectly for one ID. A batch version is just calling it in a loop with progress output.

---

### `src/index.js` — missing `sentry-select` command

**Current commands:**
```
sentry-poll     → pollOnce() → logs count
sentry-jira ID  → createJiraForIssue() → one ticket
```

**Missing command:**
```
sentry-select   → pollOnce (structured) → terminal UI → batch create → start daemon
```

No new file needed. Add one `case 'sentry-select':` block and one helper function.

---

### `src/sentry/index.js` — exports need updating

After refactoring `pollOnce()`, the new return shape must be re-exported from the public API so `src/index.js` can use it.

---

## 6. How to Build It — Step by Step

### Step 1: Refactor `pollOnce()` to return structured data

**File:** `src/sentry/poller.js`

Replace lines 85–105 (the `for` loop and `return listedIssues`) with a version that builds and returns a structured array instead of logging raw data.

**What to change:**
- Build an `issues` array while looping over each service's results
- Each entry gets: `id`, `service`, `title`, `level`, `status`, `count`, `lastSeen`, `environment`, `alreadyInJira`, `jiraKey`
- Pull `environment` from `issue.tags` or default to service config's `environments[0]`
- Pull `alreadyInJira` from `isProcessed(state, issueId)` — already called at line 92
- Return `{ issues }` instead of the count

The log lines can stay — they help with debugging. Just also build the structured object.

---

### Step 2: Create `sentry-select` interactive command

**File:** `src/index.js`

Add a new async function `runSentrySelect(config)` that:

1. Calls `pollSentryOnce(config)` → gets `{ issues }`
2. Prints a formatted table to `process.stdout`
3. Reads a line from `process.stdin` — no new npm package needed, Node.js `readline` is built-in
4. Parses the input as comma-separated numbers or `'all'`
5. Calls `createJiraForIssue(config, id)` for each selected issue
6. Prints the resulting Jira ticket keys
7. Asks: "Start daemon now? (y/n)" — if yes, calls `runDaemon(config)`

**No new npm dependencies required.** Node.js built-in `readline` handles the interactive input.

---

### Step 3: Add batch Jira creation helper

**File:** `src/sentry/poller.js`

Add `createJiraForIssues(config, issueIds)`:

```js
export async function createJiraForIssues(config, issueIds) {
  const results = [];
  for (const id of issueIds) {
    const result = await createJiraForIssue(config, id);
    results.push({ id, ...result });
  }
  return results;
}
```

Export it from `src/sentry/index.js`.

---

### Step 4: Wire everything into `src/index.js`

Add:
1. Import `createJiraForIssues` from `./sentry/index.js`
2. Add `case 'sentry-select':` to the switch
3. Update `printUsage()` to document the new command

---

## 7. Complete Code for Each Change

### Change A — `src/sentry/poller.js`: refactor `pollOnce()`

Replace the existing `pollOnce` function (lines 66–106) with:

```js
/**
 * Poll all configured Sentry services once.
 * Returns structured data for interactive selection.
 *
 * @param {object} config
 * @returns {{ issues: object[] }}
 */
export async function pollOnce(config) {
  const sentryConfig = config.sentry;

  if (!sentryConfig?.authToken) {
    throw new Error('Sentry not configured: sentry.authToken is missing in config.json');
  }
  if (!sentryConfig?.orgSlug) {
    throw new Error('Sentry not configured: sentry.orgSlug is missing in config.json');
  }

  const services = sentryConfig.services || {};
  const serviceNames = Object.keys(services);

  if (serviceNames.length === 0) {
    warn('[sentry:poller] No services configured under sentry.services — nothing to poll');
    return { issues: [] };
  }

  const state = loadState(config);
  const issues = [];
  let num = 1;

  for (const [serviceName, serviceConf] of Object.entries(services)) {
    const rawIssues = await fetchServiceIssues(config, serviceName, serviceConf);

    for (const issue of rawIssues) {
      const issueId = String(issue.id);
      const alreadyInJira = isProcessed(state, issueId);
      const jiraKey = state.meta?.[issueId]?.ticketKey || null;
      const marker = alreadyInJira ? 'processed' : 'new';
      const status = issue.status || 'unknown';
      const level = issue.level || 'unknown';

      // Keep the log line for debugging
      log(`[sentry:poller] [${serviceName}] ${issueId} [${level}] [${status}] [${marker}] ${issue.title}`);

      // Resolve environment from tags or service config
      const envTag = issue.tags?.find?.((t) => t.key === 'environment')?.value
        || serviceConf.environments?.[0]
        || 'production';

      issues.push({
        num: num++,
        id: issueId,
        service: serviceName,
        title: issue.title || '(no title)',
        level,
        status,
        count: issue.count || 0,
        lastSeen: issue.lastSeen ? issue.lastSeen.slice(0, 10) : 'unknown',
        environment: envTag,
        alreadyInJira,
        jiraKey,
      });
    }
  }

  return { issues };
}
```

---

### Change B — `src/sentry/poller.js`: add `createJiraForIssues()`

Add after the existing `createJiraForIssue` function (after line 143):

```js
/**
 * Create Jira tickets for multiple Sentry issue IDs in sequence.
 *
 * @param {object} config
 * @param {string[]} issueIds
 * @returns {Promise<Array<{ id: string, success: boolean, ticketKey: string|null }>>}
 */
export async function createJiraForIssues(config, issueIds) {
  const results = [];
  for (const id of issueIds) {
    const result = await createJiraForIssue(config, id);
    results.push({ id, ...result });
  }
  return results;
}
```

---

### Change C — `src/sentry/index.js`: export the new function

```js
// src/sentry/index.js — add createJiraForIssues to the re-export
export { pollOnce, createJiraForIssue, createJiraForIssues, runSentryDaemon } from './poller.js';
```

---

### Change D — `src/index.js`: add `sentry-select` command

**Import line (top of file) — add `createJiraForIssues`:**
```js
import { runSentryDaemon, pollOnce as pollSentryOnce, createJiraForIssue, createJiraForIssues } from './sentry/index.js';
```

**New helper function — add before `main()`:**
```js
import readline from 'readline';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatIssueTable(issues) {
  const lines = [
    '',
    '┌─────────────────────────────────────────────────────────────────┐',
    '│  SENTRY ISSUES — Select which errors to solve                   │',
    '└─────────────────────────────────────────────────────────────────┘',
    '',
  ];

  if (issues.length === 0) {
    lines.push('  No unresolved Sentry issues found.');
    return lines.join('\n');
  }

  for (const issue of issues) {
    const badge = issue.alreadyInJira ? ` [→ ${issue.jiraKey}]` : '';
    const levelTag = issue.level === 'fatal' ? 'FATAL' : issue.level === 'error' ? 'error' : 'warn ';
    lines.push(
      `  [${String(issue.num).padStart(2)}] ${issue.service.padEnd(14)} │ ${levelTag} │ ${issue.title.substring(0, 60)}${badge}`
    );
    lines.push(
      `       ID: ${issue.id.padEnd(10)} │ seen ${String(issue.count).padStart(4)}x │ last: ${issue.lastSeen} │ ${issue.environment}`
    );
    lines.push('');
  }

  return lines.join('\n');
}

async function runSentrySelect(config) {
  log('[sentry:select] Polling all configured Sentry services...');
  const { issues } = await pollSentryOnce(config);

  console.log(formatIssueTable(issues));

  if (issues.length === 0) {
    return;
  }

  const newIssues = issues.filter((i) => !i.alreadyInJira);
  if (newIssues.length === 0) {
    log('[sentry:select] All issues already have Jira tickets.');
    return;
  }

  const answer = await prompt(
    `Enter issue numbers to solve (e.g. 1,3), 'all' for all new, or Enter to cancel:\n> `
  );

  if (!answer) {
    log('[sentry:select] Cancelled.');
    return;
  }

  let selected;
  if (answer.toLowerCase() === 'all') {
    selected = newIssues;
  } else {
    const nums = answer.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    selected = issues.filter((i) => nums.includes(i.num) && !i.alreadyInJira);

    const alreadyPicked = issues.filter((i) => nums.includes(i.num) && i.alreadyInJira);
    for (const issue of alreadyPicked) {
      warn(`[sentry:select] Issue ${issue.id} (${issue.service}) already has Jira ticket ${issue.jiraKey} — skipping`);
    }
  }

  if (selected.length === 0) {
    warn('[sentry:select] No new issues selected.');
    return;
  }

  log(`[sentry:select] Creating ${selected.length} Jira ticket(s)...`);
  console.log('');

  const results = await createJiraForIssues(config, selected.map((i) => i.id));

  const created = [];
  for (const r of results) {
    const issue = selected.find((i) => i.id === r.id);
    if (r.success) {
      ok(`  ${issue.service} issue ${r.id}  →  ${r.ticketKey}`);
      created.push(r.ticketKey);
    } else {
      warn(`  ${issue.service} issue ${r.id}  →  FAILED (check logs)`);
    }
  }

  console.log('');
  if (created.length === 0) {
    warn('[sentry:select] No tickets were created successfully.');
    return;
  }

  ok(`[sentry:select] ${created.length} ticket(s) created: ${created.join(', ')}`);
  console.log('');

  const startNow = await prompt('Start daemon now to process these tickets? (y/n): ');
  if (startNow.toLowerCase() === 'y' || startNow.toLowerCase() === 'yes') {
    await runDaemon(config);
  } else {
    log(`[sentry:select] Run "pnpm start" when ready to process.`);
  }
}
```

**Add to the switch block in `main()` — after `sentry-jira` case:**
```js
case 'sentry-select':
  await runSentrySelect(config);
  break;
```

**Update `printUsage()`:**
```
  sentry-select               Poll Sentry, pick issues interactively, create Jira + run
```

---

## 8. Testing the New Flow

### Before you implement — verify current state works:

```bash
# Should list issues in log output (current behaviour)
node src/index.js sentry-poll

# Should create one ticket (current behaviour)
node src/index.js sentry-jira <ISSUE-ID>
```

### After implementing — test each piece:

```bash
# 1. Test structured data (add a temporary console.log to verify the return shape)
node -e "
import('./src/sentry/index.js').then(async m => {
  const { loadConfig } = await import('./src/utils/config.js');
  const config = loadConfig();
  const result = await m.pollOnce(config);
  console.log(JSON.stringify(result.issues.slice(0, 2), null, 2));
});
"

# 2. Test batch creation (dry run — check without alreadyInJira guard)
node src/index.js sentry-poll   # confirm issues show

# 3. Test full interactive flow
node src/index.js sentry-select
```

### What good output looks like:

```
[sentry:select] Polling all configured Sentry services...
[sentry:poller] Polling service: blitzkrieg (project: blitzkrieg)
[sentry:poller] 3 issue(s) returned for blitzkrieg

┌─────────────────────────────────────────────────────────────────┐
│  SENTRY ISSUES — Select which errors to solve                   │
└─────────────────────────────────────────────────────────────────┘

  [ 1] blitzkrieg      │ error │ TypeError: Cannot read properties of undefined
       ID: 135345      │ seen   42x │ last: 2026-04-11 │ production

  [ 2] blitzkrieg      │ warn  │ Slow DB query: aggregation pipeline exceeded 2s
       ID: 135400      │ seen    8x │ last: 2026-04-10 │ production

  [ 3] convex          │ error │ MongoServerError: connection pool timeout [→ JCP-9880]
       ID: 138901      │ seen   10x │ last: 2026-04-10 │ production

Enter issue numbers to solve (e.g. 1,3), 'all' for all new, or Enter to cancel:
> 1

Creating 1 Jira ticket(s)...

  blitzkrieg issue 135345  →  JCP-9981

1 ticket(s) created: JCP-9981

Start daemon now to process these tickets? (y/n): y
== NEXUS v2 ==
[daemon] Picking up JCP-9981...
```

---

## 9. Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                       sentry-select command                         │
└────────────────────────┬───────────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  pollOnce(config)      │  src/sentry/poller.js
            │  returns { issues[] }  │  ← CHANGE: was returning number
            └────────────┬───────────┘
                         │  structured list of all Sentry errors
                         ▼
            ┌────────────────────────┐
            │  formatIssueTable()    │  src/index.js
            │  print numbered list   │
            └────────────┬───────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  readline prompt()     │  built-in Node.js
            │  user enters: "1,3"    │
            └────────────┬───────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │ createJiraForIssues()  │  src/sentry/poller.js
            │  loops → 2 tickets     │  ← NEW: batch helper
            └────────────┬───────────┘
                         │  JCP-9981, JCP-9982 (labeled 'nexus')
                         ▼
            ┌────────────────────────┐
            │  runDaemon(config)     │  src/index.js
            │  polls Jira for nexus  │  ← EXISTING: no change needed
            └────────────┬───────────┘
                         │
                         ▼
       ┌─────────────────────────────────┐
       │        Pipeline (8 steps)       │  src/pipeline/
       │  1. Fetch ticket                │
       │  2. Validate                    │
       │  3. Clone repo                  │
       │  4. Council: debate plan  🧠    │
       │  5. Execute: write code   🤖    │
       │  6. Validate + PR review  ✅    │
       │  7. Ship: create PR       🚀    │
       │  8. Notify Jira + Slack   📢    │
       └─────────────────────────────────┘
```

---

## Summary of Changes

| File | Lines | Change | Effort |
|---|---|---|---|
| `src/sentry/poller.js` | 66–106 | Refactor `pollOnce()` to return `{ issues[] }` | ~30 lines |
| `src/sentry/poller.js` | end of file | Add `createJiraForIssues()` batch helper | ~15 lines |
| `src/sentry/index.js` | exports | Add `createJiraForIssues` to re-exports | 1 line |
| `src/index.js` | top | Add `readline` import + `createJiraForIssues` import | 2 lines |
| `src/index.js` | new function | Add `prompt()`, `formatIssueTable()`, `runSentrySelect()` | ~80 lines |
| `src/index.js` | switch | Add `case 'sentry-select':` | 3 lines |
| `src/index.js` | `printUsage()` | Document new command | 1 line |

**Total: ~130 lines across 4 files. No new npm dependencies. No new files.**

The rest of the agent — council, execution, validation, PR creation, notifications — is already built and does not need to change.
