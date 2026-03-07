/**
 * Checkpoint persistence.
 *
 * Storage: .pipeline-state/<ticketKey>/
 *   state.json      — current step, ticket data, clone dir, etc.
 *   cheatsheet.md   — the debate output (if reached step 4)
 *   debate-rounds/  — round-1-a.md, round-1-b.md, etc.
 */

import fs from 'fs';
import path from 'path';
import { log, warn, debug } from '../utils/logger.js';

const STATE_DIR = path.join(process.cwd(), '.pipeline-state');

function getCheckpointDir(ticketKey) {
  return path.join(STATE_DIR, ticketKey);
}

/**
 * Save checkpoint for a ticket at a given step.
 *
 * @param {string} ticketKey
 * @param {string} step - Step name (e.g., 'FETCH_TICKET', 'BUILD_CHEATSHEET')
 * @param {object} data - Arbitrary data to persist
 */
export function saveCheckpoint(ticketKey, step, data) {
  const dir = getCheckpointDir(ticketKey);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const state = {
    currentStep: step,
    timestamp: new Date().toISOString(),
    ...data,
  };

  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  debug(`Checkpoint saved: ${ticketKey} @ ${step}`);

  // Save cheatsheet separately if present
  if (data.cheatsheet) {
    const cheatsheetPath = path.join(dir, 'cheatsheet.md');
    fs.writeFileSync(cheatsheetPath, data.cheatsheet);
    debug(`Cheatsheet saved: ${cheatsheetPath}`);
  }
}

/**
 * Load checkpoint for a ticket.
 *
 * @param {string} ticketKey
 * @returns {object|null} Checkpoint data or null if not found
 */
export function loadCheckpoint(ticketKey) {
  const dir = getCheckpointDir(ticketKey);
  const statePath = path.join(dir, 'state.json');

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    // Load cheatsheet from disk if path exists
    const cheatsheetPath = path.join(dir, 'cheatsheet.md');
    if (fs.existsSync(cheatsheetPath)) {
      state.cheatsheet = fs.readFileSync(cheatsheetPath, 'utf-8');
    }

    log(`Checkpoint loaded: ${ticketKey} @ ${state.currentStep} (${state.timestamp})`);
    return state;
  } catch (error) {
    warn(`Failed to load checkpoint for ${ticketKey}: ${error.message}`);
    return null;
  }
}

/**
 * Clear checkpoint for a ticket.
 * Note: preserves cheatsheet.md even on clear (it's the crown jewel).
 *
 * @param {string} ticketKey
 */
export function clearCheckpoint(ticketKey) {
  const dir = getCheckpointDir(ticketKey);
  const statePath = path.join(dir, 'state.json');

  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
    log(`Checkpoint cleared: ${ticketKey}`);
  }
}

/**
 * Get the checkpoint directory path for a ticket.
 * Used by debate engine to save round outputs.
 */
export function getCheckpointPath(ticketKey) {
  return getCheckpointDir(ticketKey);
}
