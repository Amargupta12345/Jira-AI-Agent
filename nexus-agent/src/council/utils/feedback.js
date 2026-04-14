/**
 * Council feedback helper.
 *
 * Reads optional human guidance from the workspace and appends it to prompts
 * so agents can incorporate human steering in the next stage.
 */
import { checkHumanFeedback } from '../runtime/workspace.js';

/**
 * Append human feedback from workspace, if present.
 *
 * @param {string} prompt
 * @param {string|null} workspace
 * @returns {string}
 */
export function appendHumanFeedback(prompt, workspace) {
  const feedback = checkHumanFeedback(workspace);
  return feedback ? `${prompt}\n\n## Human Feedback\n${feedback}` : prompt;
}
