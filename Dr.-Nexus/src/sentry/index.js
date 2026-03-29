/**
 * Sentry alert module — public API.
 *
 * Exports:
 *   pollOnce(config)         — Poll all services once, list issue IDs
 *   runSentryDaemon(config)  — Continuous poll loop (list-only)
 *   createJiraForIssue(...)  — Create Jira ticket for one chosen Sentry issue
 *   verifyAuth(config)       — Check Sentry auth token validity
 */

export { pollOnce, createJiraForIssue } from './poller.js';
export { verifyAuth } from './client.js';

import { pollOnce } from './poller.js';
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
      const listed = await pollOnce(config);
      if (listed > 0) {
        ok(`[sentry] Cycle ${cycleCount}: ${listed} issue(s) listed`);
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
