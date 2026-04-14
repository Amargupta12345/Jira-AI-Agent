/**
 * Council prompt builders — constructs prompts for each phase of council deliberation.
 *
 * Lives in the prompt module because all prompt construction is owned here.
 * The council engine receives these as config and calls them with round state.
 */

import { DEFAULT_AGREEMENT_ROLE } from '../council/config/defaults.js';

export function buildProposerPrompt(round, baseContext, proposerOutput, criticOutputs, proposerRole, initialFeedback) {
  if (round === 1) {
    let prompt = `${baseContext}\n\nYou are the Proposer. ${proposerRole}`;
    if (initialFeedback) {
      prompt += `\n\n## Previous Feedback\n${initialFeedback}`;
    }
    return prompt;
  }

  const critiqueSummary = criticOutputs.length > 0
    ? criticOutputs.map(c => `### Critic ${c.index} (agent-${c.index})\n${c.output}`).join('\n\n')
    : '(No critic feedback available)';
  return `${baseContext}\n\n` +
    '## Your Previous Proposal\n' + proposerOutput + '\n\n' +
    `## Critiques (${criticOutputs.length})\n` + critiqueSummary + '\n\n' +
    `${criticOutputs.length} critic(s) reviewed your approach. Respond to their points. ` +
    'Revise your strategy or defend it with evidence from the codebase. ' +
    'Converge toward a final unified plan.';
}

export function buildCriticPrompt(round, baseContext, proposerOutput, criticOutputs, criticIndex, criticRole) {
  const priorCritiques = criticOutputs.length > 0
    ? '\n\n## Prior Critiques This Round\n' + criticOutputs.map(c => `### Critic ${c.index}\n${c.output}`).join('\n\n')
    : '';

  if (round === 1) {
    return `${baseContext}\n\n` +
      '## Proposer\'s Proposal\n' + proposerOutput +
      priorCritiques + '\n\n' +
      `You are Critic ${criticIndex} (agent-${criticIndex}). ${criticRole}\n\n` +
      'IMPORTANT: Do NOT just agree with the proposal. Your value is in finding what\'s WRONG or MISSING.';
  }

  return `${baseContext}\n\n` +
    '## Proposer\'s Latest Proposal\n' + proposerOutput +
    priorCritiques + '\n\n' +
    `You are Critic ${criticIndex} (agent-${criticIndex}). ${criticRole}\n\n` +
    'The Proposer responded to previous critiques. Verify their fixes are correct. ' +
    'Find any remaining issues. Do NOT agree unless you have independently verified their claims in the codebase.';
}

export function buildAgreementPrompt(baseContext, proposerOutput, criticOutputs, agreementRole) {
  const critiqueSummary = criticOutputs.map(c => `### Critic ${c.index}\n${c.output}`).join('\n\n');
  const role = agreementRole || DEFAULT_AGREEMENT_ROLE;
  return `${baseContext}\n\n` +
    '## Your Proposal\n' + proposerOutput + '\n\n' +
    `## Critiques (${criticOutputs.length})\n` + critiqueSummary + '\n\n' +
    `You are the Proposer. ${role}`;
}
