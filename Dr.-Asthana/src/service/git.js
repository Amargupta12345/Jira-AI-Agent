/**
 * Git operations: clone, branch, commit, push, cleanup.
 * REMOVED: cloneForPlanning (no more master plan approach in v2).
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log, warn } from '../utils/logger.js';

const CLONE_TIMEOUT = 15 * 60 * 1000;
const LOCAL_TMP_BASE = path.join(process.cwd(), '.tmp');
const CMD_TIMEOUT = 10 * 60 * 1000;

function sanitizeBranchName(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function execGit(cmd, cwd, timeout = CMD_TIMEOUT) {
  try {
    return execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    });
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    throw new Error(`Git command failed: ${cmd}\n${stderr || stdout || error.message}`);
  }
}

/**
 * Clone repo, checkout base branch, create feature branch
 */
export async function cloneAndBranch(config, repoUrl, baseBranch, ticketKey, ticketSummary, version = null) {
  if (!fs.existsSync(LOCAL_TMP_BASE)) {
    fs.mkdirSync(LOCAL_TMP_BASE, { recursive: true });
  }
  const tmpDir = fs.mkdtempSync(path.join(LOCAL_TMP_BASE, 'agent-'));
  log(`Created temp directory: ${tmpDir}`);

  try {
    log(`Cloning: ${repoUrl}`);
    log(`Branch: ${baseBranch}`);
    execGit(
      `git clone --depth=50 --branch "${baseBranch}" "${repoUrl}" .`,
      tmpDir,
      CLONE_TIMEOUT
    );

    const sanitizedSummary = sanitizeBranchName(ticketSummary);
    const featureBranch = version
      ? `feature/${ticketKey}-${sanitizedSummary}-${version}`
      : `feature/${ticketKey}-${sanitizedSummary}`;
    log(`Creating branch: ${featureBranch}`);
    execGit(`git checkout -b "${featureBranch}"`, tmpDir);

    // Check for existing instruction files (CLAUDE.md, CODEX.md, codex.md)
    const instructionFiles = ['CLAUDE.md', 'CODEX.md', 'codex.md'];
    const configuredProvider = config?.aiProvider?.execute?.provider || 'claude';
    const preferredInstructionFile = configuredProvider === 'codex' ? 'codex.md' : 'CLAUDE.md';
    let instructionFile = preferredInstructionFile;
    let serviceHasInstructionFile = false;

    for (const f of instructionFiles) {
      if (fs.existsSync(path.join(tmpDir, f))) {
        instructionFile = f;
        serviceHasInstructionFile = true;
        break;
      }
    }

    if (!serviceHasInstructionFile) {
      // Copy default instruction file from project root
      const fallbackInstructionFiles = [
        preferredInstructionFile,
        ...instructionFiles.filter(f => f !== preferredInstructionFile),
      ];

      const defaultInstruction = fallbackInstructionFiles
        .map(f => ({ name: f, fullPath: path.join(process.cwd(), f) }))
        .find(f => fs.existsSync(f.fullPath));

      if (defaultInstruction) {
        instructionFile = defaultInstruction.name;
        fs.copyFileSync(defaultInstruction.fullPath, path.join(tmpDir, instructionFile));
        log(`Copied default ${instructionFile} (service has none)`);
      }
    } else {
      log(`Service has its own ${instructionFile}`);
    }

    return {
      tmpDir,
      featureBranch,
      baseBranch,
      serviceHasInstructionFile,
      instructionFile,
    };
  } catch (error) {
    cleanup(tmpDir);
    throw error;
  }
}

/**
 * Stage, commit, and push changes.
 * Restores instruction file before committing.
 */
export async function commitAndPush(tmpDir, featureBranch, ticketKey, ticketSummary, serviceHasInstructionFile = false, instructionFile = 'CLAUDE.md') {
  execGit('git add -A', tmpDir);

  // Restore instruction file — injected rules never reach remote
  if (serviceHasInstructionFile) {
    try {
      execGit(`git checkout HEAD -- "${instructionFile}"`, tmpDir);
    } catch { /* no changes to restore */ }
  } else {
    try {
      execGit(`git reset HEAD "${instructionFile}"`, tmpDir);
    } catch { /* not staged */ }
  }

  // Check for staged changes
  try {
    execGit('git diff --cached --quiet', tmpDir);
    log('No changes to commit');
    return { pushed: false };
  } catch {
    // Non-zero exit = there are changes — expected
  }

  const commitMessage = `ID:${ticketKey}; ${ticketSummary}`;
  const commitMsgFile = path.join(tmpDir, '.commit-msg-tmp');
  fs.writeFileSync(commitMsgFile, commitMessage);

  try {
    execGit(`git commit -F "${commitMsgFile}"`, tmpDir);
  } finally {
    if (fs.existsSync(commitMsgFile)) {
      fs.unlinkSync(commitMsgFile);
    }
  }

  log(`Pushing ${featureBranch}...`);
  try {
    execGit(`git push -u origin "${featureBranch}"`, tmpDir);
  } catch (error) {
    if (error.message.includes('rejected') || error.message.includes('fetch first')) {
      log('Remote branch exists from previous run, force pushing...');
      execGit(`git push -u origin "${featureBranch}" --force`, tmpDir);
    } else {
      throw error;
    }
  }

  return { pushed: true };
}

/**
 * Clean up temp directory
 */
export function cleanup(tmpDir) {
  if (!tmpDir || !tmpDir.includes(LOCAL_TMP_BASE)) {
    warn(`Refusing to clean up suspicious path: ${tmpDir}`);
    return;
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    log(`Cleaned up: ${tmpDir}`);
  } catch (error) {
    warn(`Cleanup failed: ${error.message}`);
  }
}
