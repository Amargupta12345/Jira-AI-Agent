/**
 * Council workspace — file-based observability and human-in-the-loop.
 *
 * All agent discussions happen via files so anyone can review them live.
 * Creates a structured directory under .pipeline-state/{label}/council/
 * that humans can watch during a run, and optionally steer via feedback files.
 *
 * Layout:
 *   council/
 *   ├── status.md                    ← Live status: current round, phase
 *   ├── round-1/
 *   │   ├── agent-0-proposal.md      ← Proposer's output
 *   │   ├── agent-1-critique.md      ← First critic's output
 *   │   ├── agent-2-critique.md      ← Second critic's output (if N > 2)
 *   │   ├── agreement.md
 *   │   └── evaluation.md
 *   ├── round-2/
 *   │   └── ...
 *   └── human-feedback.md            ← Drop this file in to inject guidance
 */

import fs from 'fs';
import path from 'path';
import { log, warn, debug } from '../../utils/logger.js';

/**
 * Initialize the council workspace directory with an initial status file.
 * Returns the workspace path, or null if checkpointDir is not provided.
 */
export function initWorkspace(checkpointDir, label, maxRounds) {
  if (!checkpointDir) return null;
  try {
    const workspace = path.join(checkpointDir, 'council');
    fs.mkdirSync(workspace, { recursive: true });
    const status = [
      `# Council Status`,
      ``,
      `**Label:** ${label}`,
      `**Max Rounds:** ${maxRounds}`,
      `**Started:** ${new Date().toISOString()}`,
      `**Phase:** starting`,
      `**Round:** 0/${maxRounds}`,
    ].join('\n');
    fs.writeFileSync(path.join(workspace, 'status.md'), status);
    debug(`Initialized council workspace at ${workspace}`);
    return workspace;
  } catch {
    warn('Failed to initialize council workspace');
    return null;
  }
}

/**
 * Write a round file to the structured workspace.
 * All agent discussions are persisted here for visibility.
 */
export function writeRoundFile(workspace, round, filename, content) {
  if (!workspace) return;
  try {
    const roundDir = path.join(workspace, `round-${round}`);
    fs.mkdirSync(roundDir, { recursive: true });
    const filePath = path.join(roundDir, filename);
    fs.writeFileSync(filePath, content);
    debug(`Wrote council file ${filePath}`);
  } catch { /* non-critical */ }
}

/**
 * Overwrite status.md with the current council state.
 */
export function updateStatus(workspace, label, maxRounds, round, phase, extra = {}) {
  if (!workspace) return;
  try {
    const lines = [
      `# Council Status`,
      ``,
      `**Label:** ${label}`,
      `**Max Rounds:** ${maxRounds}`,
      `**Updated:** ${new Date().toISOString()}`,
      `**Phase:** ${phase}`,
      `**Round:** ${round}/${maxRounds}`,
    ];
    if (extra.agreed !== undefined) {
      lines.push(`**Agreed:** ${extra.agreed ? 'Yes' : 'No'}`);
    }
    if (extra.result) {
      lines.push(`**Result:** ${extra.result}`);
    }
    fs.writeFileSync(path.join(workspace, 'status.md'), lines.join('\n'));
  } catch { /* non-critical */ }
}

/**
 * Check for a human-feedback.md file in the workspace.
 * If found, reads content, deletes the file, and returns the content.
 * This enables human-in-the-loop steering mid-council.
 */
export function checkHumanFeedback(workspace) {
  if (!workspace) return null;
  try {
    const feedbackPath = path.join(workspace, 'human-feedback.md');
    if (!fs.existsSync(feedbackPath)) return null;
    const content = fs.readFileSync(feedbackPath, 'utf-8').trim();
    fs.unlinkSync(feedbackPath);
    if (content) {
      log('Human feedback detected and consumed from council workspace');
      return content;
    }
    return null;
  } catch {
    return null;
  }
}
