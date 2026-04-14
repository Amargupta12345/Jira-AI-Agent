/**
 * Azure DevOps PR creation via az CLI
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { log, warn, err } from '../utils/logger.js';
import { summariseText } from '../utils/summariser.js';

const AZ_TIMEOUT = 5 * 60 * 1000;
const AZ_PR_DESC_LIMIT = 4000;
const AUTH_ERROR_PATTERNS = [
  'requires user authentication',
  'please run: az login',
  'before you can run Azure DevOps commands',
  'the requested resource requires user authentication',
  'TF400813',
  'Unauthorized',
  '401',
];

function getAzurePat(config) {
  const envVarName = config.azureDevOps?.patEnvVar;
  const patFromNamedEnv = envVarName ? process.env[envVarName] : null;
  return patFromNamedEnv || config.azureDevOps?.pat || process.env.AZURE_DEVOPS_EXT_PAT || resolveAzurePatFromCommand(config);
}

function resolveAzurePatFromCommand(config) {
  const tokenCommand = config.azureDevOps?.tokenCommand;
  if (!tokenCommand) return null;

  const shellParts = [];
  if (config.azureDevOps?.sourceZshrc) {
    shellParts.push('source ~/.zshrc >/dev/null 2>&1');
  }
  shellParts.push(tokenCommand);

  try {
    const token = execFileSync('/bin/zsh', ['-lc', shellParts.join('\n')], {
      stdio: 'pipe',
      timeout: 30000,
      encoding: 'utf-8',
      env: process.env,
    }).trim();

    return token || null;
  } catch (error) {
    const stderr = error.stderr?.toString()?.trim();
    const stdout = error.stdout?.toString()?.trim();
    const detail = stderr || stdout || error.message;
    warn(`Failed to resolve Azure DevOps token via shell command: ${detail}`);
    return null;
  }
}

function buildAzEnv(config, tmpDir) {
  const env = { ...process.env };
  const pat = getAzurePat(config);

  if (pat) {
    env.AZURE_DEVOPS_EXT_PAT = pat;
    const azConfigDir = path.join(tmpDir || process.cwd(), '.azure-cli');
    fs.mkdirSync(azConfigDir, { recursive: true });
    env.AZURE_CONFIG_DIR = azConfigDir;

    // Keep the globally installed azure-devops extension visible even when
    // the CLI config directory is redirected into the temp workspace.
    if (!env.AZURE_EXTENSION_DIR) {
      const extensionDir = path.join(os.homedir(), '.azure', 'cliextensions');
      if (fs.existsSync(extensionDir)) {
        env.AZURE_EXTENSION_DIR = extensionDir;
      }
    }
  }

  return env;
}

function buildCommonAzArgs(config) {
  const args = [];
  if (config.azureDevOps.org) {
    args.push('--organization', config.azureDevOps.org);
  }
  if (config.azureDevOps.project) {
    args.push('--project', config.azureDevOps.project);
  }
  return args;
}

function runAz(config, tmpDir, args) {
  return execFileSync('az', args, {
    cwd: tmpDir,
    stdio: 'pipe',
    timeout: AZ_TIMEOUT,
    encoding: 'utf-8',
    env: buildAzEnv(config, tmpDir),
  });
}

function isAzureAuthError(output) {
  return AUTH_ERROR_PATTERNS.some(pattern => output.toLowerCase().includes(pattern.toLowerCase()));
}

function getAuthHelp(config) {
  const envVarName = config.azureDevOps?.patEnvVar;
  if (config.azureDevOps?.pat) {
    return 'Configured Azure DevOps PAT was rejected. Verify azureDevOps.pat has repo PR permissions.';
  }
  if (envVarName) {
    return `Azure DevOps PAT env var "${envVarName}" was not available or was rejected. Export a valid PAT with repo PR permissions, or run "az devops login".`;
  }
  if (config.azureDevOps?.tokenCommand) {
    return `Azure DevOps token command failed or returned an invalid token. Verify azureDevOps.tokenCommand="${config.azureDevOps.tokenCommand}" and that sourcing ~/.zshrc exposes _ado_token in non-interactive zsh.`;
  }
  if (process.env.AZURE_DEVOPS_EXT_PAT) {
    return 'AZURE_DEVOPS_EXT_PAT was rejected. Verify it contains a valid Azure DevOps PAT with repo PR permissions.';
  }
  return 'Azure DevOps PR creation needs API auth. Run "az devops login", set AZURE_DEVOPS_EXT_PAT, or configure azureDevOps.tokenCommand.';
}

/**
 * Build a PR description from cheatsheet, diff stats, and validation issues.
 *
 * @param {object} config
 * @param {string} ticketKey
 * @param {string} ticketSummary
 * @param {string} cheatsheet - The full cheatsheet (will be summarised)
 * @param {string} tmpDir - Clone directory for git diff --stat
 * @param {object} [options]
 * @param {string[]} [options.validationIssues] - Warning messages from validation
 * @param {string[]} [options.critical] - Critical issues from validation
 */
/**
 * Extract file paths mentioned in the cheatsheet with their descriptions.
 */
function extractFileChanges(cheatsheet) {
  if (!cheatsheet) return [];
  const changes = [];
  const seen = new Set();

  // Match "N. **path/file.ext** — description" or "- `path/file.ext` — description"
  const stepPattern = /(?:^\d+\.\s+|^[-*]\s+)(?:\*\*)?`?([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})`?(?:\*\*)?[\s:—–-]+(.+)/gm;
  for (const m of cheatsheet.matchAll(stepPattern)) {
    const file = m[1];
    if (!seen.has(file)) {
      seen.add(file);
      const desc = m[2].replace(/\*\*/g, '').split(/[.\n]/)[0].trim().substring(0, 100);
      if (desc) changes.push({ file, desc });
    }
  }

  // Fallback: just grab unique file paths
  if (changes.length === 0) {
    const filePattern = /(?:`|^[-*]\s+|\*\*)([a-zA-Z0-9_/-]+\.[a-zA-Z]{1,5})(?:`|\*\*)/gm;
    for (const m of cheatsheet.matchAll(filePattern)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        changes.push({ file: m[1], desc: '' });
      }
    }
  }
  return changes;
}

/**
 * Build a PR description for code reviewers (human and AI).
 *
 * This is the ONE place where we want comprehensive detail.
 * Structure: context → approach → files → diff stats → review notes.
 */
function buildPRDescription(config, ticketKey, ticketSummary, cheatsheet, tmpDir, options = {}) {
  const { validationIssues = [], critical = [] } = options;

  // Get diff stats
  let diffStat = '';
  if (tmpDir) {
    try {
      diffStat = execSync('git diff --cached --stat', {
        cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe', timeout: 10000,
      }).trim();
      if (!diffStat) {
        diffStat = execSync('git diff --stat', {
          cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe', timeout: 10000,
        }).trim();
      }
    } catch { /* non-critical */ }
  }

  const fileChanges = extractFileChanges(cheatsheet);

  // Implementation approach — the core of the PR description.
  // Budget: ~2000 chars for approach, ~1000 for files/diff, ~500 for boilerplate = ~3500 total.
  const approach = summariseText(cheatsheet || '', {
    limit: 2000,
    label: 'pr-description',
  });

  const lines = [];

  // Ticket context
  lines.push(`## ${ticketSummary}`);
  lines.push(`[${ticketKey}](${config.jira.baseUrl}/browse/${ticketKey})`);
  lines.push('');

  // Approach — what was done and why (for the reviewer to understand intent)
  if (approach) {
    lines.push('## Approach');
    lines.push(approach);
    lines.push('');
  }

  // Files changed with context
  if (fileChanges.length > 0) {
    lines.push('## Files Changed');
    const maxFiles = 20;
    for (const { file, desc } of fileChanges.slice(0, maxFiles)) {
      lines.push(desc ? `- \`${file}\` — ${desc}` : `- \`${file}\``);
    }
    if (fileChanges.length > maxFiles) {
      lines.push(`- ...and ${fileChanges.length - maxFiles} more`);
    }
    lines.push('');
  }

  // Diff stats
  if (diffStat) {
    // Just the summary line for brevity
    const statLines = diffStat.split('\n');
    const summaryLine = statLines[statLines.length - 1]?.trim();
    if (summaryLine && /files? changed/.test(summaryLine)) {
      lines.push(`_${summaryLine}_`);
      lines.push('');
    }
  }

  // Review notes — flag anything the reviewer should pay attention to
  if (critical.length > 0 || validationIssues.length > 0) {
    lines.push('## Review Notes');
    for (const issue of critical) lines.push(`- **${issue}**`);
    for (const issue of validationIssues) lines.push(`- ${issue}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('_Auto-generated by [NEXUS](https://github.com) · Powered by Claude_');
  lines.push('');
  lines.push('Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>');

  let description = lines.join('\n');
  if (description.length > AZ_PR_DESC_LIMIT) {
    warn(`PR description too long (${description.length} chars), truncating to ${AZ_PR_DESC_LIMIT}`);
    description = description.substring(0, AZ_PR_DESC_LIMIT - 3) + '...';
  }
  return description;
}

/**
 * Create a PR on Azure DevOps.
 *
 * @param {object} config
 * @param {string} tmpDir
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @param {string} ticketKey
 * @param {string} ticketSummary
 * @param {string} cheatsheet - Full cheatsheet content (summarised for PR body)
 * @param {object} [options]
 * @param {string[]} [options.validationIssues]
 * @param {string[]} [options.critical]
 */
export async function createPR(config, tmpDir, sourceBranch, targetBranch, ticketKey, ticketSummary, cheatsheet, options = {}) {
  const { repoName: repoNameOverride } = options;
  const prefix = `[${ticketKey}] `;
  const maxSummaryChars = Math.max(20, 200 - prefix.length);
  const summarisedTitle = summariseText(ticketSummary || '', {
    preset: 'pr-title',
    label: 'pr-title',
  });
  const title = `${prefix}${summarisedTitle.substring(0, maxSummaryChars)}`;
  const description = buildPRDescription(config, ticketKey, ticketSummary, cheatsheet, tmpDir, options);

  let repoName = repoNameOverride || '';
  if (repoNameOverride) {
    log(`Using configured repo name: ${repoName}`);
  } else if (tmpDir) {
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe',
      }).trim();
      repoName = remoteUrl.split('/').pop().replace('.git', '');
      log(`Detected repo name: ${repoName}`);
    } catch (e) {
      warn(`Could not detect repo name: ${e.message}`);
    }
  }

  if (!repoName) {
    err('Failed to create PR: repository name is required');
    return null;
  }

  const args = [
    'repos', 'pr', 'create',
    '--repository', repoName,
    '--source-branch', sourceBranch,
    '--target-branch', targetBranch,
    '--title', title,
    '--description', description,
    '--draft', 'false',
    '--output', 'json',
    ...buildCommonAzArgs(config),
  ];

  log(`Creating PR: ${sourceBranch} -> ${targetBranch}`);

  try {
    const result = runAz(config, tmpDir, args);

    const prData = JSON.parse(result);
    const prId = prData.pullRequestId;
    const prUrl = prData.repository?.webUrl
      ? `${prData.repository.webUrl}/pullrequest/${prId}`
      : `PR #${prId}`;

    log(`Created PR #${prId}`);
    return { prId, prUrl };
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    const output = stderr || stdout || error.message;

    if (output.includes('TF401179') || output.includes('already has an active pull request')) {
      log(`PR already exists for branch ${sourceBranch}, looking up existing PR...`);
      return findExistingPR(config, tmpDir, repoName, sourceBranch);
    }

    if (isAzureAuthError(output)) {
      err(`Failed to create PR: ${getAuthHelp(config)}`);
      err(`Azure CLI output: ${output}`);
      return null;
    }

    err(`Failed to create PR: ${output}`);
    return null;
  }
}

function findExistingPR(config, tmpDir, repoName, sourceBranch) {
  try {
    const args = [
      'repos', 'pr', 'list',
      '--repository', repoName,
      '--source-branch', sourceBranch,
      '--status', 'active',
      '--output', 'json',
      ...buildCommonAzArgs(config),
    ];

    const result = runAz(config, tmpDir, args);

    const prs = JSON.parse(result);
    if (prs.length > 0) {
      const pr = prs[0];
      const prId = pr.pullRequestId;
      const prUrl = pr.repository?.webUrl
        ? `${pr.repository.webUrl}/pullrequest/${prId}`
        : `PR #${prId}`;
      log(`Found existing PR #${prId}`);
      return { prId, prUrl, alreadyExists: true };
    }

    warn(`No active PR found for ${sourceBranch}`);
    return null;
  } catch (e) {
    warn(`Failed to look up existing PR: ${e.message}`);
    return null;
  }
}
