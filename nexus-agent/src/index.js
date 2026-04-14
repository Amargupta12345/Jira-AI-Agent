#!/usr/bin/env node

/**
 * NEXUS v2 - CLI Entry Point
 *
 * Commands:
 *   daemon                      Run the poll loop continuously
 *   single <KEY>                Process one specific ticket
 *   dry-run                     Poll once, log what would happen, don't execute
 *   resume <KEY> --from-step=N  Resume a failed run from a specific step
 *   create-pr <KEY>             Create/retry PR only from checkpoint data
 *   sentry-jira <ISSUE-ID>      Create Jira ticket for one chosen Sentry issue
 */

import { loadConfig } from './utils/config.js';
import { getTicketDetails, parseTicket, displayTicketDetails, searchTickets } from './jira/index.js';
import { runPipeline, resume as resumePipeline, createPrFromCheckpoint } from './pipeline/index.js';
import { getProviderLabel } from './ai-provider/index.js';
import { runSentryDaemon, runSentryAgent, pollOnce as pollSentryOnce, createJiraForIssue, createJiraForIssues } from './sentry/index.js';
import readline from 'readline';
import { createMultiPR } from './service/multi-pr.js';
import { log, ok, warn, err } from './utils/logger.js';
import * as logger from './utils/logger.js';

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function runSingle(config, ticketKey) {
  log(`Processing ticket ${ticketKey}...`);
  log(`AI Provider:      ${getProviderLabel(config)}`);
  log('');
  try {
    await runPipeline(config, ticketKey);
  } catch (error) {
    err(`Failed to process ${ticketKey}: ${error.message}`);
    process.exit(1);
  }
}

async function runDryRun(config) {
  log('DRY RUN MODE - No changes will be made');
  log('');

  try {
    const jql = `labels = "${config.jira.label}" ORDER BY priority DESC`;
    const fields = ['summary', 'description', 'comment', 'issuetype', 'priority', 'status', 'labels', config.jira.fields.affectedSystems, config.jira.fields.fixVersions];
    const tickets = await searchTickets(jql, config.agent.maxTicketsPerCycle, fields);

    if (tickets.length === 0) {
      log('No tickets found matching criteria');
      return;
    }

    log(`\nFound ${tickets.length} ticket(s) to process:\n`);

    for (const ticket of tickets) {
      const rawTicket = await getTicketDetails(config, ticket.key);
      const parsed = parseTicket(config, rawTicket);
      displayTicketDetails(parsed, logger);
    }
  } catch (error) {
    err(`Dry run failed: ${error.message}`);
    process.exit(1);
  }
}

async function runDaemon(config) {
  log('== NEXUS v2 ==');
  log('');
  log(`Poll interval:    ${config.agent.pollInterval}s`);
  log(`Max per cycle:    ${config.agent.maxTicketsPerCycle}`);
  log(`AI Provider:      ${getProviderLabel(config)}`);
  log(`Label:            ${config.jira.label}`);
  log(`Services:         ${Object.keys(config.services).join(', ')}`);
  log('');

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    try {
      log(`Checking for new patients (cycle ${cycleCount})...`);
      const jql = `labels = "${config.jira.label}" ORDER BY priority DESC`;
      const fields = ['summary', 'description', 'comment', 'issuetype', 'priority', 'status', 'labels', config.jira.fields.affectedSystems, config.jira.fields.fixVersions];
      const tickets = await searchTickets(jql, config.agent.maxTicketsPerCycle, fields);

      if (tickets.length === 0) {
        log('No patients waiting. Shutting down.');
        break;
      }

      for (const ticket of tickets) {
        await runPipeline(config, ticket);
      }
    } catch (error) {
      err(`Poll cycle failed: ${error.message}`);
    }

    log(`\nCycle ${cycleCount} done. Checking again in ${config.agent.pollInterval}s...\n`);
    await sleep(config.agent.pollInterval);
  }
}

async function runResume(config, ticketKey, fromStep) {
  log(`Resuming ${ticketKey} from step ${fromStep}...`);
  log(`AI Provider:      ${getProviderLabel(config)}`);
  log('');
  try {
    await resumePipeline(config, ticketKey, fromStep);
  } catch (error) {
    err(`Failed to resume ${ticketKey}: ${error.message}`);
    process.exit(1);
  }
}

async function runCreatePr(config, ticketKey) {
  log(`Creating PR only for ${ticketKey} from checkpoint...`);
  try {
    const result = await createPrFromCheckpoint(config, ticketKey);
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    err(`Failed to create PR for ${ticketKey}: ${error.message}`);
    process.exit(1);
  }
}

async function runSentryJira(config, issueId) {
  log(`[sentry] Creating Jira ticket for issue ${issueId}...`);
  try {
    const result = await createJiraForIssue(config, issueId);
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    err(`Failed to create Jira ticket for issue ${issueId}: ${error.message}`);
    process.exit(1);
  }
}

// ── sentry-select ─────────────────────────────────────────────────────────────

function rlPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── AI provider selector ───────────────────────────────────────────────────────

async function selectAiProvider(config) {
  const current = config.aiProvider?.execute?.provider || 'claude';
  const answer = await rlPrompt(
    `\nAI Provider:  [1] Claude  [2] Codex  (Enter = ${current})\n> `
  );

  const normalised = answer.trim().toLowerCase();
  let provider;
  if (normalised === '2' || normalised === 'codex') {
    provider = 'codex';
  } else if (normalised === '1' || normalised === 'claude' || !normalised) {
    provider = 'claude';
  } else {
    provider = current;
  }

  const other = provider === 'claude' ? 'codex' : 'claude';

  // Patch execute
  if (config.aiProvider?.execute) {
    config.aiProvider.execute.provider = provider;
    config.aiProvider.execute.fallbackProvider = other;
  }

  // Patch council + prReviewCouncil
  for (const key of ['council', 'prReviewCouncil']) {
    const c = config[key];
    if (!c) continue;
    for (const role of [c.proposer, c.evaluator, ...(c.critics || [])]) {
      if (!role) continue;
      role.provider = provider;
      role.fallbackProvider = other;
    }
  }

  const label = provider === 'codex' ? 'Codex (gpt-5.4)' : `Claude (${config.aiProvider?.execute?.claude?.model || 'sonnet'})`;
  ok(`Provider: ${label}`);
  log('');

  return config;
}

// ──────────────────────────────────────────────────────────────────────────────

const LEVEL_LABEL = { fatal: 'FATAL', error: 'error', warning: 'warn ', info: 'info ' };
const LEVEL_ORDER = { fatal: 0, error: 1, warning: 2, info: 3 };

function formatSentryTable(issues) {
  const lines = [
    '',
    '┌─────────────────────────────────────────────────────────────────────┐',
    '│  SENTRY ISSUES — Select which errors to solve                       │',
    '└─────────────────────────────────────────────────────────────────────┘',
    '',
  ];

  if (issues.length === 0) {
    lines.push('  No unresolved Sentry issues found across configured services.');
    return lines.join('\n');
  }

  // Sort: unprocessed first, then by severity
  const sorted = [...issues].sort((a, b) => {
    if (a.alreadyInJira !== b.alreadyInJira) return a.alreadyInJira ? 1 : -1;
    return (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9);
  });

  // Rebuild display numbers after sort
  sorted.forEach((issue, i) => { issue.num = i + 1; });

  for (const issue of sorted) {
    const badge    = issue.alreadyInJira ? ` \x1b[2m[→ ${issue.jiraKey}]\x1b[0m` : '';
    const levelStr = LEVEL_LABEL[issue.level] || issue.level.substring(0, 5).padEnd(5);
    const title    = issue.title.substring(0, 62);
    const dimLine  = `\x1b[2m`;
    const reset    = `\x1b[0m`;

    lines.push(`  [${String(issue.num).padStart(2)}] ${issue.service.padEnd(14)} │ ${levelStr} │ ${title}${badge}`);
    lines.push(`       ${dimLine}ID: ${issue.id.padEnd(10)} │ seen ${String(issue.count).padStart(5)}x │ last: ${issue.lastSeen} │ ${issue.environment}${reset}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function runSentrySelect(config) {
  log('[sentry:select] Polling all configured Sentry services...');

  let issues;
  try {
    ({ issues } = await pollSentryOnce(config));
  } catch (error) {
    err(`[sentry:select] Poll failed: ${error.message}`);
    process.exit(1);
  }

  console.log(formatSentryTable(issues));

  if (issues.length === 0) return;

  const newIssues = issues.filter((i) => !i.alreadyInJira);
  if (newIssues.length === 0) {
    ok('[sentry:select] All issues already have Jira tickets. Nothing to create.');
    return;
  }

  const answer = await rlPrompt(
    `Enter issue numbers to create Jira tickets (e.g. 1,3), "all" for all new, or Enter to cancel:\n> `
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

    // Warn about already-ticketed issues they tried to pick
    const alreadyPicked = issues.filter((i) => nums.includes(i.num) && i.alreadyInJira);
    for (const issue of alreadyPicked) {
      warn(`[sentry:select] Issue ${issue.id} (${issue.service}) already has Jira ticket ${issue.jiraKey} — skipping`);
    }
  }

  if (selected.length === 0) {
    warn('[sentry:select] No new issues selected.');
    return;
  }

  log(`\n[sentry:select] Creating ${selected.length} Jira ticket(s)...\n`);

  const results = await createJiraForIssues(config, selected.map((i) => i.id));

  const created = [];
  for (const r of results) {
    const issue = selected.find((i) => i.id === r.id);
    if (r.success) {
      ok(`  ${(issue?.service || r.id).padEnd(14)}  issue ${r.id}  →  ${r.ticketKey}`);
      created.push(r.ticketKey);
    } else {
      warn(`  ${(issue?.service || r.id).padEnd(14)}  issue ${r.id}  →  FAILED`);
    }
  }

  console.log('');

  if (created.length === 0) {
    warn('[sentry:select] No tickets were created successfully.');
    return;
  }

  ok(`[sentry:select] ${created.length} ticket(s) created: ${created.join(', ')}`);
  console.log('');

  const startNow = await rlPrompt('Start NEXUS daemon now to process these tickets? (y/n): ');
  if (startNow.toLowerCase() === 'y' || startNow.toLowerCase() === 'yes') {
    await runDaemon(config);
  } else {
    log('[sentry:select] Run "pnpm start" or "nexus daemon" when ready to process.');
  }
}

function printUsage() {
  console.log(`
== Nexus Agent ==

Usage:
  node src/index.js <command> [options]

Commands:
  daemon                                Run the poll loop continuously
  single <KEY>                          Process one specific ticket (e.g., single JCP-123)
  dry-run                               Poll once, show ticket details, don't execute
  resume <KEY> --from-step=N            Resume a failed run from a specific step
  create-pr <KEY>                       Create/retry PR only from checkpoint data
  multi-pr <KEY> [--branch <b>]         Create PRs for all fix versions on a Jira ticket
             [--repo <repo>]
  sentry-agent                          Autonomous: poll Sentry → auto-create Jira tickets → Dr. Nexus fixes
  sentry-select                         Interactive: poll Sentry, pick errors, create tickets + run daemon
  sentry-poll                           Poll Sentry once and list all issues
  sentry-jira <ISSUE-ID>                Create Jira ticket for one specific Sentry issue ID
  sentry-daemon                         Run Sentry alert polling daemon (list issues only, no auto-action)

Configuration:
  Edit config.json in the project root.
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  let config = loadConfig();

  config = await selectAiProvider(config);

  switch (command) {
    case 'daemon':
      await runDaemon(config);
      break;

    case 'single': {
      const ticketKey = args[1];
      if (!ticketKey) {
        err('Missing ticket key. Usage: single <TICKET-KEY>');
        process.exit(1);
      }
      await runSingle(config, ticketKey);
      break;
    }

    case 'dry-run':
      await runDryRun(config);
      break;

    case 'resume': {
      const ticketKey = args[1];
      if (!ticketKey) {
        err('Missing ticket key. Usage: resume <TICKET-KEY> --from-step=N');
        process.exit(1);
      }
      const fromStepArg = args.find(a => a.startsWith('--from-step='));
      const fromStep = fromStepArg ? parseInt(fromStepArg.split('=')[1], 10) : 5;
      await runResume(config, ticketKey, fromStep);
      break;
    }

    case 'create-pr': {
      const ticketKey = args[1];
      if (!ticketKey) {
        err('Missing ticket key. Usage: create-pr <TICKET-KEY>');
        process.exit(1);
      }
      await runCreatePr(config, ticketKey);
      break;
    }

    case 'multi-pr': {
      const ticketKey = args[1];
      if (!ticketKey) {
        err('Missing ticket key. Usage: multi-pr <TICKET-KEY> [--branch <branch>] [--repo <repo>]');
        process.exit(1);
      }
      const branchArg = args.find(a => a.startsWith('--branch='))?.split('=')[1]
        ?? (args.includes('--branch') ? args[args.indexOf('--branch') + 1] : undefined);
      const repoArg = args.find(a => a.startsWith('--repo='))?.split('=')[1]
        ?? (args.includes('--repo') ? args[args.indexOf('--repo') + 1] : undefined);
      await createMultiPR(config, ticketKey, {
        sourceBranch: branchArg,
        repo: repoArg,
        cwd: process.cwd(),
      });
      break;
    }

    case 'sentry-agent':
      await runSentryAgent(config);
      break;

    case 'sentry-daemon':
      await runSentryDaemon(config);
      break;

    case 'sentry-poll': {
      log('[sentry] Running one-shot poll...');
      const { issues } = await pollSentryOnce(config);
      ok(`[sentry] Done. ${issues.length} issue(s) listed.`);
      break;
    }

    case 'sentry-jira': {
      const issueId = args[1];
      if (!issueId) {
        err('Missing Sentry issue ID. Usage: sentry-jira <ISSUE-ID>');
        process.exit(1);
      }
      await runSentryJira(config, issueId);
      break;
    }

    case 'sentry-select':
      await runSentrySelect(config);
      break;

    default:
      err(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  err(`Fatal error: ${error.message}`);
  process.exit(1);
});
