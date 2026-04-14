/**
 * Contract file reader — reads and validates structured JSON contracts
 * written by agents via the Write tool.
 *
 * Falls back gracefully when files are missing or malformed.
 */

import fs from 'fs';
import { warn, debug } from '../../utils/logger.js';

/**
 * Read and validate an agreement contract file.
 *
 * Expected shape: { "decision": "AGREED" | "DISAGREE", "reasoning"?: string }
 *
 * @param {string} contractPath - Absolute path to agreement-contract.json
 * @returns {{ valid: boolean, decision?: string, reasoning?: string, reason?: string }}
 */
export function readAgreementContract(contractPath) {
  const raw = readJsonFile(contractPath);
  if (!raw.valid) return raw;

  const { decision } = raw.data;
  if (typeof decision !== 'string' || !['AGREED', 'DISAGREE'].includes(decision.toUpperCase())) {
    return { valid: false, reason: `Invalid decision value: ${JSON.stringify(decision)}` };
  }

  debug(`Agreement contract read: decision=${decision}`);
  return { valid: true, decision: decision.toUpperCase(), reasoning: raw.data.reasoning || null };
}

/**
 * Read and validate an evaluation contract file.
 *
 * Expected shape: { "verdict": "APPROVED" | "REJECTED", "feedback"?: string, "issues"?: string[] }
 *
 * @param {string} contractPath - Absolute path to evaluation-contract.json
 * @param {{ approvalKeyword?: string, rejectionKeyword?: string }} [opts]
 * @returns {{ valid: boolean, verdict?: string, feedback?: string, issues?: string[], reason?: string }}
 */
export function readEvaluationContract(contractPath, opts = {}) {
  const approvalKeyword = (opts.approvalKeyword || 'APPROVED').toUpperCase();
  const rejectionKeyword = (opts.rejectionKeyword || 'REJECTED').toUpperCase();

  const raw = readJsonFile(contractPath);
  if (!raw.valid) return raw;

  const { verdict } = raw.data;
  if (typeof verdict !== 'string') {
    return { valid: false, reason: `Missing or non-string verdict field` };
  }

  const upper = verdict.toUpperCase();
  if (upper !== approvalKeyword && upper !== rejectionKeyword) {
    return { valid: false, reason: `Verdict "${verdict}" does not match ${approvalKeyword} or ${rejectionKeyword}` };
  }

  debug(`Evaluation contract read: verdict=${verdict}`);
  return {
    valid: true,
    verdict: upper,
    feedback: raw.data.feedback || null,
    issues: Array.isArray(raw.data.issues) ? raw.data.issues : null,
  };
}

/**
 * Read and parse a JSON file from disk. Returns { valid, data } or { valid: false, reason }.
 */
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, reason: 'Contract file not found' };
    }
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') {
      return { valid: false, reason: 'Contract file is not a JSON object' };
    }
    return { valid: true, data };
  } catch (err) {
    warn(`Failed to read contract file ${filePath}: ${err.message}`);
    return { valid: false, reason: `Parse error: ${err.message}` };
  }
}
