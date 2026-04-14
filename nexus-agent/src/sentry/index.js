/**
 * Sentry alert module — public API.
 *
 * Exports:
 *   pollOnce(config)           — Poll all services once, return structured list
 *   runSentryDaemon(config)    — Continuous poll loop (list-only, no auto-action)
 *   runSentryAgent(config)     — Autonomous agent: poll → auto-create Jira tickets → notify
 *   createJiraForIssue(...)    — Create Jira ticket for one chosen Sentry issue
 *   createJiraForIssues(...)   — Batch Jira ticket creation
 *   verifyAuth(config)         — Check Sentry auth token validity
 */

export { pollOnce, createJiraForIssue, createJiraForIssues } from './poller.js';
export { verifyAuth } from './client.js';

import { pollOnce, createJiraForIssues } from './poller.js';
import { verifyAuth } from './client.js';
import { log, ok, warn, err } from '../utils/logger.js';

/**
 * Run the continuous Sentry alert polling daemon.
 * Polls every config.sentry.pollInterval seconds (default: 300).
 * Lists Sentry issues continuously for operator review.
 *
 * Does not return unless the process is killed.
 *
 * @param {object} config - Full Dr. Nexus config
 */
export async function runSentryDaemon(config) {
  const sentryConfig = config.sentry || {};
  const interval = sentryConfig.pollInterval || 300;
  const services = Object.keys(sentryConfig.services || {});

  log('== NEXUS Sentry Alert Daemon ==');
  log('');
  log(`Org:           ${sentryConfig.orgSlug || '(not set)'}`);
  log(`Services:      ${services.length > 0 ? services.join(', ') : '(none configured)'}`);
  log(`Poll interval: ${interval}s`);
  log('');

  // Verify auth before starting
  log('[sentry] Verifying Sentry auth token...');
  const auth = await verifyAuth(config);
  if (!auth.valid) {
    err(`[sentry] Auth check failed: ${auth.error}`);
    err('[sentry] Check sentry.authToken in config.json');
    process.exit(1);
  }
  ok(`[sentry] Auth OK (user: ${auth.user || 'unknown'})`);
  log('');

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    log(`[sentry] ── Poll cycle ${cycleCount} ──`);

    try {
      const { issues } = await pollOnce(config);
      const count = issues.length;
      if (count > 0) {
        ok(`[sentry] Cycle ${cycleCount}: ${count} issue(s) listed`);
      } else {
        log(`[sentry] Cycle ${cycleCount}: no new issues`);
      }
    } catch (error) {
      err(`[sentry] Cycle ${cycleCount} failed: ${error.message}`);
    }

    log(`[sentry] Next poll in ${interval}s...`);
    log('');
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

/**
 * Autonomous Sentry Agent.
 *
 * Polls Sentry continuously. For every NEW issue at a qualifying severity
 * level, automatically creates a Jira ticket labeled "nexus" so the
 * Dr. Nexus daemon picks it up and fixes it without any manual step.
 *
 * Severity threshold is configurable via config.sentry.agent.autoTicketLevels
 * (default: ["fatal", "error"]).  "warning" issues are logged but skipped.
 *
 * Does not return unless the process is killed.
 *
 * @param {object} config - Full Dr. Nexus config
 */
export async function runSentryAgent(config) {
  const sentryConfig = config.sentry || {};
  const interval    = sentryConfig.pollInterval || 300;
  const services    = Object.keys(sentryConfig.services || {});
  const autoLevels  = sentryConfig.agent?.autoTicketLevels || ['fatal', 'error'];

  log('');
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║              NEXUS — Sentry Agent  (autonomous)             ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log('');
  log(`  Org:            ${sentryConfig.orgSlug || '(not set)'}`);
  log(`  Services:       ${services.length > 0 ? services.join(', ') : '(none configured)'}`);
  log(`  Poll interval:  ${interval}s`);
  log(`  Auto-ticket:    ${autoLevels.join(', ')} level issues`);
  log(`  Skip levels:    everything else (warning / info)`);
  log('');
  log('  New fatal/error issues → Jira ticket (labeled nexus) → Dr. Nexus fixes it');
  log('  Run "nexus daemon" in a second terminal to process tickets automatically.');
  log('');

  log('[sentry:agent] Verifying Sentry auth...');
  const auth = await verifyAuth(config);
  if (!auth.valid) {
    err(`[sentry:agent] Auth failed: ${auth.error}`);
    err('[sentry:agent] Check sentry.authToken in config.json');
    process.exit(1);
  }
  ok(`[sentry:agent] Auth OK  (user: ${auth.user || 'unknown'})`);
  log('');

  let cycleCount   = 0;
  let totalTickets = 0;

  while (true) {
    cycleCount++;
    const timestamp = new Date().toLocaleTimeString();
    log(`[sentry:agent] ── Cycle ${cycleCount}  ${timestamp} ──`);

    try {
      const { issues } = await pollOnce(config);

      const toTicket  = issues.filter(i => !i.alreadyInJira && autoLevels.includes(i.level));
      const toSkip    = issues.filter(i => !i.alreadyInJira && !autoLevels.includes(i.level));
      const alreadyOk = issues.filter(i => i.alreadyInJira);

      log(`[sentry:agent] Total: ${issues.length} | New (will ticket): ${toTicket.length} | Low severity (skip): ${toSkip.length} | Already in Jira: ${alreadyOk.length}`);

      // Log skipped low-severity issues so the operator is aware
      for (const i of toSkip) {
        log(`[sentry:agent]   skip [${i.level}] ${i.service}: ${i.title.substring(0, 70)}`);
      }

      if (toTicket.length > 0) {
        log(`[sentry:agent] Creating ${toTicket.length} Jira ticket(s)...`);
        log('');

        const results = await createJiraForIssues(config, toTicket.map(i => i.id));

        for (const r of results) {
          const issue = toTicket.find(i => i.id === r.id);
          if (r.success) {
            totalTickets++;
            ok(`[sentry:agent]   [${(issue?.level || '?').toUpperCase()}] ${(issue?.service || r.id).padEnd(14)} ${r.id}  →  ${r.ticketKey}`);
          } else {
            warn(`[sentry:agent]   [${(issue?.level || '?').toUpperCase()}] ${(issue?.service || r.id).padEnd(14)} ${r.id}  →  FAILED`);
          }
        }

        log('');
        ok(`[sentry:agent] Cycle ${cycleCount} done. ${toTicket.length} ticket(s) created. Total so far: ${totalTickets}.`);
      } else {
        log(`[sentry:agent] Cycle ${cycleCount}: no new issues to ticket.`);
      }

    } catch (error) {
      err(`[sentry:agent] Cycle ${cycleCount} failed: ${error.message}`);
    }

    log(`[sentry:agent] Next poll in ${interval}s...`);
    log('');
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}
