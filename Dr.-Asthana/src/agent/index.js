/**
 * Agent Module — the deliberately dumb executor.
 *
 * Combines static system prompt with cheatsheet, calls runAI(),
 * returns result. This module does NOT plan, explore, decide, or retry.
 *
 * All AI spawning goes through the AI Provider module.
 */

import { runAI } from '../ai-provider/index.js';
import { getStaticPrompt } from '../prompt/static.js';

/**
 * Execute a cheatsheet on a cloned repo.
 *
 * @param {string} cheatsheet - The full cheatsheet text
 * @param {string} cloneDir - Path to cloned repo
 * @param {object} config - Full config object
 * @param {object} [options]
 * @param {string} [options.feedback] - Retry feedback from prior failed validation/review
 * @returns {Promise<{output: string, exitCode: number, completedNormally: boolean, numTurns: number|null, rateLimited: boolean, provider: string, duration: number}>}
 */
export async function execute(cheatsheet, cloneDir, config, options = {}) {
  const { feedback } = options;
  const staticPrompt = getStaticPrompt();
  const retryFeedback = feedback
    ? `\n\n---\n\n## Retry Feedback\n\nPrevious attempt issues that must be fixed in this run:\n${feedback}`
    : '';
  const fullPrompt = `${staticPrompt}\n\n---\n\n## Cheatsheet\n\n${cheatsheet}${retryFeedback}`;

  return runAI({
    prompt: fullPrompt,
    workingDir: cloneDir,
    mode: 'execute',
    label: 'executor',
    logDir: config.agent.logDir,
    ticketKey: config._currentTicketKey || 'exec',
    config,
  });
}
