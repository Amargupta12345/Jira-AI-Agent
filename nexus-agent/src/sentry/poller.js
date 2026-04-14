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
 * Poll all configured Sentry services once.
 * Returns structured data suitable for interactive selection.
 *
 * @param {object} config - Full Dr. Nexus config (must have config.sentry)
 * @returns {{ issues: object[] }} Structured list of all Sentry issues found
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

    if (rawIssues.length === 0) {
      log(`[sentry:poller] No issues for ${serviceName}`);
      continue;
    }

    for (const issue of rawIssues) {
      const issueId = String(issue.id);
      const alreadyInJira = isProcessed(state, issueId);
      const jiraKey = state.meta?.[issueId]?.ticketKey || null;
      const marker = alreadyInJira ? 'processed' : 'new';
      const status = issue.status || 'unknown';
      const level = issue.level || 'unknown';

      // Keep the debug log line
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
