/**
 * PR review council orchestrator.
 */

import path from 'path';
import { createCouncil } from '../council/index.js';
import { withCouncilConfig } from '../utils/config.js';
import { buildReviewContext } from './review-context.js';
import {
  REVIEW_MARKERS,
  getReviewRoles,
  buildReviewExtractorPrompt,
  buildReviewProposerPrompt,
  buildReviewCriticPrompt,
  buildReviewAgreementPrompt,
  reviewStructuralCheck,
} from './review-prompts.js';
import { parseReviewReport } from './review-parser.js';
import { log, warn } from '../utils/logger.js';

/**
 * Run a dedicated PR-review council on current diff.
 *
 * @returns {Promise<{status:'approved'|'rejected', critical:string[], warnings:string[], summary:string, reason?:string}>}
 */
export async function reviewPullRequest(ticketData, cloneDir, config, options = {}) {
  const { checkpointDir, ticketKey, preWarnings = [], baseBranch } = options;

  const reviewContext = buildReviewContext(ticketData, cloneDir, {
    preWarnings,
    baseBranch,
  });

  const reviewCheckpointDir = checkpointDir ? path.join(checkpointDir, 'pr-review') : undefined;

  log('Starting PR review council...');

  const council = createCouncil({
    goal: 'Review this proposed PR diff and decide if it is safe to ship.',
    context: reviewContext,
    workingDir: cloneDir,
    roles: getReviewRoles(),
    prompts: {
      buildProposer: buildReviewProposerPrompt,
      buildCritic: buildReviewCriticPrompt,
      buildAgreement: buildReviewAgreementPrompt,
    },
    evaluation: {
      structural: reviewStructuralCheck,
      buildAiPrompt: buildReviewExtractorPrompt,
      outputMarkers: REVIEW_MARKERS,
      approvalKeyword: 'APPROVED',
      rejectionKeyword: 'REJECTED',
      forceOnLastRound: true,
    },
    config: withCouncilConfig(config, config.prReviewCouncil),
    label: ticketKey ? `${ticketKey}-pr-review` : 'pr-review',
    checkpointDir: reviewCheckpointDir,
  });

  const result = await council.run();

  if (!result.passed || !result.output) {
    const reason = result.feedback || 'PR review council failed to produce a usable review';
    warn(`PR review council rejected: ${reason}`);
    return {
      status: 'rejected',
      critical: [`PR review council rejected output: ${reason}`],
      warnings: [],
      reason,
      summary: 'PR review council rejected',
    };
  }

  const parsed = parseReviewReport(result.output, result.rounds);
  if (parsed.verdict === 'REJECT' || parsed.critical.length > 0) {
    return {
      status: 'rejected',
      critical: parsed.critical,
      warnings: parsed.warnings,
      summary: parsed.summary,
      reason: 'PR review found merge-blocking issues',
    };
  }

  return {
    status: 'approved',
    critical: [],
    warnings: parsed.warnings,
    summary: parsed.summary,
  };
}
