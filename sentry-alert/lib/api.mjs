/**
 * lib/api.mjs — Sentry REST API helpers
 *
 * Mirrors the pattern of jira-creator/lib/api.mjs.
 * Reads credentials from sentry-config.json at the package root.
 * All GET/POST/PUT/DELETE functions throw on non-OK responses.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Self-hosted / corporate Sentry instances use internal certs.
// Suppress the Node.js console warning for this specific flag.
{
  const _emit = process.emitWarning.bind(process);
  process.emitWarning = (msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return;
    _emit(msg, ...rest);
  };
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load config ──────────────────────────────────────────────────────

export const config = JSON.parse(readFileSync(resolve(ROOT, 'sentry-config.json'), 'utf8'));

export const SENTRY_BASE = (config.baseUrl || 'https://sentry.io').replace(/\/$/, '');
export const AUTH_HEADER = `Bearer ${config.authToken}`;
export const ORG_SLUG = config.orgSlug;
export const DEFAULT_PROJECT = config.defaultProject || null;

// ── REST helpers ─────────────────────────────────────────────────────

/**
 * GET /api/0<path>
 * Returns parsed JSON. Throws on non-OK.
 *
 * Self-hosted Sentry may return paginated objects { data: [...] } instead of
 * bare arrays — callers that expect arrays should use sentryGetList().
 */
export async function sentryGet(path, queryParams = {}) {
  const url = new URL(`${SENTRY_BASE}/api/0${path}`);
  for (const [k, v] of Object.entries(queryParams)) {
    if (Array.isArray(v)) {
      v.forEach((val) => url.searchParams.append(k, val));
    } else if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: AUTH_HEADER, Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body.substring(0, 400)}`);
  }

  return res.json();
}

/**
 * Like sentryGet() but always returns an array.
 * Handles both bare-array and paginated { data: [...] } responses
 * returned by different Sentry versions / self-hosted instances.
 */
export async function sentryGetList(path, queryParams = {}) {
  const raw = await sentryGet(path, queryParams);
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.issues)) return raw.issues;
  if (raw && Array.isArray(raw.results)) return raw.results;
  // Fallback: if it's an object with numeric keys (edge case), convert
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.every(v => typeof v === 'object')) return vals;
  }
  return [];
}

/**
 * POST /api/0<path> with JSON body
 */
export async function sentryPost(path, body = {}) {
  const res = await fetch(`${SENTRY_BASE}/api/0${path}`, {
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
    throw new Error(`POST ${path} failed (${res.status}): ${text.substring(0, 400)}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

/**
 * PUT /api/0<path> with JSON body
 */
export async function sentryPut(path, body = {}) {
  const res = await fetch(`${SENTRY_BASE}/api/0${path}`, {
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
    throw new Error(`PUT ${path} failed (${res.status}): ${text.substring(0, 400)}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

/**
 * DELETE /api/0<path>
 */
export async function sentryDelete(path) {
  const res = await fetch(`${SENTRY_BASE}/api/0${path}`, {
    method: 'DELETE',
    headers: { Authorization: AUTH_HEADER },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE ${path} failed (${res.status}): ${body.substring(0, 400)}`);
  }
}
