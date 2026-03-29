/**
 * Sentry alert poller.
 *
 * For each configured service, fetches Sentry issues and prints them for
 * operator review. Jira creation is handled separately via a per-issue command.
 */

import { fetchIssues, fetchIssueDetail, fetchLatestEvent } from './client.js';
import { loadState, isProcessed, markProcessed } from './state.js';
import { createJiraTicket } from './jira-creator.js';
import { log, ok, warn } from '../utils/logger.js';

function resolveServiceEntry(config, projectSlug) {
  const services = config.sentry?.services || {};
  for (const [serviceName, serviceConf] of Object.entries(services)) {
    if (serviceConf.projectSlug === projectSlug || serviceName === projectSlug) {
      return { serviceName, serviceConf };
    }
  }
  return null;
}

async function fetchServiceIssues(config, serviceName, serviceConf) {
  const {
    projectSlug,
    environments = [],
    minLevel = 'error',
    issueStatus = 'unresolved',
    limit = 25,
  } = serviceConf;

  if (!projectSlug) {
    warn(`[sentry:poller] Service "${serviceName}" has no projectSlug — skipping`);
    return [];
  }

  log(`[sentry:poller] Polling service: ${serviceName} (project: ${projectSlug})`);

  let issues = await fetchIssues(config, projectSlug, {
    environments,
    minLevel,
    issueStatus,
    limit,
  });

  if (issues.length === 0 && environments.length > 0) {
    warn(`[sentry:poller] No issues returned for ${serviceName} with environments [${environments.join(', ')}]; retrying without environment filter`);
    issues = await fetchIssues(config, projectSlug, {
      environments: [],
      minLevel,
      issueStatus,
      limit,
    });
  }

  log(`[sentry:poller] ${issues.length} issue(s) returned for ${serviceName}`);
  return issues;
}

/**
 * Poll all configured Sentry services once and list issues for operator review.
 *
 * @param {object} config - Full Dr. Nexus config (must have config.sentry)
 * @returns {number} Count of issues listed this cycle
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
    return 0;
  }

  const state = loadState(config);
  let listedIssues = 0;

  for (const [serviceName, serviceConf] of Object.entries(services)) {
    const issues = await fetchServiceIssues(config, serviceName, serviceConf);
    let visibleCount = 0;
    for (const issue of issues) {
      const issueId = String(issue.id);
      const marker = isProcessed(state, issueId) ? 'processed' : 'new';
      const status = issue.status || 'unknown';
      const level = issue.level || 'unknown';
      log(`[sentry:poller] [${serviceName}] ${issueId} [${level}] [${status}] [${marker}] ${issue.title}`);
      visibleCount++;
      listedIssues++;
    }

    if (visibleCount === 0) {
      log(`[sentry:poller] No new issues for ${serviceName}`);
    }
  }

  return listedIssues;
}

/**
 * Create a Jira ticket for one specific Sentry issue ID.
 *
 * @param {object} config
 * @param {string|number} issueId
 * @returns {Promise<{success: boolean, ticketKey: string|null}>}
 */
export async function createJiraForIssue(config, issueId) {
  const normalizedIssueId = String(issueId);
  const state = loadState(config);

  if (isProcessed(state, normalizedIssueId)) {
    warn(`[sentry:poller] Issue ${normalizedIssueId} is already marked as processed in local state`);
    return { success: false, ticketKey: null };
  }

  const issue = await fetchIssueDetail(config, normalizedIssueId);
  if (!issue) {
    warn(`[sentry:poller] Could not fetch Sentry issue ${normalizedIssueId}`);
    return { success: false, ticketKey: null };
  }

  const event = await fetchLatestEvent(config, normalizedIssueId);
  const projectSlug = issue.project?.slug || 'unknown';
  const serviceEntry = resolveServiceEntry(config, projectSlug);
  const serviceName = serviceEntry?.serviceName || projectSlug;
  const jiraProject = serviceEntry?.serviceConf?.jiraProject || 'JCP';

  const result = await createJiraTicket(config, issue, event, serviceName, jiraProject);
  if (result.success) {
    markProcessed(config, state, normalizedIssueId, result.ticketKey);
    ok(`[sentry:poller] ${serviceName} issue ${normalizedIssueId} → Jira ${result.ticketKey}`);
  }

  return result;
}
