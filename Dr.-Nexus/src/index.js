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
import { runSentryDaemon, pollOnce as pollSentryOnce, createJiraForIssue } from './sentry/index.js';
import { log, ok, warn, err } from './utils/logger.js';
import * as logger from './utils/logger.js';

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function runSingle(config, ticketKey) {
  log(`Processing ticket ${ticketKey}...`);
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

function printUsage() {
  console.log(`
== Dr. Asthana v2 ==

Usage:
  node src/index.js <command> [options]

Commands:
  daemon                      Run the poll loop continuously
  single <KEY>                Process one specific ticket (e.g., single JCP-123)
  dry-run                     Poll once, show ticket details, don't execute
  resume <KEY> --from-step=N  Resume a failed run from a specific step
  create-pr <KEY>             Create/retry PR only from checkpoint data
  sentry-daemon               Run Sentry alert polling daemon (list issues only)
  sentry-poll                 Poll Sentry once and list issues
  sentry-jira <ISSUE-ID>      Create Jira ticket for one chosen Sentry issue

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

  const config = loadConfig();

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

    case 'sentry-daemon':
      await runSentryDaemon(config);
      break;

    case 'sentry-poll': {
      log('[sentry] Running one-shot poll...');
      const listed = await pollSentryOnce(config);
      ok(`[sentry] Done. ${listed} issue(s) listed.`);
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
