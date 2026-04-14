/**
 * Jira data layer for weekly reports.
 *
 * Fetches all issues assigned to the current user that were updated within the
 * given week window.  Splits them into resolved vs in-progress and computes
 * summary counters including story-point velocity.
 *
 * Credentials are loaded from jira-creator/jira-config.json — no extra setup needed.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// Disable strict TLS (matches jira-creator/lib/api.mjs behaviour)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ── Config ─────────────────────────────────────────────────────────────────────

function loadConfig() {
  const p = resolve(ROOT, 'jira-creator/jira-config.json');
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    throw new Error(`Cannot read jira-creator/jira-config.json: ${e.message}`);
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function jiraPost(siteUrl, authHeader, path, body) {
  const res = await fetch(`${siteUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira POST ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function adfToText(adf) {
  if (!adf || typeof adf !== 'object') return '';
  if (adf.type === 'text') return adf.text || '';
  const kids = adf.content || [];
  return kids.map(adfToText).join(' ').replace(/\s+/g, ' ').trim();
}

function statusCategory(issue) {
  return issue.fields?.status?.statusCategory?.key || 'unknown';
}

function storyPoints(issue) {
  return issue.fields?.customfield_10016 || 0;
}

function issueSummary(issue) {
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    type: issue.fields?.issuetype?.name || 'Task',
    priority: issue.fields?.priority?.name || 'Medium',
    status: issue.fields?.status?.name || '',
    statusCat: statusCategory(issue),
    sp: storyPoints(issue),
    labels: issue.fields?.labels || [],
    components: (issue.fields?.components || []).map(c => c.name),
    resolutionDate: issue.fields?.resolutiondate?.slice(0, 10) || null,
    updated: issue.fields?.updated?.slice(0, 10) || null,
    resolution: issue.fields?.resolution?.name || null,
  };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Fetch all Jira issues for the current user updated within [fromDate, toDate].
 *
 * @param {Date} fromDate  Start of week (inclusive)
 * @param {Date} toDate    End of week (inclusive)
 * @returns {Promise<JiraWeekData>}
 */
export async function fetchWeeklyJiraData(fromDate, toDate) {
  const cfg = loadConfig();
  const authHeader = `Basic ${Buffer.from(`${cfg.user.email}:${cfg.apiToken}`).toString('base64')}`;
  const siteUrl = cfg.siteUrl;
  const accountId = cfg.user.accountId;

  const fromISO = fromDate.toISOString().slice(0, 10);
  const toISO   = toDate.toISOString().slice(0, 10);

  // All issues assigned to me and updated in the window
  const jql = `assignee = "${accountId}" AND updated >= "${fromISO}" AND updated <= "${toISO}" ORDER BY updated DESC`;

  const fields = [
    'summary', 'status', 'issuetype', 'priority', 'labels', 'components',
    'resolutiondate', 'updated', 'created', 'resolution',
    'customfield_10016',  // Story Points (Dev hours)
    'customfield_10056',  // Affected Systems
    'fixVersions',
  ];

  // Paginate through all results
  const allIssues = [];
  let nextPageToken;
  do {
    const body = { jql, maxResults: 100, fields };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await jiraPost(siteUrl, authHeader, '/rest/api/3/search/jql', body);
    allIssues.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  } while (true);

  // Split into resolved / in-progress
  const resolved   = allIssues.filter(i => {
    if (statusCategory(i) !== 'done') return false;
    const rd = i.fields?.resolutiondate;
    if (!rd) return true; // done but no date → count it
    const d = new Date(rd);
    return d >= fromDate && d <= toDate;
  });

  const inProgress = allIssues.filter(i => {
    const cat = statusCategory(i);
    return cat === 'indeterminate' || cat === 'new';
  });

  // Summaries (lightweight objects for the report)
  const resolvedRows   = resolved.map(issueSummary);
  const inProgressRows = inProgress.map(issueSummary);
  const allRows        = allIssues.map(issueSummary);

  // Breakdowns
  const byType     = countBy(allRows, r => r.type);
  const byPriority = countBy(resolvedRows, r => r.priority);

  return {
    user: cfg.user,
    siteUrl,
    weekFrom: fromISO,
    weekTo: toISO,
    all: allRows,
    resolved: resolvedRows,
    inProgress: inProgressRows,
    summary: {
      total: allRows.length,
      resolved: resolvedRows.length,
      inProgress: inProgressRows.length,
      storyPointsResolved: resolvedRows.reduce((s, r) => s + r.sp, 0),
      storyPointsTotal: allRows.reduce((s, r) => s + r.sp, 0),
    },
    byType,
    byPriority,
  };
}

function countBy(rows, getter) {
  const map = {};
  for (const r of rows) {
    const k = getter(r) || '(none)';
    map[k] = (map[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]));
}
