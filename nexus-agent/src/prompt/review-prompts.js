/**
 * PR review council prompt builders and evaluation guards.
 *
 * Pure prompt/validation helpers: no I/O, no git operations.
 */

import { buildProposerPrompt, buildCriticPrompt, buildAgreementPrompt } from './council-prompts.js';

export const REVIEW_MARKERS = {
  start: '=== PR REVIEW START ===',
  end: '=== PR REVIEW END ===',
};

const REVIEW_PROPOSER_ROLE =
  'You are a strict PR reviewer. Review only the provided git diff and changed files.\n\n' +
  '## Severity Rules (strictly enforced)\n\n' +
  '**CRITICAL** — use ONLY for issues that are INTRODUCED OR DIRECTLY WORSENED by this PR:\n' +
  '- New bugs, null-pointer risks, or regressions caused by the diff lines\n' +
  '- Missing tests for code paths that THIS PR changes\n' +
  '- Broken contracts (removed exports, changed signatures used elsewhere)\n' +
  '- Security issues added by this diff\n\n' +
  '**WARNING** — use for everything else:\n' +
  '- Pre-existing issues found while reading context (MUST note "pre-existing, not introduced by this PR")\n' +
  '- Style, naming, or code quality nits\n' +
  '- Nice-to-have improvements unrelated to the diff\n' +
  '- Test gaps for code paths NOT changed by this PR\n\n' +
  'RULE: If a finding says "pre-existing", "not introduced by this PR", "existed before this change", ' +
  'or refers to lines not touched by the diff — it is a WARNING, never Critical. ' +
  'Do not suggest broad refactors unrelated to the diff.';

const REVIEW_CRITIC_ROLE =
  'You are an adversarial PR reviewer. Challenge the proposer and find misses. ' +
  'You must verify claims directly against the diff/context and add missing findings.\n\n' +
  '## Severity Rules (strictly enforced)\n\n' +
  '**CRITICAL** — only for issues INTRODUCED by this PR: new bugs, regressions, broken contracts, ' +
  'missing tests for changed code paths.\n\n' +
  '**WARNING** — pre-existing issues, style nits, improvements unrelated to the diff, ' +
  'and test gaps for code NOT changed by this PR.\n\n' +
  'RULE: Never mark a pre-existing issue as CRITICAL. If you note something "not introduced by this PR" ' +
  '— that is automatically a WARNING. ' +
  'Prioritize concrete, merge-blocking defects (CRITICAL) over informational notes (WARNING).';

export function getReviewRoles(ticketType) {
  const isBug = ticketType && ticketType.toLowerCase() === 'bug';

  const bugSuffix = isBug
    ? '\n\n## Bug Fix Context\n' +
      'This PR is a targeted bug fix. The primary goal is to fix the specific error in the Sentry stack trace. ' +
      'Defensive improvements to adjacent code paths that were NOT in the original stack trace are BONUS scope — ' +
      'missing test coverage for those bonus paths is a WARNING, not Critical. ' +
      'Only block the merge (CRITICAL) if the specific bug in the ticket summary is not addressed, ' +
      'or if the fix itself introduces a new regression.'
    : '';

  return {
    proposer: REVIEW_PROPOSER_ROLE + bugSuffix,
    critic: REVIEW_CRITIC_ROLE + bugSuffix,
  };
}

// Thin wrappers keep PR review coupling explicit and allow future divergence.
export function buildReviewProposerPrompt(...args) {
  return buildProposerPrompt(...args);
}

export function buildReviewCriticPrompt(...args) {
  return buildCriticPrompt(...args);
}

export function buildReviewAgreementPrompt(...args) {
  return buildAgreementPrompt(...args);
}

export function buildReviewExtractorPrompt(councilOutput, context, force) {
  const modeInstruction = force
    ? 'Produce best-effort review output even if debate quality is imperfect.'
    : 'Reject if findings are vague or missing file-specific evidence.';

  return `You are evaluating a PR review debate output.

## Context
${context}

## Debate Output
${councilOutput}

## Task
${modeInstruction}

Return exactly one of:
1. "APPROVED" + a review report between markers, or
2. "REJECTED" + feedback after === FEEDBACK ===.

The review report MUST be between ${REVIEW_MARKERS.start} and ${REVIEW_MARKERS.end} and follow this EXACT format:
- Verdict: APPROVE or REJECT
- Critical Findings:
  - <file>: <issue>
- Warning Findings:
  - <file>: <issue>
- Summary: <short sentence>

## STRICT SEVERITY RULES (you must enforce these when extracting):

**Critical Findings** — ONLY issues INTRODUCED OR DIRECTLY WORSENED by this PR:
- New bugs or null-pointer risks caused by the changed lines
- Missing tests for code paths that this PR modifies
- Broken contracts (removed exports, changed signatures used by other files)

**Warning Findings** — everything else:
- Any finding described as "pre-existing", "not introduced by this PR", "existed before this change", or "in follow-up" → MOVE TO WARNINGS, even if the debate called it Critical
- Test gaps for code paths this PR did NOT change
- Style or quality issues unrelated to correctness

**Verdict**:
- APPROVE if Critical Findings is empty (or "None")
- REJECT only if there is at least one true Critical finding per the rules above

If no findings exist, use "None" under each findings section and verdict APPROVE.`;
}

/**
 * Structural pre-check for PR review council output.
 *
 * This runs on councilOutput (agreement-stage text), NOT the final extracted
 * report. Validate debate quality here — file references, actionable language,
 * minimum length. Report-shape validation (Verdict/Findings sections) belongs
 * in the evaluator output after extraction/contract parsing.
 */
export function reviewStructuralCheck(output) {
  if (!output || output.trim().length < 100) {
    return { passed: false, feedback: 'Review debate output too short (< 100 chars)' };
  }

  // Generic file-reference detection: paths with / separators OR dotted extensions.
  // Avoids a hardcoded extension whitelist that misses Dockerfile, Makefile, lockfiles, etc.
  const slashPaths = output.match(/[\w\-.]+(?:\/[\w\-.]+)+/g) || [];
  const dottedPaths = output.match(/[\w\-./]+\.\w{1,10}/g) || [];
  if (slashPaths.length + dottedPaths.length < 1) {
    return { passed: false, feedback: 'Review debate output does not reference any file paths' };
  }

  return { passed: true, feedback: '' };
}
