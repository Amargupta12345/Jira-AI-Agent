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
  'You are a strict PR reviewer. Review only the provided git diff and changed files. ' +
  'Identify correctness risks, regressions, missing tests, incomplete updates, and unsafe behavior. ' +
  'Do not suggest broad refactors unrelated to the diff. ' +
  'Output findings with severity as CRITICAL or WARNING, each with file path and exact reason.';

const REVIEW_CRITIC_ROLE =
  'You are an adversarial PR reviewer. Challenge the proposer and find misses. ' +
  'You must verify claims directly against the diff/context and add missing findings. ' +
  'Prioritize concrete, merge-blocking defects over style nits. ' +
  'Each finding must include severity (CRITICAL/WARNING), file path, and rationale.';

export function getReviewRoles() {
  return {
    proposer: REVIEW_PROPOSER_ROLE,
    critic: REVIEW_CRITIC_ROLE,
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

The review report MUST be between ${REVIEW_MARKERS.start} and ${REVIEW_MARKERS.end} and follow:
- Verdict: APPROVE or REJECT
- Critical Findings:
  - <file>: <issue>
- Warning Findings:
  - <file>: <issue>
- Summary: <short sentence>

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
