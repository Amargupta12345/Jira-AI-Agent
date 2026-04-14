/**
 * Contract prompt builders — generate instructions telling agents
 * to write structured JSON contract files via the Write tool.
 *
 * These instructions are appended to agent prompts so the system
 * can read deterministic decisions from disk instead of parsing prose.
 */

/**
 * Build instructions for the agreement contract.
 *
 * @param {string} contractPath - Absolute path where agent should write the JSON
 * @returns {string} Instruction block to append to the agreement prompt
 */
export function buildAgreementContractPrompt(contractPath) {
  return [
    '',
    '## Required: Write Decision Contract',
    '',
    'After your analysis, you MUST use the Write tool to create the following JSON file.',
    'This is how the system reads your decision — your markdown text is for discussion only.',
    '',
    `**File path:** \`${contractPath}\``,
    '',
    'If you AGREE (your existing plan already covers all valid critiques without changes):',
    '```json',
    '{"decision": "AGREED"}',
    '```',
    '',
    'If you DISAGREE (at least one critique requires plan changes):',
    '```json',
    '{"decision": "DISAGREE", "reasoning": "brief explanation of what changed"}',
    '```',
    '',
    'Write this file BEFORE your final response. The decision field must be exactly "AGREED" or "DISAGREE".',
  ].join('\n');
}

/**
 * Build instructions for the evaluation contract.
 *
 * @param {string} contractPath - Absolute path where evaluator should write the JSON
 * @param {{ approvalKeyword?: string, rejectionKeyword?: string }} [opts]
 * @returns {string} Instruction block to append to the evaluation prompt
 */
export function buildEvaluationContractPrompt(contractPath, opts = {}) {
  const approvalKeyword = opts.approvalKeyword || 'APPROVED';
  const rejectionKeyword = opts.rejectionKeyword || 'REJECTED';

  return [
    '',
    '## Required: Write Verdict Contract',
    '',
    'After your evaluation, you MUST use the Write tool to create the following JSON file.',
    'This is how the system reads your verdict — your markdown text is for discussion only.',
    '',
    `**File path:** \`${contractPath}\``,
    '',
    `If you approve:`,
    '```json',
    `{"verdict": "${approvalKeyword}"}`,
    '```',
    '',
    `If you reject:`,
    '```json',
    `{"verdict": "${rejectionKeyword}", "feedback": "what needs fixing", "issues": ["issue 1", "issue 2"]}`,
    '```',
    '',
    `Write this file BEFORE your final response. The verdict field must be exactly "${approvalKeyword}" or "${rejectionKeyword}".`,
  ].join('\n');
}
