/**
 * Council evaluator — configurable quality gate.
 *
 * Runs structural pre-checks (fast, no API calls) then an AI evaluator
 * to judge council output and extract a clean result.
 *
 * The caller configures:
 *  - structural check function
 *  - AI prompt builder
 *  - output markers for extraction
 *  - approval/rejection keywords
 *
 * All AI spawning goes through the AI Provider module via runAI().
 */

import fs from 'fs';
import path from 'path';
import { runAI } from '../../ai-provider/index.js';
import { isGarbageOutput } from '../../ai-provider/provider.js';
import { buildEvaluationContractPrompt, readEvaluationContract } from '../contract/index.js';
import { defaultStructuralCheck, DEFAULT_APPROVAL_KEYWORD, DEFAULT_REJECTION_KEYWORD, DEFAULT_FEEDBACK_MARKER } from '../config/defaults.js';
import { log, warn } from '../../utils/logger.js';

/**
 * Evaluate council output using configurable structural + AI checks.
 *
 * @param {string} councilOutput - Combined output from council rounds
 * @param {object} evalOpts - Evaluation configuration from createCouncil
 * @param {function} [evalOpts.structural] - Structural pre-check: (output) => {passed, feedback}
 * @param {function} evalOpts.buildAiPrompt - (councilOutput, context, force) => prompt string
 * @param {{start: string, end: string}} evalOpts.outputMarkers - Extraction markers
 * @param {string} [evalOpts.approvalKeyword] - Keyword indicating approval
 * @param {string} [evalOpts.rejectionKeyword] - Keyword indicating rejection
 * @param {string} [evalOpts.feedbackMarker] - Marker before feedback text
 * @param {string} evalOpts.context - Context passed to buildAiPrompt
 * @param {object} evalOpts.config - Full config object
 * @param {string} evalOpts.label - Label for log filenames
 * @param {boolean} [force=false] - Force produce best-effort output
 * @returns {Promise<{passed: boolean, feedback: string, output: string|null}>}
 */
export async function evaluate(councilOutput, evalOpts, force = false) {
  const {
    structural = defaultStructuralCheck,
    buildAiPrompt,
    outputMarkers,
    approvalKeyword = DEFAULT_APPROVAL_KEYWORD,
    rejectionKeyword = DEFAULT_REJECTION_KEYWORD,
    feedbackMarker = DEFAULT_FEEDBACK_MARKER,
    context,
    config,
    label = 'eval',
    workspace = null,
    round = null,
  } = evalOpts;

  // Structural pre-check (fast, no API calls)
  const structuralResult = structural(councilOutput);
  if (!force && !structuralResult.passed) {
    return { passed: false, feedback: structuralResult.feedback, output: null };
  }

  // Resolve evaluator list from council config
  const evalConfig = config.council?.evaluator || null;
  const evaluators = resolveEvaluators(evalConfig);

  // Contract path for structured evaluation output
  const contractPath = (workspace && round) ? path.join(workspace, `round-${round}`, 'evaluation-contract.json') : null;

  let prompt = buildAiPrompt(councilOutput, context, force);
  if (contractPath) {
    prompt += buildEvaluationContractPrompt(contractPath, { approvalKeyword, rejectionKeyword });
  }

  // N-evaluator loop with first-success strategy
  for (let i = 0; i < evaluators.length; i++) {
    const evConfig = evaluators[i];
    const evLabel = `evaluator-${i}${force ? '-force' : ''}`;

    log(`[${evLabel}] Trying evaluator ${i + 1}/${evaluators.length}: provider=${evConfig.provider}, model=${evConfig.model || 'default'}`);

    // Clean up stale contract file from previous evaluator attempt
    if (contractPath) try { fs.unlinkSync(contractPath); } catch { /* ignore */ }

    // Override allowedTools to add Write if contract path is available
    const providerConfig = contractPath
      ? { ...evConfig, allowedTools: addWriteTool(evConfig.allowedTools) }
      : evConfig;

    try {
      const result = await runAI({
        prompt,
        workingDir: process.cwd(),
        mode: 'evaluate',
        label: evLabel,
        logDir: config.agent.logDir,
        ticketKey: label,
        config,
        providerConfig,
      });

      const rawOutput = result.output || '';

      if (isGarbageOutput(rawOutput)) {
        warn(`[${evLabel}] Produced garbage output, skipping`);
        continue;
      }

      // Try contract file first
      if (contractPath) {
        const contract = readEvaluationContract(contractPath, { approvalKeyword, rejectionKeyword });
        if (contract.valid) {
          log(`[${evLabel}] Evaluation via contract: ${contract.verdict}`);
          if (contract.verdict === approvalKeyword.toUpperCase()) {
            const extracted = extractByMarkers(rawOutput, outputMarkers);
            if (extracted && extracted.length > 100) {
              return { passed: true, feedback: '', output: extracted };
            }
            return { passed: true, feedback: '', output: councilOutput };
          }
          if (!force) {
            const feedback = contract.feedback || contract.issues?.join('; ') || 'Evaluator rejected without specific feedback';
            return { passed: false, feedback, output: null };
          }
          // Force mode with rejection contract — extract best-effort below
        } else {
          warn(`[${evLabel}] Contract file not found or invalid (${contract.reason}), falling back to keyword matching`);
        }
      }

      // Fallback: keyword matching in raw output (original logic)
      if (rawOutput.includes(approvalKeyword)) {
        const extracted = extractByMarkers(rawOutput, outputMarkers);
        if (extracted && extracted.length > 100) {
          return { passed: true, feedback: '', output: extracted };
        }
        return { passed: true, feedback: '', output: councilOutput };
      }

      if (rawOutput.includes(rejectionKeyword) && !force) {
        const feedback = extractFeedback(rawOutput, feedbackMarker, rejectionKeyword);
        return { passed: false, feedback: feedback || 'Evaluator rejected without specific feedback', output: null };
      }

      // Force mode or ambiguous response — extract best-effort
      if (force) {
        const extracted = extractByMarkers(rawOutput, outputMarkers) || councilOutput;
        return { passed: true, feedback: 'Forced extraction', output: extracted };
      }

      warn(`[${evLabel}] Produced ambiguous response, skipping`);
      continue;

    } catch (err) {
      warn(`[${evLabel}] Failed: ${err.message}`);
      continue;
    }
  }

  // All evaluators failed
  warn('All evaluators failed or produced garbage output');
  if (force) {
    return { passed: true, feedback: 'All evaluators failed, using raw council output', output: councilOutput };
  }
  return { passed: false, feedback: 'All evaluators failed to produce a valid response', output: null };
}

/**
 * Resolve evaluator list from council config.
 */
function resolveEvaluators(evalConfig) {
  if (Array.isArray(evalConfig) && evalConfig.length > 0) return evalConfig;
  if (evalConfig && typeof evalConfig === 'object') return [evalConfig];
  return [{ provider: 'claude', model: 'sonnet', maxTurns: 5, timeoutMinutes: 5, allowedTools: 'Read,Glob,Grep' }];
}

/** Append Write to a comma-separated allowedTools string if not already present. */
function addWriteTool(allowedTools) {
  if (!allowedTools) return 'Read,Write,Glob,Grep';
  return allowedTools.includes('Write') ? allowedTools : `${allowedTools},Write`;
}

/**
 * Extract content between configurable markers.
 * Falls back to extracting everything after the approval keyword.
 */
function extractByMarkers(output, markers) {
  const { start, end } = markers;
  const startIdx = output.indexOf(start);
  const endIdx = output.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return output.substring(startIdx + start.length, endIdx).trim();
  }

  return null;
}

/**
 * Extract feedback text after a configurable marker.
 */
function extractFeedback(output, marker, rejectionKeyword) {
  const idx = output.indexOf(marker);
  if (idx !== -1) {
    return output.substring(idx + marker.length).trim();
  }

  const rejectedIdx = output.indexOf(rejectionKeyword);
  if (rejectedIdx !== -1) {
    return output.substring(rejectedIdx + rejectionKeyword.length).trim().substring(0, 500);
  }

  return null;
}
