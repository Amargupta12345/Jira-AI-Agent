/**
 * Evaluation stage.
 *
 * Evaluates the round output and persists evaluation artifacts/status.
 */

import { evaluate } from '../evaluator/evaluator.js';
import { updateStatus, writeRoundFile } from '../runtime/workspace.js';
import { log } from '../../utils/logger.js';

/**
 * Execute evaluation stage.
 *
 * @returns {Promise<{passed: boolean, feedback: string, output: string|null}>}
 */
export async function runEvaluationStage({ round, maxRounds, workspace, label, criticOutputs, lastCouncilOutput, evalOpts, isLastRound }) {
  const forceEval = isLastRound && (evalOpts.forceOnLastRound !== false);
  updateStatus(workspace, label, maxRounds, round, 'evaluating', { agreed: criticOutputs.length === 0 ? undefined : /AGREED/i.test(lastCouncilOutput) });

  log(`[Round ${round}] Evaluating council output${forceEval && !/Agreed/.test(lastCouncilOutput) ? ' (forced, last round)' : ''}...`);
  const result = await evaluate(lastCouncilOutput, { ...evalOpts, round }, forceEval);
  writeRoundFile(workspace, round, 'evaluation.md', `# Evaluation\n\n**Passed:** ${result.passed}\n\n${result.feedback || result.output || ''}`);
  if (result.passed) {
    log(`Council approved after round ${round}`);
    updateStatus(workspace, label, maxRounds, round, 'done', { agreed: true, result: 'passed' });
  }

  return result;
}
