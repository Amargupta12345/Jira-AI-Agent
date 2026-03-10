/**
 * JIRA CLI Operations via jira-cli.mjs
 *
 * Uses jira-cli.mjs for transitions, comments, labels, search.
 * CLI location: skills/jira/scripts/jira-cli.mjs (or JIRA_CLI_DIR env var)
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { log, warn, debug } from '../utils/logger.js';

const JIRA_CLI_DIR = process.env.JIRA_CLI_DIR || path.join(process.cwd(), '..', 'jira-creator');
const TRANSITION_TIMEOUT = 2 * 60 * 1000;
const COMMENT_TIMEOUT = 60 * 1000;

/**
 * Generic runner for jira-cli.mjs commands.
 * Never throws; returns { success, output, exitCode }.
 */
async function runJiraCli(args, label, timeoutMs = COMMENT_TIMEOUT) {
  log(`[jira-cli:${label}] Running: node jira-cli.mjs ${args.join(' ').substring(0, 80)}...`);

  try {
    const result = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('node', ['jira-cli.mjs', ...args], {
        cwd: JIRA_CLI_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdin.end();

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`jira-cli (${label}) timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        log(`[jira-cli:${label}] finished: exit=${code}`);
        if (stderr.trim()) {
          debug(`[jira-cli:${label}:stderr] ${stderr.trim().substring(0, 500)}`);
        }
        resolve({ output: stdout, exitCode: code });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn jira-cli.mjs (${label}): ${error.message}`));
      });
    });

    const success = result.exitCode === 0;
    if (!success) {
      warn(`[jira-cli:${label}] exited with code ${result.exitCode}`);
      debug(`[jira-cli:${label}] Output: ${result.output.substring(0, 500)}`);
    }

    return { success, output: result.output, exitCode: result.exitCode };

  } catch (error) {
    warn(`[jira-cli:${label}] Failed: ${error.message}`);
    return { success: false, output: error.message, exitCode: null };
  }
}

function runJiraCliTransition(ticketKey, transitionName, label) {
  return runJiraCli(['transition', ticketKey, transitionName], label, TRANSITION_TIMEOUT);
}

export async function transitionToInProgress(config, ticketKey) {
  log(`Transitioning ${ticketKey} to In-Progress (Dev Started)...`);
  const result = await runJiraCliTransition(ticketKey, 'Dev Started', `in-progress-${ticketKey}`);
  if (result.success) {
    log(`${ticketKey} transitioned to In-Progress`);
    return true;
  }
  warn(`Could not transition ${ticketKey} to In-Progress`);
  return false;
}

export async function transitionToLeadReview(config, ticketKey) {
  log(`Transitioning ${ticketKey} to LEAD REVIEW (Dev Testing -> EM Review)...`);

  const devResult = await runJiraCliTransition(ticketKey, 'Dev Testing', `dev-testing-${ticketKey}`);
  if (!devResult.success) {
    warn(`Dev Testing transition failed for ${ticketKey} — skipping EM Review`);
    return { devTestingDone: false, emReviewDone: false };
  }

  log(`${ticketKey} Dev Testing done, waiting 3s for JIRA to process...`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  const emResult = await runJiraCliTransition(ticketKey, 'EM Review', `em-review-${ticketKey}`);
  if (!emResult.success) {
    warn(`EM Review transition failed for ${ticketKey}`);
    return { devTestingDone: true, emReviewDone: false };
  }

  log(`${ticketKey} transitioned to EM Review (LEAD REVIEW)`);
  return { devTestingDone: true, emReviewDone: true };
}

/**
 * Search JIRA tickets via jira-cli.mjs search command.
 * THROWS on failure.
 */
export async function searchTickets(jql, maxResults, fields) {
  const result = await runJiraCli(
    ['search', '--jql', jql, '--max-results', String(maxResults), '--fields', fields.join(','), '--json'],
    'search',
    30000
  );

  if (!result.success) {
    throw new Error(`JIRA search failed (exit ${result.exitCode}): ${result.output.substring(0, 500)}`);
  }

  const data = JSON.parse(result.output);
  return data.issues || [];
}

export async function addLabel(ticketKey, label) {
  const result = await runJiraCli(
    ['label', 'add', ticketKey, label],
    `label-add-${ticketKey}`
  );
  return result.success;
}

export async function removeLabel(ticketKey, label) {
  const result = await runJiraCli(
    ['label', 'remove', ticketKey, label],
    `label-remove-${ticketKey}`
  );
  return result.success;
}

/**
 * Post a Markdown comment to a JIRA ticket via jira-cli.mjs.
 * Uses --file flag with temp markdown file + --auto-summarize.
 */
export async function postComment(ticketKey, markdownText) {
  const tmpFile = path.join(os.tmpdir(), `jira-comment-${ticketKey}-${Date.now()}.md`);

  try {
    await fs.writeFile(tmpFile, markdownText, 'utf-8');

    const result = await runJiraCli(
      ['comment', 'add', ticketKey, '--file', tmpFile, '--auto-summarize'],
      `comment-${ticketKey}`,
      COMMENT_TIMEOUT
    );

    return result.success;
  } catch (error) {
    warn(`Failed to post comment to ${ticketKey}: ${error.message}`);
    return false;
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch { /* best-effort cleanup */ }
  }
}
