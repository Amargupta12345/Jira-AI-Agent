/**
 * Council — a group of AI agents that collaborate, discuss, and produce
 * actionable outputs. Discussions happen via files for full visibility.
 * Agents have session memory to avoid rework across rounds.
 *
 * Flow per round:
 *   1. Proposer (agent-0): proposes strategy (round 1) or revises (round 2+)
 *   2. Critics (agent-1..N): each critiques, sees prior critics' outputs
 *   3. Agreement: proposer synthesizes critiques → AGREED/DISAGREE
 *   4. Evaluate: structural + AI quality gate
 *
 * The caller defines: goal, context, role instructions, evaluation criteria,
 * and output format. The council handles the rest.
 */

import { runCouncil } from './orchestrator/run-council.js';

/**
 * Create a configured council instance.
 *
 * @param {object} opts
 * @param {string} opts.goal - What the council should achieve
 * @param {string} opts.context - All context the agents need
 * @param {string} opts.workingDir - Working directory for tool access
 * @param {{proposer: string, critic: string, agreement?: string}} opts.roles - Role instructions
 * @param {object} opts.prompts - Prompt builder functions (owned by caller)
 * @param {function} opts.prompts.buildProposer - (round, baseContext, proposerOutput, criticOutputs, role, feedback) => string
 * @param {function} opts.prompts.buildCritic - (round, baseContext, proposerOutput, criticOutputs, criticIndex, role) => string
 * @param {function} opts.prompts.buildAgreement - (baseContext, proposerOutput, criticOutputs, agreementRole) => string
 * @param {object} opts.evaluation - Evaluation configuration
 * @param {function} [opts.evaluation.structural] - (output) => {passed, feedback}
 * @param {function} opts.evaluation.buildAiPrompt - (councilOutput, context, force) => prompt
 * @param {{start: string, end: string}} opts.evaluation.outputMarkers - Extraction markers
 * @param {string} [opts.evaluation.approvalKeyword] - Default: 'APPROVED'
 * @param {string} [opts.evaluation.rejectionKeyword] - Default: 'REJECTED'
 * @param {string} [opts.evaluation.feedbackMarker] - Default: '=== FEEDBACK ==='
 * @param {boolean} [opts.evaluation.forceOnLastRound] - Default: true
 * @param {object} opts.config - Full config object (aiProvider section used)
 * @param {string} opts.label - Label for logs and workspace files
 * @param {string} [opts.checkpointDir] - Directory for workspace artifacts
 * @param {string} [opts.feedback] - Initial feedback from prior failed run
 * @returns {{run: function(): Promise<{passed: boolean, output: string|null, feedback: string|null, rounds: number}>}}
 */
export function createCouncil(opts) {
  const {
    goal,
    context,
    workingDir,
    roles,
    prompts,
    evaluation,
    config,
    label = 'council',
    checkpointDir,
    feedback,
  } = opts || {};

  const requiredPaths = ['goal','context','roles.proposer','roles.critic','prompts.buildProposer','prompts.buildCritic','prompts.buildAgreement','evaluation.buildAiPrompt','evaluation.outputMarkers','config'];
  const root = { goal, context, roles, prompts, evaluation, config };
  // Validate nested required fields via dot-path lookup in one pass.
  const missing = requiredPaths.filter((fieldPath) => !fieldPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), root));
  if (missing.length > 0) {
    throw new Error(`Council requires: ${missing.join(', ')}`);
  }

  return {
    run: () => runCouncil({
      goal,
      context,
      workingDir,
      roles,
      prompts,
      evaluation,
      config,
      label,
      checkpointDir,
      initialFeedback: feedback,
    }),
  };
}
