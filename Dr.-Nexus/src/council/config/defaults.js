/**
 * Default values for council configuration.
 *
 * Callers can override any of these via createCouncil() options.
 */

export const DEFAULT_AGREEMENT_ROLE =
  'Review all critique(s) carefully. For each issue raised by critics, explain with evidence (file paths, line numbers) whether it is valid or invalid.\n\n' +
  'AGREED means your EXISTING plan already handles every valid critique WITHOUT changes. ' +
  'Use AGREED only when you can point to specific parts of your original proposal that already cover each critique.\n\n' +
  'DISAGREE means at least one valid critique requires you to CHANGE your plan. ' +
  'Respond DISAGREE followed by your complete revised plan incorporating the fixes. ' +
  'This is normal and expected — it means the debate is working.\n\n' +
  'In other words: if you need to add, remove, or modify ANY step in your plan to address a critique, that is a DISAGREE.\n\n' +
  'Your response MUST start with either AGREED or DISAGREE on the first line.';

export const DEFAULT_APPROVAL_KEYWORD = 'APPROVED';
export const DEFAULT_REJECTION_KEYWORD = 'REJECTED';
export const DEFAULT_FEEDBACK_MARKER = '=== FEEDBACK ===';

/**
 * Default structural pre-check: minimum length, file paths, action verbs.
 * @param {string} output - Debate output to check
 * @returns {{passed: boolean, feedback: string}}
 */
export function defaultStructuralCheck(output) {
  if (!output || output.trim().length < 200) {
    return { passed: false, feedback: 'Debate output too short (< 200 chars)' };
  }

  const filePathPattern = /[\w\-./]+\.(js|ts|jsx|tsx|json|yml|yaml|md|css|html|py|go|rs|sh)/g;
  const filePaths = output.match(filePathPattern) || [];
  if (filePaths.length < 2) {
    return { passed: false, feedback: 'Debate output mentions fewer than 2 file paths' };
  }

  const actionPatterns = /\b(create|modify|add|remove|update|change|replace|delete|implement|refactor)\b/gi;
  const actionCount = (output.match(actionPatterns) || []).length;
  if (actionCount < 3) {
    return { passed: false, feedback: 'Debate output lacks actionable language (fewer than 3 action verbs)' };
  }

  return { passed: true, feedback: '' };
}
