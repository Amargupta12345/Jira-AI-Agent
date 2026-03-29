/**
 * Persistent state for the Sentry poller.
 *
 * Tracks which Sentry issue IDs have been processed (Jira ticket already created)
 * so the poller doesn't create duplicate tickets across restarts.
 *
 * State file location: <config.sentry.stateDir>/processed.json
 * Default: .sentry-state/processed.json (relative to process.cwd())
 */

import fs from 'fs';
import path from 'path';

const MAX_ENTRIES = 10_000;

function getStatePath(config) {
  const stateDir = config.sentry?.stateDir || '.sentry-state';
  const resolved = path.isAbsolute(stateDir)
    ? stateDir
    : path.join(process.cwd(), stateDir);
  return path.join(resolved, 'processed.json');
}

/**
 * Load state from disk. Returns a mutable state object.
 * Shape: { processed: string[], meta: { [issueId]: { ticketKey, createdAt } } }
 */
export function loadState(config) {
  const statePath = getStatePath(config);
  if (!fs.existsSync(statePath)) {
    return { processed: [], meta: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return {
      processed: Array.isArray(raw.processed) ? raw.processed : [],
      meta: raw.meta || {},
    };
  } catch {
    return { processed: [], meta: {} };
  }
}

/**
 * Persist state to disk atomically (write-then-rename).
 */
export function saveState(config, state) {
  const statePath = getStatePath(config);
  const dir = path.dirname(statePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Prune oldest entries if over limit to keep file small
  if (state.processed.length > MAX_ENTRIES) {
    const dropped = state.processed.splice(0, state.processed.length - MAX_ENTRIES);
    for (const id of dropped) {
      delete state.meta[id];
    }
  }

  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

/**
 * Check whether a Sentry issue has already been processed.
 */
export function isProcessed(state, issueId) {
  return state.processed.includes(String(issueId));
}

/**
 * Mark a Sentry issue as processed and persist state.
 * Optionally records the created Jira ticket key in metadata.
 */
export function markProcessed(config, state, issueId, ticketKey = null) {
  const id = String(issueId);
  if (!isProcessed(state, id)) {
    state.processed.push(id);
  }
  state.meta[id] = {
    ticketKey,
    createdAt: new Date().toISOString(),
  };
  saveState(config, state);
}
