/**
 * Claude Code CLI adapter.
 *
 * Translates between the generic ai-provider interface and Claude Code's
 * --output-format stream-json CLI.
 */

/**
 * Build CLI arguments for Claude Code.
 *
 * @param {string} prompt - The prompt text
 * @param {object} modeConfig - Mode-specific config (e.g., aiProvider.execute.claude)
 * @param {string} [modeConfig.resumeSessionId] - Session ID to resume (conversation continuity)
 * @returns {{ args: string[], timeout: number, maxTurns: number }}
 */
export function buildArgs(prompt, modeConfig) {
  const maxTurns = modeConfig.maxTurns || 30;
  const timeoutMinutes = modeConfig.timeoutMinutes || 15;
  const allowedTools = modeConfig.allowedTools || null;
  const model = modeConfig.model || 'haiku';
  const resumeSessionId = modeConfig.resumeSessionId || null;

  const args = [
    '-p', prompt,
    '--max-turns', String(maxTurns),
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  if (model) {
    args.push('--model', model);
  }

  if (allowedTools) {
    args.push('--allowedTools', allowedTools);
  }

  return {
    args,
    timeout: timeoutMinutes * 60 * 1000,
    maxTurns,
  };
}

/**
 * Parse stream-json stdout from Claude Code.
 *
 * Walks the newline-delimited JSON events and extracts:
 * - lastAssistantText: last text block from an assistant message
 * - resultEventText: the result event's text (if present)
 * - numTurns: from the result event
 * - sessionId: from the result event (for --resume on subsequent calls)
 * - completedNormally: result event received with non-empty text and exit 0
 *
 * @param {string} rawStdout - Full stdout buffer
 * @param {number} exitCode - Process exit code
 * @returns {{ output: string, numTurns: number|null, completedNormally: boolean, sessionId: string|null }}
 */
export function parseStreamOutput(rawStdout, exitCode) {
  let lastAssistantText = '';
  let resultEventText = '';
  let numTurns = null;
  let sessionId = null;
  let resultEventReceived = false;

  const lines = rawStdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          lastAssistantText = block.text;
        }
      }
    } else if (event.type === 'result') {
      resultEventReceived = true;
      if (event.result) resultEventText = event.result;
      numTurns = event.num_turns ?? null;
      sessionId = event.session_id ?? null;
    }

    // Also capture session_id from init event as fallback
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      sessionId = event.session_id;
    }
  }

  const output = resultEventText || lastAssistantText || '';
  const completedNormally = exitCode === 0 && resultEventReceived && resultEventText.length > 0;

  return { output, numTurns, completedNormally, sessionId };
}

/**
 * Get the CLI command name.
 */
export function getCommand() {
  return 'claude';
}

/**
 * Check if output indicates Claude rate limiting.
 */
export function isRateLimited(output) {
  if (!output) return false;
  return output.includes("You've hit your limit") || output.includes('resets ');
}
