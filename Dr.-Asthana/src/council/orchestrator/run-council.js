/**
 * Council round orchestrator.
 *
 * Coordinates stage modules while preserving per-agent session memory and
 * workspace observability files.
 */
import { evaluate } from '../evaluator/evaluator.js';
import { initWorkspace, updateStatus } from '../runtime/workspace.js';
import { resolveAgents } from '../config/agents.js';
import { runProposerStage } from '../stages/proposer.js';
import { runCriticsStage } from '../stages/critics.js';
import { runAgreementStage } from '../stages/agreement.js';
import { runEvaluationStage } from '../stages/evaluation.js';
import { log } from '../../utils/logger.js';

/**
 * Run the full council loop and return approved or best-effort output.
 *
 * @param {object} opts
 * @returns {Promise<{passed: boolean, output: string|null, feedback: string|null, rounds: number}>}
 */
export async function runCouncil({ goal, context, workingDir, roles, prompts, evaluation, config, label, checkpointDir, initialFeedback }) {
  const councilConfig = config.council || {};
  const maxRounds = councilConfig.maxRounds || 3;
  const agents = resolveAgents(councilConfig);

  log(`Council: ${agents.length} agents, ${maxRounds} max rounds, goal: ${goal.substring(0, 80)}...`);
  for (let i = 0; i < agents.length; i++) {
    log(`  agent-${i}: provider=${agents[i].provider}, model=${agents[i].model || 'default'}${i === 0 ? ' (proposer)' : ' (critic)'}`);
  }

  const baseContext = `${context}\n\n## Goal\n\n${goal}`;
  const workspace = initWorkspace(checkpointDir, label, maxRounds);
  const sessions = new Map();
  const agentOpts = { agents, sessions, config, councilLabel: label, workingDir };
  const evalOpts = { ...evaluation, context, config, label, workspace };

  let proposerOutput = '';
  let criticOutputs = [];
  let lastCouncilOutput = '';

  for (let round = 1; round <= maxRounds; round++) {
    log(`=== Council Round ${round}/${maxRounds} ===`);

    const proposer = await runProposerStage({ round, workspace, label, maxRounds, prompts, baseContext, proposerOutput, criticOutputs, roles, initialFeedback, agentOpts, sessions });
    if (proposer.halt) break;
    proposerOutput = proposer.output;

    const critics = await runCriticsStage({ round, workspace, label, maxRounds, prompts, baseContext, proposerOutput, roles, agentOpts, sessions, agents });
    criticOutputs = critics.outputs;

    const agreement = await runAgreementStage({ round, workspace, label, maxRounds, prompts, baseContext, proposerOutput, criticOutputs, roles, agentOpts, sessions });
    if (agreement.halt) break;
    lastCouncilOutput = agreement.lastCouncilOutput;
    if (agreement.nextProposerOutput) proposerOutput = agreement.nextProposerOutput;
    if (agreement.continueNextRound) continue;

    const isLastRound = round === maxRounds;
    const evalResult = await runEvaluationStage({ round, maxRounds, workspace, label, criticOutputs, lastCouncilOutput, evalOpts, isLastRound });
    if (evalResult.passed) {
      return { passed: true, output: evalResult.output, feedback: null, rounds: round };
    }
    if (!isLastRound) log(`Council round ${round} rejected: ${evalResult.feedback}`);
  }

  if (lastCouncilOutput) {
    log('Max council rounds reached. Forcing best-effort output...');
    const forceResult = await evaluate(lastCouncilOutput, evalOpts, true);
    if (forceResult.output) {
      updateStatus(workspace, label, maxRounds, maxRounds, 'done', { result: 'forced-pass' });
      return { passed: true, output: forceResult.output, feedback: 'Forced after max rounds', rounds: maxRounds };
    }
  }

  updateStatus(workspace, label, maxRounds, maxRounds, 'done', { result: 'failed' });
  return { passed: false, output: null, feedback: 'Council failed to produce acceptable output', rounds: maxRounds };
}
