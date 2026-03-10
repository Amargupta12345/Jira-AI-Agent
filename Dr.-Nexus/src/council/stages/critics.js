/**
 * Critics stage.
 *
 * Runs critic agents (agent-1..N), skips failed/garbage outputs, and persists
 * successful critiques for the current round.
 */

import { isGarbageOutput } from '../../ai-provider/provider.js';
import { runAgent } from '../runtime/runner.js';
import { appendHumanFeedback } from '../utils/feedback.js';
import { updateStatus, writeRoundFile } from '../runtime/workspace.js';
import { log, warn } from '../../utils/logger.js';

/**
 * Execute critics stage.
 *
 * @returns {Promise<{outputs: Array<{index: number, output: string}>}>}
 */
export async function runCriticsStage({ round, workspace, label, maxRounds, prompts, baseContext, proposerOutput, roles, agentOpts, sessions, agents }) {
  const outputs = [];
  let skipped = 0;

  for (let ci = 1; ci < agents.length; ci++) {
    updateStatus(workspace, label, maxRounds, round, `agent-${ci}`);
    const prompt = appendHumanFeedback(prompts.buildCritic(round, baseContext, proposerOutput, outputs, ci, roles.critic), workspace);

    log(`[Round ${round}] Running Critic ${ci} (agent-${ci})...${sessions.has(ci) ? ' (resuming session)' : ''}`);
    const result = await runAgent({ prompt, label: `council-r${round}-agent-${ci}`, agentIndex: ci, ...agentOpts });
    if (result.failed || result.rateLimited || isGarbageOutput(result.output)) {
      warn(`Critic ${ci} round ${round} ${result.rateLimited ? 'rate limited' : result.failed ? 'failed' : 'produced garbage output'}, skipping`);
      skipped++;
      continue;
    }

    outputs.push({ index: ci, output: result.output });
    writeRoundFile(workspace, round, `agent-${ci}-critique.md`, result.output);
  }

  if (skipped > 0) log(`[Round ${round}] ${skipped} critic(s) skipped, ${outputs.length} succeeded`);
  return { outputs };
}
