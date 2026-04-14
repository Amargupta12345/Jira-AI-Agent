/**
 * Pipeline Orchestrator.
 *
 * Knows about all modules. Runs steps in sequence.
 * Each step: log start → post JIRA step comment → execute → save checkpoint → handle result.
 *
 * Steps 1-2 run once. Steps 3-7 process a single service/branch. Step 8 runs once at end.
 */

import fs from 'fs';
import path from 'path';
import { getTicketDetails, parseTicket, displayTicketDetails, validateTicket } from '../jira/index.js';
import { transitionToInProgress, transitionToLeadReview, postComment, addLabel, removeLabel } from '../jira/index.js';
import { getServiceConfig, getRepoUrl } from '../utils/config.js';
import { cloneAndBranch, commitAndPush, cleanup } from '../service/index.js';
import { createPR } from '../service/azure.js';
import { handleBaseTag } from '../service/base-tagger.js';
import { buildCheatsheet, validateExecution, reviewDiff, reviewPullRequest } from '../prompt/index.js';
import { execute } from '../agent/index.js';
import {
  postJiraStep,
  postFinalJiraReport,
  notifySlackSuccess,
  notifySlackFailure,
  postInProgressComment,
  postLeadReviewComment,
} from '../notification/index.js';
import { stopServices } from '../infra/index.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint, getCheckpointPath } from './checkpoint.js';
import { bundleRunArtifact } from './bundler.js';
import { STEPS, getStepNumber } from './steps.js';
import * as logger from '../utils/logger.js';

const { log, ok, warn, err, startStep, endStep, initRun, finalizeRun, getRunLogPaths } = logger;

/**
 * Run the full pipeline for a ticket.
 *
 * @param {object} config - Full config object
 * @param {string|object} ticketOrKey - Ticket key string or ticket object from search
 * @param {object} [options]
 * @param {number} [options.fromStep=1] - Step number to start from (used by resume)
 * @returns {Promise<{success: boolean, prs?: object[], errors?: string[]}>}
 */
export async function runPipeline(config, ticketOrKey, options = {}) {
  const fromStep = typeof options.fromStep === 'number' ? options.fromStep : 1;
  const ticketKey = typeof ticketOrKey === 'string' ? ticketOrKey : ticketOrKey.key;
  const runCtx = { infraStarted: false };

  // Set _currentTicketKey so downstream modules (agent, debate) can use it for log filenames
  config._currentTicketKey = ticketKey;

  const runId = initRun(ticketKey, config.agent.logDir);
  log(`Processing: ${ticketKey} (Run ID: ${runId})${fromStep > 1 ? ` — resuming from step ${fromStep}` : ''}`);

  // Load checkpoint data once up front when resuming
  let checkpointData = null;
  if (fromStep > 1) {
    checkpointData = loadCheckpoint(ticketKey);
    if (!checkpointData) {
      warn(`No checkpoint found for ${ticketKey} — running from step 1`);
    }
  }

  try {
    let ticket;

    if (fromStep <= 1) {
      // ══════ Step 1: FETCH_TICKET ══════
      startStep(1, 'Fetch and parse ticket');
      const rawTicket = await getTicketDetails(config, ticketKey);
      ticket = parseTicket(config, rawTicket);
      displayTicketDetails(ticket, logger);
      saveCheckpoint(ticketKey, STEPS.FETCH_TICKET, { ticketData: ticket });
      endStep(true, `Ticket fetched: ${ticket.summary.substring(0, 50)}...`);
    } else {
      ticket = checkpointData?.ticketData;
      if (!ticket) throw new Error(`Cannot resume from step ${fromStep}: no ticket data in checkpoint`);
      log(`Step 1 skipped (resuming from step ${fromStep}): using checkpoint ticket data`);
    }

    // Set artifact directory so downstream modules write AI call logs there
    const artifactDir = getCheckpointPath(ticketKey);
    config._artifactDir = artifactDir;
    const aiCallsDir = path.join(artifactDir, 'ai-calls');
    if (!fs.existsSync(aiCallsDir)) fs.mkdirSync(aiCallsDir, { recursive: true });

    if (fromStep <= 2) {
      // ══════ Step 2: VALIDATE_TICKET ══════
      startStep(2, 'Validate ticket fields');
      const validationErrors = validateTicket(config, ticket);
      if (validationErrors.length > 0) {
        for (const error of validationErrors) warn(`Validation failed: ${error}`);
        await postComment(ticketKey, `NEXUS: Cannot process ticket.\n\nValidation errors:\n${validationErrors.map(e => '- ' + e).join('\n')}`);
        endStep(false, `Validation failed: ${validationErrors.join(', ')}`);
        finalizeRun(false, 'Validation failed');
        return { success: false, reason: 'validation_failed', errors: validationErrors };
      }
      saveCheckpoint(ticketKey, STEPS.VALIDATE_TICKET, { ticketData: ticket });
      endStep(true, 'All required fields present');

      // Transition to In-Progress + comment (both non-blocking, independent)
      try {
        await transitionToInProgress(config, ticketKey);
      } catch (e) {
        warn(`In-Progress transition failed (non-blocking): ${e.message}`);
      }
      try {
        await postInProgressComment(config, ticketKey, ticket);
        log(`In-Progress comment posted for ${ticketKey}`);
      } catch (e) {
        warn(`In-Progress comment failed (non-blocking): ${e.message}`);
      }
    } else {
      log(`Steps 1-2 skipped (resuming from step ${fromStep})`);
    }

    // ══════ Steps 3-7: Single service, single branch ══════
    const serviceName = ticket.affectedSystems[0];
    const serviceConfig = getServiceConfig(config, serviceName);
    const repoUrl = getRepoUrl(config, serviceName);
    const baseBranch = ticket.targetBranch;
    const version = ticket.targetBranches?.[0]?.version || null;

    let pr = null;
    let failure = null;
    let cheatsheetSummary = '';

    log(`\n--- Processing ${serviceName} / ${baseBranch} ---`);

    try {
      const result = await processServiceBranch(
        config, ticket, serviceConfig, repoUrl, ticketKey,
        baseBranch, version, runCtx, fromStep, checkpointData
      );

      if (result.pr) {
        pr = { service: serviceName, ...result.pr };
      } else if (result.error) {
        failure = { service: serviceName, baseBranch, error: result.error };
      }

      if (result.cheatsheetSummary) {
        cheatsheetSummary = result.cheatsheetSummary;
      }
    } catch (branchError) {
      err(`Failed to process ${serviceName}/${baseBranch}: ${branchError.message}`);
      failure = { service: serviceName, baseBranch, error: branchError.message };
    }

    const allPRs = pr ? [pr] : [];
    const allFailures = failure ? [failure] : [];

    // ══════ Step 8: NOTIFY ══════
    startStep(8, 'Update JIRA and send notifications');

    // Bundle run artifact: copy run logs into artifact dir, tar, upload
    const runLogPaths = getRunLogPaths();
    const bundle = await bundleRunArtifact(ticketKey, artifactDir, runLogPaths);
    const artifactUrl = bundle.url || null;

    if (allPRs.length === 0) {
      warn('No PRs created across any service/branch');
      const noPrMsg = artifactUrl
        ? `NEXUS: No PRs created. Manual implementation may be needed.\n\nRun Artifact: ${artifactUrl}`
        : 'NEXUS: No PRs created. Manual implementation may be needed.';
      await postComment(ticketKey, noPrMsg);
      endStep(false, 'No PRs created');
      finalizeRun(false, 'No PRs created');
      return { success: false, reason: 'no_prs_created' };
    }

    // Transition to LEAD REVIEW + comment (both non-blocking, independent)
    try {
      await transitionToLeadReview(config, ticketKey);
    } catch (e) {
      warn(`LEAD REVIEW transition failed (non-blocking): ${e.message}`);
    }
    try {
      await postLeadReviewComment(config, ticketKey, allPRs, cheatsheetSummary);
    } catch (e) {
      warn(`Lead review comment failed (non-blocking): ${e.message}`);
    }

    // Post final JIRA comment
    await postFinalJiraReport(config, ticketKey, allPRs, allFailures, cheatsheetSummary, artifactUrl);

    // Update labels
    await removeLabel(ticketKey, config.jira.label);
    const versionMatch = pr.baseBranch.match(/version\/(.+)/);
    const processedLabel = versionMatch
      ? `${config.jira.labelProcessed}-${versionMatch[1]}`
      : config.jira.labelProcessed;
    await addLabel(ticketKey, processedLabel);

    // Slack notification
    await notifySlackSuccess(config, ticketKey, ticket.summary, allPRs, allFailures, cheatsheetSummary, artifactUrl);
    endStep(true, 'JIRA comment and Slack notification sent');

    saveCheckpoint(ticketKey, STEPS.NOTIFY, { allPRs, allFailures });
    clearCheckpoint(ticketKey);

    ok(`Successfully processed ${ticketKey} — ${allPRs.length} PR(s) created`);
    finalizeRun(true, `${allPRs.length} PR(s) created`);

    return { success: true, prs: allPRs };

  } catch (error) {
    err(`Error processing ${ticketKey}: ${error.message}`);
    err(`Stack trace: ${error.stack}`);
    try {
      let failArtifactUrl = null;
      try {
        const failArtifactDir = config._artifactDir;
        if (failArtifactDir) {
          const failBundle = await bundleRunArtifact(ticketKey, failArtifactDir, getRunLogPaths());
          failArtifactUrl = failBundle.url;
        }
      } catch (bundleErr) {
        warn(`Artifact bundling failed in error handler: ${bundleErr.message}`);
      }

      const failMsg = failArtifactUrl
        ? `NEXUS failed: ${error.message}\n\nRun Artifact: ${failArtifactUrl}`
        : `NEXUS failed: ${error.message}`;
      await postComment(ticketKey, failMsg);
      await notifySlackFailure(config, ticketKey, { key: ticketKey, summary: ticketKey }, error, failArtifactUrl);
    } catch (e) {
      err(`Failed to send failure notification: ${e.message}`);
    }
    finalizeRun(false, `Error: ${error.message}`);
    return { success: false, reason: 'error', error: error.message };
  } finally {
    if (runCtx.infraStarted) {
      await stopServices(config);
    }
  }
}

/**
 * Resume a failed run from a specific step.
 *
 * Steps 1-2  (FETCH_TICKET, VALIDATE_TICKET) — skipped, ticket data loaded from checkpoint.
 * Step  3    (CLONE_REPO)                    — always re-runs (tmp dir was cleaned up).
 * Step  4    (BUILD_CHEATSHEET)              — skipped when fromStep >= 5 and cheatsheet in checkpoint.
 * Steps 5-6  (EXECUTE, VALIDATE_EXECUTION)  — skipped when fromStep >= 7.
 * Step  7    (SHIP)                          — always re-runs.
 * Step  8    (NOTIFY)                        — always re-runs.
 *
 * @param {object} config
 * @param {string} ticketKey
 * @param {number|string} fromStep - Step number or name to resume from
 */
export async function resume(config, ticketKey, fromStep) {
  const checkpoint = loadCheckpoint(ticketKey);
  if (!checkpoint) {
    throw new Error(`No checkpoint found for ${ticketKey}`);
  }

  const stepNum = typeof fromStep === 'number' ? fromStep : getStepNumber(fromStep);

  log(`Resuming ${ticketKey} from step ${stepNum}`);
  log(`Checkpoint timestamp: ${checkpoint.timestamp}`);
  log(`Checkpoint last completed step: ${checkpoint.currentStep}`);

  if (!checkpoint.ticketData) {
    throw new Error('Cannot resume: no ticket data in checkpoint');
  }

  if (stepNum >= 5 && !checkpoint.cheatsheet) {
    throw new Error(`Cannot resume from step ${stepNum}: no cheatsheet found in checkpoint. Run from step 4 or earlier.`);
  }

  return runPipeline(config, ticketKey, { fromStep: stepNum });
}

/**
 * Create or recover a PR directly from checkpoint data.
 *
 * Intended for auth-recovery scenarios where the branch is already pushed and
 * only Azure DevOps PR creation needs to be retried with manual auth.
 *
 * @param {object} config
 * @param {string} ticketKey
 * @returns {Promise<{success: boolean, pr?: object, reason?: string}>}
 */
export async function createPrFromCheckpoint(config, ticketKey) {
  const checkpoint = loadCheckpoint(ticketKey);
  if (!checkpoint) {
    throw new Error(`No checkpoint found for ${ticketKey}`);
  }

  const ticket = checkpoint.ticketData;
  if (!ticket) {
    throw new Error(`Cannot create PR for ${ticketKey}: missing ticket data in checkpoint`);
  }

  const serviceName = checkpoint.serviceName || ticket.affectedSystems?.[0];
  const serviceConfig = getServiceConfig(config, serviceName);
  if (!serviceConfig?.repo) {
    throw new Error(`Cannot create PR for ${ticketKey}: unknown service "${serviceName}"`);
  }

  const sourceBranch = checkpoint.featureBranch;
  if (!sourceBranch) {
    throw new Error(`Cannot create PR for ${ticketKey}: missing feature branch in checkpoint`);
  }

  const targetBranch = checkpoint.branchName || ticket.targetBranch;
  if (!targetBranch) {
    throw new Error(`Cannot create PR for ${ticketKey}: missing target branch`);
  }

  const cheatsheet = checkpoint.cheatsheet || '';
  const version = ticket.targetBranches?.[0]?.version || null;

  config._currentTicketKey = ticketKey;
  config._artifactDir = getCheckpointPath(ticketKey);

  const runId = initRun(ticketKey, config.agent.logDir);
  log(`Creating PR from checkpoint: ${ticketKey} (Run ID: ${runId})`);

  try {
    startStep(7, `Create PR for ${serviceConfig.repo}/${targetBranch}`);
    const prResult = await createPR(
      config,
      null,
      sourceBranch,
      targetBranch,
      ticketKey,
      ticket.summary,
      cheatsheet,
      {
        validationIssues: [],
        critical: [],
        repoName: serviceConfig.repo,
      }
    );

    if (!prResult?.prId) {
      endStep(false, 'PR creation failed');
      finalizeRun(false, 'PR creation failed');
      return { success: false, reason: 'pr_creation_failed' };
    }

    const action = prResult.alreadyExists ? 'updated' : 'created';
    endStep(true, `PR #${prResult.prId} (${action})`);
    finalizeRun(true, `PR #${prResult.prId} ${action}`);
    return {
      success: true,
      pr: {
        prId: prResult.prId,
        prUrl: prResult.prUrl,
        baseBranch: targetBranch,
        version,
      },
    };
  } catch (error) {
    err(`Failed to create PR from checkpoint for ${ticketKey}: ${error.message}`);
    finalizeRun(false, `Error: ${error.message}`);
    throw error;
  }
}

function mergeWarnings(validationResult, warnings = [], label) {
  if (!warnings || warnings.length === 0) return;
  validationResult.warnings = [...(validationResult.warnings || []), ...warnings];
  validationResult.issues = [...(validationResult.issues || []), ...warnings];
  warn(`${label}: ${warnings.join(', ')}`);
}

function applyPrReviewResult(validationResult, prReview) {
  mergeWarnings(validationResult, prReview.warnings, 'PR review warnings');

  if (prReview.status !== 'rejected') return [];

  const criticalIssues = prReview.critical?.length > 0
    ? prReview.critical
    : [prReview.reason || 'PR review rejected'];
  validationResult.critical = [...(validationResult.critical || []), ...criticalIssues];
  validationResult.issues = [...(validationResult.issues || []), ...criticalIssues];
  validationResult.valid = false;
  warn(`PR review rejected: ${criticalIssues.join(', ')}`);
  return criticalIssues;
}

function buildReviewRetryFeedback(prReview, criticalIssues) {
  const reviewFeedbackLines = [
    'PR review rejected with the following issues:',
    ...criticalIssues.map((issue) => `- CRITICAL: ${issue}`),
    ...(prReview.warnings || []).map((issue) => `- WARNING: ${issue}`),
  ];
  return reviewFeedbackLines.join('\n');
}

/**
 * Process a single (service, branch) combination through steps 3-7.
 *
 * Step 3 (clone) always runs — the tmp dir is cleaned up between runs.
 * Step 4 (cheatsheet) is skipped when fromStep >= 5 and a checkpoint cheatsheet exists.
 * Steps 5-6 (execute + validate) are skipped when fromStep >= 7.
 * Step 7 (ship) always runs.
 */
async function processServiceBranch(config, ticket, serviceConfig, repoUrl, ticketKey, baseBranch, version, runCtx, fromStep = 1, checkpointData = null) {
  let tmpDir = null;

  try {
    // Step 3: CLONE_REPO — always runs (tmp dir was cleaned after the previous run)
    startStep(3, `Clone ${serviceConfig.repo} (${baseBranch})`);
    const cloneResult = await cloneAndBranch(config, repoUrl, baseBranch, ticketKey, ticket.summary, version);
    tmpDir = cloneResult.tmpDir;
    const { featureBranch, serviceHasInstructionFile, instructionFile } = cloneResult;
    log(`Feature branch: ${featureBranch}`);
    saveCheckpoint(ticketKey, STEPS.CLONE_REPO, {
      ticketData: ticket,
      cloneDir: tmpDir,
      featureBranch,
      serviceName: serviceConfig.name,
      branchName: baseBranch,
    });
    endStep(true, `Branch created: ${featureBranch}`);

    // Guard: reject services that use npm instead of pnpm (opt-in via config.agent.pnpmOnly)
    if (config.agent.pnpmOnly) {
      const hasPnpmLock = fs.existsSync(path.join(tmpDir, 'pnpm-lock.yaml'));
      const hasNpmLock = fs.existsSync(path.join(tmpDir, 'package-lock.json'));
      if (!hasPnpmLock && hasNpmLock) {
        const reason = `Service ${serviceConfig.repo} uses npm (package-lock.json found, no pnpm-lock.yaml). Only pnpm services are supported. Disable with "pnpmOnly": false in config.`;
        warn(reason);
        endStep(false, reason);
        return { pr: null, error: reason, cheatsheetSummary: '' };
      }
    }

    const checkpointDir = getCheckpointPath(ticketKey);
    let cheatsheet;

    // Step 4: BUILD_CHEATSHEET — skip if resuming from step 5+ and cheatsheet is in checkpoint
    if (fromStep >= 5 && checkpointData?.cheatsheet) {
      cheatsheet = checkpointData.cheatsheet;
      startStep(4, `Build cheatsheet (skipped — resuming from step ${fromStep})`);
      log(`Using checkpoint cheatsheet (${cheatsheet.length} chars)`);
      endStep(true, `Checkpoint cheatsheet loaded (${cheatsheet.length} chars)`);
    } else {
      startStep(4, `Build cheatsheet for ${serviceConfig.repo}/${baseBranch}`);
      const cheatsheetResult = await buildCheatsheet(ticket, tmpDir, config, {
        checkpointDir,
        ticketKey,
      });

      if (cheatsheetResult.status === 'rejected') {
        warn(`Cheatsheet rejected (${cheatsheetResult.phase}): ${cheatsheetResult.reason}`);
        endStep(false, `Rejected: ${cheatsheetResult.reason}`);
        await postJiraStep(ticketKey, 'Cheatsheet Rejected', cheatsheetResult.reason);
        return { pr: null, error: `Cheatsheet rejected: ${cheatsheetResult.reason}`, cheatsheetSummary: '' };
      }

      cheatsheet = cheatsheetResult.cheatsheet;
      saveCheckpoint(ticketKey, STEPS.BUILD_CHEATSHEET, {
        ticketData: ticket,
        cloneDir: tmpDir,
        featureBranch,
        cheatsheet,
        cheatsheetPath: `${checkpointDir}/cheatsheet.md`,
      });
      endStep(true, `Cheatsheet ready (${cheatsheet.length} chars)`);
    }

    // Steps 5-6: EXECUTE + VALIDATE — skip if resuming from step 7+
    let validationResult = { valid: true, warnings: [], critical: [], issues: [] };

    if (fromStep >= 7) {
      log(`Steps 5-6 skipped (resuming from step ${fromStep}): proceeding directly to ship`);
    } else {
      // Step 5: EXECUTE (with retries)
      let executionResult;
      const maxRetries = config.agent.executionRetries || 2;
      let retryFeedback = '';

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        startStep(5, `Execute cheatsheet (attempt ${attempt}/${maxRetries})`);
        executionResult = await execute(cheatsheet, tmpDir, config, { feedback: retryFeedback });

        if (!executionResult.output || executionResult.output.trim() === '') {
          warn(`Execution attempt ${attempt} produced no output`);
          endStep(false, 'No output');
          if (attempt < maxRetries) continue;
          return { pr: null, error: 'Execution produced no output', cheatsheetSummary: cheatsheet };
        }

        saveCheckpoint(ticketKey, STEPS.EXECUTE, {
          ticketData: ticket,
          cloneDir: tmpDir,
          featureBranch,
          cheatsheet,
          executionOutput: executionResult.output.substring(0, 5000),
        });
        endStep(true, executionResult.completedNormally ? 'Execution completed' : `Exit code ${executionResult.exitCode}`);

        // Step 6: VALIDATE_EXECUTION
        startStep(6, 'Validate execution result');
        validationResult = await validateExecution(cheatsheet, tmpDir);

        // Retry only on critical issues (not warnings)
        if (validationResult.critical?.length > 0 && attempt < maxRetries) {
          warn(`Execution validation critical (attempt ${attempt}): ${validationResult.critical.join(', ')}`);
          retryFeedback = `Execution validation failed with critical issues:\n${validationResult.critical.map((c) => `- CRITICAL: ${c}`).join('\n')}`;
          endStep(false, 'Critical issues, retrying...');
          continue;
        }

        if (validationResult.warnings?.length > 0) {
          warn(`Validation warnings: ${validationResult.warnings.join(', ')}`);
        }

        // Run structural diff review
        const diffReview = await reviewDiff(tmpDir);
        mergeWarnings(validationResult, diffReview.warnings, 'Diff review warnings');

        let prReviewCriticalIssues = [];
        if (validationResult.valid) {
          // Run dedicated PR-review council (independent from cheatsheet council)
          const prReview = await reviewPullRequest(ticket, tmpDir, config, {
            checkpointDir,
            ticketKey,
            baseBranch,
            preWarnings: diffReview.warnings,
          });

          prReviewCriticalIssues = applyPrReviewResult(validationResult, prReview);
          if (prReviewCriticalIssues.length > 0 && attempt < maxRetries) {
            const reviewRetryFeedback = buildReviewRetryFeedback(prReview, prReviewCriticalIssues);
            retryFeedback = [retryFeedback, reviewRetryFeedback].filter(Boolean).join('\n\n');
            endStep(false, 'PR review rejected, retrying execution...');
            continue;
          }
        } else {
          warn('Skipping PR review — validation already failed');
        }

        endStep(validationResult.valid, validationResult.valid ? 'Validation passed' : `Issues: ${validationResult.issues.join(', ')}`);
        break;
      }
    }

    // Critical issues are passed into the PR description as Review Notes for human reviewers.
    // They never block shipping — the PR is always created.
    if (validationResult?.critical?.length > 0) {
      warn(`Validation issues found — proceeding to create PR with review notes: ${validationResult.critical.join(', ')}`);
    }

    // Step 7: SHIP
    startStep(7, `Commit and push ${serviceConfig.repo}/${baseBranch}`);
    const { pushed } = await commitAndPush(tmpDir, featureBranch, ticketKey, ticket.summary, serviceHasInstructionFile, instructionFile);

    if (!pushed) {
      warn('No changes to commit');
      endStep(false, 'No changes');
      return { pr: null, error: 'No changes to commit', cheatsheetSummary: cheatsheet };
    }

    // Handle base tag
    try {
      const baseTagResult = handleBaseTag(tmpDir, baseBranch, serviceConfig.repo);
      if (baseTagResult.tagged) {
        log(`Base tag created: ${baseTagResult.tag}`);
        await commitAndPush(tmpDir, featureBranch, ticketKey, `Update base image tag to ${baseTagResult.tag}`, serviceHasInstructionFile, instructionFile);
      }
    } catch (baseTagError) {
      warn(`Base tag handling failed: ${baseTagError.message}`);
    }

    // Create PR
    const prResult = await createPR(
      config, tmpDir, featureBranch, baseBranch, ticketKey, ticket.summary,
      cheatsheet, {
        validationIssues: validationResult?.warnings || [],
        critical: validationResult?.critical || [],
      }
    );

    if (prResult?.prId) {
      const action = prResult.alreadyExists ? 'updated' : 'created';
      log(`PR #${prResult.prId} ${action}`);
      saveCheckpoint(ticketKey, STEPS.SHIP, {
        ticketData: ticket,
        prData: { prId: prResult.prId, prUrl: prResult.prUrl, baseBranch, version },
      });
      endStep(true, `PR #${prResult.prId} (${action})`);
      return { pr: { prId: prResult.prId, prUrl: prResult.prUrl, baseBranch, version }, cheatsheetSummary: cheatsheet };
    }

    warn('PR creation failed');
    endStep(false, 'PR creation failed');
    return { pr: null, error: 'PR creation failed', cheatsheetSummary: cheatsheet };

  } finally {
    if (tmpDir) {
      cleanup(tmpDir);
    }
  }
}
