/**
 * Prompt Module — orchestrates the full prompt pipeline.
 *
 * The brain: configures a council of AI agents with ticket-specific roles
 * and evaluation criteria, then runs it to produce a cheatsheet.
 * The cheatsheet is the most valuable artifact — persisted to disk.
 */

import { buildTicketContext } from './ticket-context.js';
import { buildCodebaseContext, extractFilePaths } from './codebase-context.js';
import { createCouncil } from '../council/index.js';
import { buildProposerPrompt, buildCriticPrompt, buildAgreementPrompt } from './council-prompts.js';
import { validateExecution } from './validator.js';
import { log, warn } from '../utils/logger.js';

// --- Ticket-specific council configuration ---

const CHEATSHEET_MARKERS = {
  start: '=== CHEATSHEET START ===',
  end: '=== CHEATSHEET END ===',
};

const PROPOSER_ROLE =
  'Explore the codebase using Read/Glob/Grep tools. ' +
  'Propose a detailed implementation strategy for this ticket. ' +
  'List every file to change, what to change, and in what order. ' +
  'For core logic changes, provide exact code snippets. ' +
  'For boilerplate, provide directional guidance. ' +
  'Include test file updates: find existing spec/test files for the modules you change and describe what test cases need updating.\n\n' +
  'IMPORTANT — Testing & Validation:\n' +
  '- The service\'s own instruction file (CLAUDE.md/codex.md/README.md) is included above in "Service Rules". ' +
  'It contains the authoritative test commands and validation steps for this repo. ' +
  'Use EXACTLY those commands in your validation checklist — do NOT invent ad-hoc grep/rg validation commands.\n' +
  '- If the service rules specify test commands (e.g. `pnpm test`, `jest --selectProjects ...`), reference them exactly.\n' +
  '- If mock files or test setup files (setupFilesAfterEnv, __mocks__) reference modules you are changing or removing, ' +
  'they MUST be updated or removed in your plan.';

const CRITIC_ROLE =
  'You are an adversarial reviewer. Your job is to find PROBLEMS, not to agree. ' +
  'Explore the codebase using Read/Glob/Grep tools to independently verify every claim in the proposal. ' +
  'You MUST identify at least 3 concrete issues from these categories:\n' +
  '- **Missing files**: Files that import/require changed modules but are not in the plan\n' +
  '- **Missing tests**: Spec/test files that exercise changed code but are not updated\n' +
  '- **Broken references**: Imports, exports, or function calls that would break after proposed changes\n' +
  '- **Incomplete removal**: If removing a feature, references left behind (config, constants, routes, models, fixtures)\n' +
  '- **Test infrastructure**: Mock files, test setup files (setupFilesAfterEnv, __mocks__, fixtures), jest config that reference changed/removed modules\n' +
  '- **Wrong approach**: A simpler or safer way to achieve the same result\n\n' +
  'For each issue, cite the exact file path and line. Do NOT say "looks good" or "I agree". ' +
  'End with your own complete corrected strategy that addresses all issues found.\n\n' +
  'IMPORTANT: Check the service\'s own instruction file (CLAUDE.md/codex.md/README.md in the "Service Rules" section above) ' +
  'for test commands and validation steps. Verify the proposal uses those — not ad-hoc grep/rg commands.';

function buildExtractorPrompt(councilOutput, ticketContext, force) {
  const modeInstruction = force
    ? 'You MUST produce a cheatsheet even if the debate output is imperfect. Do your best.'
    : 'Only approve if the debate output contains a clear, actionable implementation plan.';

  return `You are a quality evaluator for an AI code implementation debate.

## Ticket Context
${ticketContext}

## Debate Output
${councilOutput}

## Your Task
${modeInstruction}

Evaluate the debate output and either:
1. Write "APPROVED" followed by a clean, actionable cheatsheet extracted from the debate, OR
2. Write "REJECTED" followed by specific feedback about what's missing.

The cheatsheet must be:
- A step-by-step implementation guide
- Reference specific files and code changes
- Be self-contained (readable by someone who hasn't seen the debate)

Format your cheatsheet between === CHEATSHEET START === and === CHEATSHEET END === markers.
Format your feedback after === FEEDBACK === marker.`;
}

/**
 * Build a cheatsheet for a ticket via the council pipeline.
 *
 * @param {object} ticketData - Parsed ticket object from jira/parser.js
 * @param {string} cloneDir - Path to cloned repo
 * @param {object} config - Full config object
 * @param {object} [options]
 * @param {string} [options.checkpointDir] - Directory to save debate artifacts
 * @param {string} [options.ticketKey] - JIRA ticket key
 * @returns {Promise<{status: 'approved'|'rejected', cheatsheet?: string, summary?: string, reason?: string, phase?: 'early'|'late'}>}
 */
export async function buildCheatsheet(ticketData, cloneDir, config, options = {}) {
  const { checkpointDir, ticketKey } = options;

  // 1. Build ticket context
  log('Building ticket context...');
  const ticketContext = buildTicketContext(ticketData);

  // 2. Read codebase context (pre-include files referenced in ticket)
  log('Building codebase context...');
  const ticketText = `${ticketData.description || ''}\n${(ticketData.comments || []).map(c => c.text).join('\n')}`;
  const referencedFiles = extractFilePaths(ticketText);
  if (referencedFiles.length > 0) {
    log(`Found ${referencedFiles.length} file paths in ticket — pre-loading contents`);
  }
  const codebaseContext = buildCodebaseContext(cloneDir, { referencedFiles });

  // 3. Configure and run council
  log('Starting council...');
  const council = createCouncil({
    goal: 'Propose a detailed implementation strategy for this ticket.',
    context: `${ticketContext}\n\n## Codebase Context\n\n${codebaseContext}`,
    workingDir: cloneDir,
    roles: {
      proposer: PROPOSER_ROLE,
      critic: CRITIC_ROLE,
    },
    prompts: {
      buildProposer: buildProposerPrompt,
      buildCritic: buildCriticPrompt,
      buildAgreement: buildAgreementPrompt,
    },
    evaluation: {
      buildAiPrompt: buildExtractorPrompt,
      outputMarkers: CHEATSHEET_MARKERS,
      forceOnLastRound: true,
    },
    config,
    label: ticketKey || 'cheatsheet',
    checkpointDir,
    feedback: options.feedback,
  });

  const result = await council.run();

  // 4. Map council result to prompt module return format
  if (!result.passed || !result.output) {
    return {
      status: 'rejected',
      reason: result.feedback || 'Council failed to produce an acceptable cheatsheet',
      phase: 'late',
    };
  }

  log(`Cheatsheet produced (${result.output.length} chars, ${result.rounds} rounds)`);

  return {
    status: 'approved',
    cheatsheet: result.output,
    summary: `Council completed in ${result.rounds} round(s)`,
  };
}

export { validateExecution, reviewDiff } from './validator.js';
export { reviewPullRequest } from './pr-review.js';
