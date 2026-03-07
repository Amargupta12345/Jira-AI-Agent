/**
 * Council agent runner — wraps runAI() with session tracking (memory).
 *
 * Each agent maintains a session ID across rounds so subsequent calls
 * resume the same conversation. This avoids rework — agents don't
 * re-read the codebase or re-derive conclusions from previous rounds.
 */

import { runAI } from '../../ai-provider/index.js';
import { warn } from '../../utils/logger.js';

/**
 * Run a single council agent (proposer, critic, or agreement phase)
 * with session memory and error handling.
 *
 * @param {object} opts
 * @param {string} opts.prompt - The prompt to send
 * @param {string} opts.workingDir - Working directory for tool access
 * @param {string} opts.label - Log label for this call
 * @param {number} opts.agentIndex - Index in the agents array
 * @param {object[]} opts.agents - Resolved agent configs
 * @param {Map} opts.sessions - Session ID map (agent index → session ID) for memory
 * @param {object} opts.config - Full config object
 * @param {string} opts.councilLabel - Council label for log filenames
 * @returns {Promise<{output: string, rateLimited: boolean, failed: boolean}>}
 */
export async function runAgent({ prompt, workingDir, label, agentIndex, agents, sessions, config, councilLabel }) {
  try {
    const result = await runAI({
      prompt,
      workingDir,
      mode: 'debate',
      label,
      logDir: config.agent.logDir,
      ticketKey: councilLabel,
      config,
      providerConfig: agents[agentIndex],
      resumeSessionId: sessions.get(agentIndex) || undefined,
    });

    // Persist session ID for memory across rounds
    if (result.sessionId) {
      sessions.set(agentIndex, result.sessionId);
    }

    return { output: result.output || '', rateLimited: !!result.rateLimited, failed: false };
  } catch (err) {
    warn(`[${label}] Failed: ${err.message}`);
    return { output: '', rateLimited: false, failed: true };
  }
}
