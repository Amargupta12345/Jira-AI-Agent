/**
 * Low-level JIRA REST API wrapper.
 * All functions take (config, ...) as first arg.
 */

import { getAuthHeader } from '../utils/config.js';
import { log, warn } from '../utils/logger.js';

/**
 * Fetch JSON from JIRA REST API
 */
export async function fetchJSON(config, url, options = {}) {
  const response = await fetch(url, {
    method: 'GET',
    ...options,
    headers: {
      Authorization: getAuthHeader(config),
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JIRA API ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * POST JSON to JIRA REST API
 */
export async function postJSON(config, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`JIRA API POST ${response.status}: ${text}`);
  }

  // Some endpoints return 204 with no body
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return null;
}

/**
 * Fetch all comments for a ticket, paginating through JIRA's API.
 */
async function fetchAllComments(config, ticketKey, maxComments) {
  const allComments = [];
  let startAt = 0;
  const pageSize = 50;

  while (startAt < maxComments) {
    const url = `${config.jira.baseUrl}/rest/api/3/issue/${ticketKey}/comment?startAt=${startAt}&maxResults=${pageSize}`;
    const data = await fetchJSON(config, url);
    const comments = data.comments || [];
    allComments.push(...comments);

    if (startAt + comments.length >= data.total || comments.length === 0) {
      break;
    }
    startAt += comments.length;
  }

  return allComments.slice(0, maxComments);
}

/**
 * Get full ticket details
 */
export async function getTicketDetails(config, ticketKey) {
  const url = `${config.jira.baseUrl}/rest/api/3/issue/${ticketKey}?expand=renderedFields`;
  const ticket = await fetchJSON(config, url);

  // Replace inline comments with paginated fetch
  try {
    const maxComments = config.jira.maxComments || 100;
    const allComments = await fetchAllComments(config, ticketKey, maxComments);
    if (!ticket.fields.comment) {
      ticket.fields.comment = {};
    }
    ticket.fields.comment.comments = allComments;
    log(`Fetched ${allComments.length} comments for ${ticketKey} (paginated)`);
  } catch (commentError) {
    warn(`Comment pagination failed for ${ticketKey}: ${commentError.message}. Using inline comments.`);
  }

  return ticket;
}

/**
 * Get the current status name of a ticket
 */
export async function getTicketStatus(config, ticketKey) {
  try {
    const url = `${config.jira.baseUrl}/rest/api/3/issue/${ticketKey}?fields=status`;
    const data = await fetchJSON(config, url);
    return data.fields?.status?.name || null;
  } catch {
    return null;
  }
}
