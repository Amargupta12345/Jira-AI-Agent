/**
 * Multi-PR Creator
 *
 * Given a Jira ticket key, reads all fix versions, detects the current git
 * branch and repo, shows a confirmation prompt, then creates one Azure DevOps
 * PR per selected fix version — no browser, no manual steps.
 *
 * Usage (run from inside the service repo):
 *   node src/index.js multi-pr JCP-10669
 *   node src/index.js multi-pr JCP-10669 --branch feature/my-fix
 *   node src/index.js multi-pr JCP-10669 --branch feature/my-fix --repo blitzkrieg
 */

import readline from 'readline';
import { execSync } from 'child_process';
import { getTicketDetails } from '../jira/client.js';
import { parseTicket } from '../jira/parser.js';
import { createPR } from './azure.js';
import { log, ok, warn, err } from '../utils/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function gitCmd(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function detectCurrentBranch(cwd) {
  return gitCmd('git rev-parse --abbrev-ref HEAD', cwd);
}

function detectRepoName(cwd) {
  const remote = gitCmd('git remote get-url origin', cwd);
  if (!remote) return null;
  return remote.split('/').pop().replace(/\.git$/, '');
}

function detectCommitInfo(cwd, branch) {
  const lastMsg = gitCmd(`git log ${branch} -1 --pretty=format:"%s"`, cwd);
  const commitCount = gitCmd(`git rev-list --count origin/HEAD..${branch} 2>/dev/null || git rev-list --count HEAD..${branch} 2>/dev/null || echo "?"`, cwd);
  return { lastMsg, commitCount };
}

function buildSimplePRDescription(config, ticket, targetBranch) {
  const lines = [
    `## ${ticket.summary}`,
    `[${ticket.key}](${config.jira.baseUrl}/browse/${ticket.key})`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Ticket** | [${ticket.key}](${config.jira.baseUrl}/browse/${ticket.key}) |`,
    `| **Type** | ${ticket.type} |`,
    `| **Priority** | ${ticket.priority} |`,
    `| **Target Branch** | \`${targetBranch}\` |`,
    `| **Affected Systems** | ${ticket.affectedSystems.join(', ') || '—'} |`,
    '',
    '---',
    '_Created by Nexus multi-pr CLI_',
  ];
  return lines.join('\n');
}

function printBanner(ticket, sourceBranch, repoName, targetBranches) {
  const summaryShort = ticket.summary.length > 65
    ? ticket.summary.substring(0, 62) + '...'
    : ticket.summary;

  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  Nexus — Multi-PR Creator                                           │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Ticket : ${ticket.key} — ${summaryShort}`);
  console.log(`  Repo   : ${repoName}`);
  console.log(`  Source : ${sourceBranch}`);
  console.log('');
  console.log('  PRs to create:');
  console.log('');
  targetBranches.forEach((tb, i) => {
    console.log(`    [${i + 1}]  ${sourceBranch}`);
    console.log(`         → ${tb.branch}  (${tb.versionName})`);
    console.log('');
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Interactive multi-PR creator.
 *
 * @param {object} config       - Full Dr. Nexus config
 * @param {string} ticketKey    - Jira ticket key (e.g. "JCP-10669")
 * @param {object} [options]
 * @param {string} [options.sourceBranch] - Override: source branch name
 * @param {string} [options.repo]         - Override: Azure DevOps repo name
 * @param {string} [options.cwd]          - Override: working directory (default: process.cwd())
 */
export async function createMultiPR(config, ticketKey, options = {}) {
  const cwd = options.cwd || process.cwd();

  // ── 1. Fetch Jira ticket ─────────────────────────────────────────────────
  log(`[multi-pr] Fetching ${ticketKey} from Jira...`);

  let rawTicket;
  try {
    rawTicket = await getTicketDetails(config, ticketKey);
  } catch (e) {
    err(`[multi-pr] Failed to fetch ${ticketKey}: ${e.message}`);
    process.exit(1);
  }

  const ticket = parseTicket(config, rawTicket);

  if (ticket.targetBranches.length === 0) {
    err(`[multi-pr] No fix versions found on ${ticketKey}.`);
    err('         Add fix versions in Jira first, then re-run.');
    process.exit(1);
  }

  // ── 2. Detect git context ────────────────────────────────────────────────
  const sourceBranch = options.sourceBranch || detectCurrentBranch(cwd);
  const repoName = options.repo || detectRepoName(cwd);

  if (!sourceBranch) {
    err('[multi-pr] Could not detect current git branch.');
    err('         Run from inside the service repo, or pass --branch <branch>');
    process.exit(1);
  }

  if (!repoName) {
    err('[multi-pr] Could not detect repo name from git remote.');
    err('         Run from inside the service repo, or pass --repo <name>');
    process.exit(1);
  }

  if (sourceBranch === 'HEAD' || sourceBranch === 'main' || sourceBranch.startsWith('version/')) {
    warn(`[multi-pr] Source branch is "${sourceBranch}" — this looks like a base branch, not a feature branch.`);
    const cont = await prompt('         Continue anyway? (y/n): ');
    if (cont.toLowerCase() !== 'y') {
      log('[multi-pr] Cancelled.');
      process.exit(0);
    }
  }

  // ── 3. Show commit info ───────────────────────────────────────────────────
  const { lastMsg, commitCount } = detectCommitInfo(cwd, sourceBranch);

  // ── 4. Print banner + PR list ─────────────────────────────────────────────
  printBanner(ticket, sourceBranch, repoName, ticket.targetBranches);

  if (lastMsg) {
    console.log(`  Last commit : ${lastMsg}`);
    if (commitCount && commitCount !== '?') {
      console.log(`  Ahead by    : ${commitCount} commit(s)`);
    }
    console.log('');
  }

  // ── 5. Confirm selection ──────────────────────────────────────────────────
  const answer = await prompt(
    `  Create PRs? Enter numbers (e.g. 1,2), 'all', or Enter to cancel:\n  > `
  );

  if (!answer) {
    log('[multi-pr] Cancelled.');
    process.exit(0);
  }

  let selected;
  if (answer.toLowerCase() === 'all') {
    selected = ticket.targetBranches;
  } else {
    const nums = answer
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    selected = ticket.targetBranches.filter((_, i) => nums.includes(i + 1));
  }

  if (selected.length === 0) {
    warn('[multi-pr] No valid selection. Cancelled.');
    process.exit(0);
  }

  // ── 6. Create PRs ─────────────────────────────────────────────────────────
  console.log('');
  log(`[multi-pr] Creating ${selected.length} PR(s)...`);
  console.log('');

  const results = [];

  for (const tb of selected) {
    const description = buildSimplePRDescription(config, ticket, tb.branch);

    const pr = await createPR(
      config,
      cwd,
      sourceBranch,
      tb.branch,
      ticketKey,
      ticket.summary,
      description,
      { repoName },
    );

    if (pr) {
      ok(`  ✓  ${tb.versionName.padEnd(30)}  ${pr.prUrl}${pr.alreadyExists ? '  (already existed)' : ''}`);
      results.push({ version: tb.versionName, branch: tb.branch, ...pr });
    } else {
      err(`  ✗  ${tb.versionName.padEnd(30)}  FAILED — check logs above`);
      results.push({ version: tb.versionName, branch: tb.branch, failed: true });
    }
  }

  // ── 7. Summary ────────────────────────────────────────────────────────────
  console.log('');

  const succeeded = results.filter((r) => !r.failed);
  const failed = results.filter((r) => r.failed);

  if (succeeded.length > 0) {
    ok(`[multi-pr] ${succeeded.length}/${results.length} PR(s) created successfully`);
  }

  if (failed.length > 0) {
    warn(`[multi-pr] ${failed.length} PR(s) failed:`);
    for (const r of failed) {
      warn(`           ${r.version} (→ ${r.branch})`);
    }
    warn('         Common fixes:');
    warn('           • Run "az devops login" to refresh Azure auth');
    warn('           • Verify the target branch exists in Azure DevOps');
    warn('           • Check that azureDevOps.pat is set in config.json');
    process.exit(1);
  }

  console.log('');
}
