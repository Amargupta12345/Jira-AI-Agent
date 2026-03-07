/**
 * PR review context builder.
 *
 * Collects diff context for both uncommitted and committed code paths.
 */

import { execFileSync } from 'child_process';
import { buildTicketContext } from './ticket-context.js';

const GIT_MAX_BUFFER = 10 * 1024 * 1024;

function runGitOrEmpty(cloneDir, args) {
  try {
    return execFileSync('git', args, {
      cwd: cloneDir,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
      maxBuffer: GIT_MAX_BUFFER,
    }).trim();
  } catch {
    return '';
  }
}

function limitDiff(diff, limit = 120000) {
  return diff.length > limit ? `${diff.slice(0, limit)}\n\n[DIFF TRUNCATED]` : diff;
}

function resolveDiffBase(cloneDir, baseBranch) {
  if (!baseBranch) return null;
  const candidates = [`origin/${baseBranch}`, baseBranch];
  for (const candidate of candidates) {
    const resolved = runGitOrEmpty(cloneDir, ['rev-parse', '--verify', candidate]);
    if (resolved) return candidate;
  }
  return null;
}

function buildWorkingTreeDiffContext(cloneDir) {
  const diffStat = runGitOrEmpty(cloneDir, ['diff', '--stat', 'HEAD']);
  const changedFiles = runGitOrEmpty(cloneDir, ['diff', '--name-only', 'HEAD']);
  const fullDiff = runGitOrEmpty(cloneDir, ['diff', 'HEAD']);

  return {
    title: '## Working Tree Diff (HEAD)',
    diffStat,
    changedFiles,
    diff: limitDiff(fullDiff),
  };
}

function buildBaseBranchDiffContext(cloneDir, baseBranch) {
  const diffBase = resolveDiffBase(cloneDir, baseBranch);
  if (!diffBase) return null;

  const diffStat = runGitOrEmpty(cloneDir, ['diff', '--stat', `${diffBase}...HEAD`]);
  const changedFiles = runGitOrEmpty(cloneDir, ['diff', '--name-only', `${diffBase}...HEAD`]);
  const fullDiff = runGitOrEmpty(cloneDir, ['diff', `${diffBase}...HEAD`]);

  if (!diffStat && !changedFiles && !fullDiff) return null;

  return {
    title: `## Base Branch Diff (${diffBase}...HEAD)`,
    diffStat,
    changedFiles,
    diff: limitDiff(fullDiff),
  };
}

function renderDiffSection(section) {
  return [
    section.title,
    '',
    '### Diff Stat',
    section.diffStat || 'No diff stat',
    '',
    '### Changed Files',
    section.changedFiles || 'No changed files',
    '',
    '### Git Diff',
    section.diff || 'No diff',
  ].join('\n');
}

export function buildReviewContext(ticketData, cloneDir, options = {}) {
  const { preWarnings = [], baseBranch } = options;
  const preWarningsText = preWarnings.length > 0
    ? preWarnings.map((w) => `- ${w}`).join('\n')
    : 'None';

  const workingTree = buildWorkingTreeDiffContext(cloneDir);
  const baseBranchDiff = buildBaseBranchDiffContext(cloneDir, baseBranch);

  const parts = [
    buildTicketContext(ticketData),
    '## Pre-Review Structural Warnings',
    preWarningsText,
    '',
    renderDiffSection(workingTree),
  ];

  if (baseBranchDiff) {
    parts.push('', renderDiffSection(baseBranchDiff));
  }

  return parts.join('\n');
}
