/**
 * Proposer stage.
 *
 * Runs agent-0 for the current round and persists proposal output.
 */

import { isGarbageOutput } from '../../ai-provider/provider.js';
import { runAgent } from '../runtime/runner.js';
import { appendHumanFeedback } from '../utils/feedback.js';
import { updateStatus, writeRoundFile } from '../runtime/workspace.js';
import { log, warn } from '../../utils/logger.js';

/**
 * Execute proposer stage.
 *
 * @returns {Promise<{halt: boolean, output?: string}>}
 */
export async function runProposerStage({ round, workspace, label, maxRounds, prompts, baseContext, proposerOutput, criticOutputs, roles, initialFeedback, agentOpts, sessions }) {
  updateStatus(workspace, label, maxRounds, round, 'agent-0');
  const prompt = appendHumanFeedback(prompts.buildProposer(round, baseContext, proposerOutput, criticOutputs, roles.proposer, initialFeedback), workspace);

  log(`[Round ${round}] Running Proposer (agent-0)...${sessions.has(0) ? ' (resuming session)' : ''}`);
  const result = await runAgent({ prompt, label: `council-r${round}-agent-0`, agentIndex: 0, ...agentOpts });
  if (result.failed) {
    warn(`Proposer failed in round ${round}`);
    return { halt: true };
  }
  if (result.rateLimited) {
    warn(`Proposer rate limited in round ${round}`);
    return { halt: true };
  }

  if (isGarbageOutput(result.output)) warn(`Proposer round ${round} produced garbage output`);
  writeRoundFile(workspace, round, 'agent-0-proposal.md', result.output);
  return { halt: false, output: result.output };
}
