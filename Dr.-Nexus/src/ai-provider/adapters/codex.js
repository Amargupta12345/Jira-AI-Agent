/**
 * Codex CLI adapter.
 *
 * Translates between the generic ai-provider interface and Codex's CLI.
 * Uses `exec --json` mode for structured JSONL output with thread_id capture.
 * Falls back to `--quiet` mode when structured output isn't needed.
 */

/**
 * Build CLI arguments for Codex.
 *
 * @param {string} prompt - The prompt text
 * @param {object} modeConfig - Mode-specific config (e.g., aiProvider.execute.codex)
 * @param {string} [modeConfig.resumeSessionId] - Thread ID to resume (conversation continuity)
 * @returns {{ args: string[], timeout: number, maxTurns: number }}
 */
export function buildArgs(prompt, modeConfig) {
  const timeoutMinutes = modeConfig.timeoutMinutes || 15;
  const model = modeConfig.model || null;
  const resumeSessionId = modeConfig.resumeSessionId || null;

  const args = ['exec'];

  if (model) {
    args.push('--model', model);
  }

  // Flags must come before positional arguments in some versions of Codex CLI
  args.push('--json', '--full-auto');

  if (resumeSessionId) {
    args.push('resume', resumeSessionId);
  }

  args.push(prompt);

  return {
    args,
    timeout: timeoutMinutes * 60 * 1000,
    maxTurns: 999, // Codex doesn't have a turn concept
  };
}

/**
 * Parse Codex JSONL output.
 *
 * Walks newline-delimited JSON events looking for thread_id and final output.
 * Falls back to raw text if no structured events found (backward compat with --quiet output).
 *
 * @param {string} rawStdout - Full stdout buffer
 * @param {number} exitCode - Process exit code
 * @returns {{ output: string, numTurns: number|null, completedNormally: boolean, sessionId: string|null }}
 */
export function parseStreamOutput(rawStdout, exitCode) {
  let sessionId = null;
  let lastItemText = '';
  let hasStructuredEvents = false;

  const lines = (rawStdout || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    hasStructuredEvents = true;

    // Capture thread_id from thread.started event
    if (event.type === 'thread.started' && event.thread_id) {
      sessionId = event.thread_id;
    }

    // Capture text from message items
    if (event.type === 'item.completed' && event.item) {
      const item = event.item;

      // Format 1: item.type === 'message' with content array (older Codex versions)
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'output_text' || block.type === 'text') {
            lastItemText = block.text || block.value || lastItemText;
          }
        }
      }

      // Format 2: item.type === 'agent_message' with top-level text (Codex 0.1+)
      if (item.type === 'agent_message' && item.text) {
        lastItemText = item.text;
      }
    }
  }

  // If no structured events found, treat as raw text (backward compat with --quiet)
  const output = hasStructuredEvents ? lastItemText : (rawStdout || '');

  return {
    output,
    numTurns: null,
    completedNormally: exitCode === 0 && output.trim().length > 0,
    sessionId,
  };
}

/**
 * Get the CLI command name.
 */
export function getCommand() {
  return 'codex';
}

/**
 * Check if output indicates Codex rate limiting.
 */
export function isRateLimited(output) {
  if (!output) return false;
  return output.includes('rate limit') || output.includes('Rate limit');
}
