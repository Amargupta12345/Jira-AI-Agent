/**
 * lib/api.mjs — Shared Jira REST API helpers
 *
 * Extracted from jcp-lifecycle.mjs for reuse across CLI tools.
 * Provides authenticated GET/POST/PUT/DELETE against the Jira REST API.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Work around corporate/local TLS certificate issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load config ─────────────────────────────────────────────────────

export const config = JSON.parse(readFileSync(resolve(ROOT, 'jira-config.json'), 'utf8'));
export const jcpFields = JSON.parse(readFileSync(resolve(ROOT, 'jcp-fields.json'), 'utf8'));

export const JIRA_BASE = config.siteUrl;
export const AUTH_HEADER = `Basic ${btoa(`${config.user.email}:${config.apiToken}`)}`;

// ── REST helpers ────────────────────────────────────────────────────

export async function jiraGet(path) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function jiraPost(path, body) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return null;
}

export async function jiraPut(path, body) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return null;
}

export async function jiraDelete(path) {
  const res = await fetch(`${JIRA_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: AUTH_HEADER },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE ${path} failed (${res.status}): ${body}`);
  }
}
