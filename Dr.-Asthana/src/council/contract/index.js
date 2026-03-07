/**
 * Contract module — public API.
 *
 * Structured JSON contracts written by agents via the Write tool,
 * replacing fragile string-matching of free-form AI output.
 */

export { buildAgreementContractPrompt, buildEvaluationContractPrompt } from './prompt.js';
export { readAgreementContract, readEvaluationContract } from './reader.js';
