/**
 * Sentry REST API wrapper.
 *
 * Docs: https://docs.sentry.io/api/
 * Auth: Bearer token via config.sentry.authToken
 *
 * TLS: The self-hosted Sentry instance uses an internal corporate certificate.
 * NODE_TLS_REJECT_UNAUTHORIZED is disabled here to allow connections to succeed.
 * The Node.js console warning for this flag is suppressed.
 */

import { log, warn } from '../utils/logger.js';

// Suppress the Node.js TLS warning and disable cert verification for the
// self-hosted Sentry instance (same pattern as sentry-alert/lib/api.mjs).
{
  const _emit = process.emitWarning.bind(process);
  process.emitWarning = (msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
    _emit(msg, ...rest);
  };
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * Fetch JSON from Sentry API. Throws on non-OK responses.
 */
async function fetchSentry(config, apiPath, options = {}) {
  const url = `${config.sentry.baseUrl}/api/0${apiPath}`;

  const response = await fetch(url, {
    method: 'GET',
    ...options,
    headers: {
      Authorization: `Bearer ${config.sentry.authToken}`,
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sentry API ${response.status} ${apiPath}: ${text.substring(0, 300)}`);
  }

  return response.json();
}

function normalizeIssueList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  if (result && Array.isArray(result.issues)) return result.issues;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && typeof result === 'object') {
    const values = Object.values(result);
    if (values.every((value) => value && typeof value === 'object')) {
      return values;
    }
  }
  return [];
}

/**
 * Fetch issues for a Sentry project.
 *
 * @param {object} config
 * @param {string} projectSlug  - Sentry project slug (e.g. "blitzkrieg")
 * @param {object} opts
 * @param {string[]} opts.environments - Filter by environment (e.g. ["production"])
 * @param {string}   opts.minLevel     - Minimum level: "fatal"|"error"|"warning" (default: "error")
 * @param {string}   opts.issueStatus  - "unresolved" (default) or "all"
 * @param {number}   opts.limit        - Max issues to fetch (default: 25)
 * @returns {object[]} Array of Sentry issue objects
 */
export async function fetchIssues(config, projectSlug, opts = {}) {
  const { environments = [], minLevel = 'error', issueStatus = 'unresolved', limit = 25 } = opts;
  const orgSlug = config.sentry.orgSlug;
  const normalizedStatus = String(issueStatus || 'unresolved').toLowerCase();
  const queryParts = [];

  if (normalizedStatus === 'unresolved') {
    queryParts.push('is:unresolved');
  }
  queryParts.push(`level:${minLevel}`);

  const params = new URLSearchParams({
    query: queryParts.join(' '),
    sort: 'date',
    limit: String(limit),
  });

  for (const env of environments) {
    params.append('environment', env);
  }

  const apiPath = `/projects/${orgSlug}/${projectSlug}/issues/?${params.toString()}`;
  log(`[sentry:client] Fetching issues for ${projectSlug} (${params.get('query')})`);

  try {
    const result = await fetchSentry(config, apiPath);
    return normalizeIssueList(result);
  } catch (error) {
    warn(`[sentry:client] fetchIssues(${projectSlug}) failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch the latest event for a Sentry issue.
 * The latest event includes the full stack trace, tags, and context.
 *
 * @param {object} config
 * @param {string} issueId - Sentry numeric issue ID
 * @returns {object|null} Sentry event object, or null on failure
 */
export async function fetchLatestEvent(config, issueId) {
  try {
    return await fetchSentry(config, `/issues/${issueId}/events/latest/`);
  } catch (error) {
    warn(`[sentry:client] fetchLatestEvent(${issueId}) failed: ${error.message}`);
    return null;
  }
}

/**
 * Fetch full issue details by ID.
 *
 * @param {object} config
 * @param {string} issueId
 * @returns {object|null}
 */
export async function fetchIssueDetail(config, issueId) {
  try {
    return await fetchSentry(config, `/issues/${issueId}/`);
  } catch (error) {
    warn(`[sentry:client] fetchIssueDetail(${issueId}) failed: ${error.message}`);
    return null;
  }
}

/**
 * Verify Sentry auth token is valid by calling /api/0/auth/.
 * Returns { valid: boolean, user: string|null }.
 */
export async function verifyAuth(config) {
  try {
    const data = await fetchSentry(config, '/auth/');
    return { valid: true, user: data.user?.name || data.user?.email || null };
  } catch (error) {
    return { valid: false, user: null, error: error.message };
  }
}
