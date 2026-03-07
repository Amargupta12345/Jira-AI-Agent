/**
 * Report builder sub-module.
 *
 * Design principle: Slack and JIRA messages are for HUMANS — plain language,
 * no jargon, no code blocks. Link to the run report for debugging details.
 * PR descriptions are for REVIEWERS — comprehensive enough for code review.
 *
 * All report functions return { jira: string, slack: object[]|null }
 */

import { summariseText } from '../utils/summariser.js';
import { warn } from '../utils/logger.js';

/** Max chars for a single Slack Block Kit mrkdwn text field. */
const SLACK_MRKDWN_LIMIT = 3000;

/**
 * Sanitize text for Slack Block Kit mrkdwn fields.
 * Strips control characters and truncates to the Block Kit limit.
 */
function sanitizeForSlack(text) {
  if (!text) return '';
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (clean.length > SLACK_MRKDWN_LIMIT) {
    clean = clean.substring(0, SLACK_MRKDWN_LIMIT - 3) + '...';
  }
  return clean;
}

/**
 * Safely summarise text — wraps summariseText with try-catch.
 * Falls back to hard truncation on failure.
 */
function safeSummarise(text, opts) {
  try {
    return summariseText(text, opts);
  } catch (e) {
    warn(`Summariser failed for ${opts?.label || 'text'}: ${e.message}. Using hard truncation.`);
    const limit = opts?.limit || 3000;
    if (text && text.length > limit) {
      return text.substring(0, limit - 3) + '...';
    }
    return text || '';
  }
}

/**
 * Build a human-friendly 2-3 sentence summary from a cheatsheet.
 * This is NOT technical — it's for JIRA/Slack consumption by non-engineers.
 */
function buildHumanSummary(cheatsheet, limit = 300) {
  if (!cheatsheet) return '';
  return safeSummarise(cheatsheet, { limit, label: 'human-summary' });
}

/**
 * Build a PR URL for display in JIRA/Slack.
 */
function prUrl(config, pr) {
  if (pr.prUrl) return pr.prUrl;
  return `${config.azureDevOps.org}/${config.azureDevOps.project}/_git/${pr.service}/pullrequest/${pr.prId}`;
}

/**
 * Build a step report for a JIRA comment.
 */
export function buildStepReport(stepName, details, timestamp) {
  const time = timestamp || new Date().toISOString();
  const jira = `**Step: ${stepName}** (${time})\n${details}`;
  return { jira, slack: null };
}

// ─────────────────────────────────────────────────
// Final Report (success) — JIRA + Slack
// ─────────────────────────────────────────────────

export function buildFinalReport(config, allPRs, allFailures, cheatsheetSummary, artifactUrl) {
  // --- JIRA: clean, scannable, layman-friendly ---
  const jiraLines = [];
  jiraLines.push(`### Implementation Complete`);
  jiraLines.push('');

  // Plain-English summary
  const summary = buildHumanSummary(cheatsheetSummary);
  if (summary) {
    jiraLines.push(summary);
    jiraLines.push('');
  }

  // PR table — simple
  if (allPRs.length > 0) {
    jiraLines.push(`**Pull Request${allPRs.length > 1 ? 's' : ''}:**`);
    for (const pr of allPRs) {
      jiraLines.push(`- [PR #${pr.prId}](${prUrl(config, pr)}) — ${pr.service} / ${pr.baseBranch}`);
    }
    jiraLines.push('');
  }

  // Failures — plain language
  if (allFailures.length > 0) {
    jiraLines.push(`**Could not complete:**`);
    for (const f of allFailures) {
      jiraLines.push(`- ${f.service} (${f.baseBranch}) — ${f.error}`);
    }
    jiraLines.push('');
  }

  // Report link
  if (artifactUrl) {
    jiraLines.push(`[View full report](${artifactUrl})`);
  }

  // --- Slack: short DM, 4-5 lines max ---
  const slackBlocks = [];

  // Header
  slackBlocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `PR ready for review`, emoji: true },
  });

  // Core message: ticket + what was done + PR link — all in one block
  const slackSummary = buildHumanSummary(cheatsheetSummary, 200);
  const slackPrLines = allPRs.map(pr =>
    `<${prUrl(config, pr)}|PR #${pr.prId}> — ${pr.service} / \`${pr.baseBranch}\``
  );

  let messageText = slackPrLines.join('\n');
  if (slackSummary) {
    messageText += `\n\n${slackSummary}`;
  }
  slackBlocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: sanitizeForSlack(messageText) },
  });

  // Failures
  if (allFailures.length > 0) {
    slackBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sanitizeForSlack(`:warning: Could not complete: ${allFailures.map(f => f.service).join(', ')}`),
      },
    });
  }

  // Footer: report link
  const footerParts = [];
  if (artifactUrl) footerParts.push(`<${artifactUrl}|Full report>`);
  footerParts.push('_Please review before merging_');
  slackBlocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: footerParts.join('  ·  ') }],
  });

  return { jira: jiraLines.join('\n'), slack: slackBlocks };
}

// ─────────────────────────────────────────────────
// Failure Report — JIRA + Slack
// ─────────────────────────────────────────────────

export function buildFailureReport(error, step, ticketData, artifactUrl) {
  const errorMsg = typeof error === 'string' ? error : error.message;
  const briefError = errorMsg.length > 300 ? errorMsg.substring(0, 297) + '...' : errorMsg;

  // JIRA: simple
  const jiraLines = [
    `### Could Not Complete`,
    '',
    `Something went wrong while processing this ticket.`,
    '',
    `**What happened:** ${briefError}`,
  ];
  if (artifactUrl) {
    jiraLines.push('');
    jiraLines.push(`[View full report](${artifactUrl})`);
  }

  // Slack: brief
  const slackBlocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Could not complete ticket', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sanitizeForSlack(`*${ticketData.key}* — ${ticketData.summary}\n\n${briefError}`),
      },
    },
  ];

  const footerParts = [];
  if (artifactUrl) footerParts.push(`<${artifactUrl}|Full report>`);
  footerParts.push('_May need manual intervention_');
  slackBlocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: footerParts.join('  ·  ') }],
  });

  return { jira: jiraLines.join('\n'), slack: slackBlocks };
}

// ─────────────────────────────────────────────────
// In-Progress Comment (JIRA only)
// ─────────────────────────────────────────────────

export function buildInProgressComment(config, ticket) {
  const lines = [];
  lines.push('### Starting Work');
  lines.push('');
  lines.push(`Working on: **${ticket.affectedSystems.join(', ')}** — targeting \`${ticket.targetBranch}\``);
  lines.push('');

  if (ticket.description && ticket.description !== 'No description provided') {
    const brief = safeSummarise(ticket.description, { limit: 300, label: 'in-progress-desc' });
    lines.push(brief);
  }

  return { jira: lines.join('\n'), slack: null };
}

// ─────────────────────────────────────────────────
// Lead Review Comment (JIRA only)
// ─────────────────────────────────────────────────

export function buildLeadReviewComment(config, allPRs, cheatsheetSummary) {
  const lines = [];
  lines.push('### Ready for Review');
  lines.push('');

  // Human summary
  if (cheatsheetSummary) {
    const summary = buildHumanSummary(cheatsheetSummary, 500);
    lines.push(summary);
    lines.push('');
  }

  // PR links
  if (allPRs.length > 0) {
    for (const pr of allPRs) {
      lines.push(`- [PR #${pr.prId}](${prUrl(config, pr)}) — ${pr.service} / ${pr.baseBranch}`);
    }
  }

  return { jira: lines.join('\n'), slack: null };
}
