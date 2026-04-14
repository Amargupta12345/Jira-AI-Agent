/**
 * Provider result utilities.
 *
 * Pure helpers for output quality checks and normalized result shaping.
 */

/**
 * Check if output indicates rate limiting.
 */
export function isRateLimited(text) {
  if (!text) return false;
  return text.includes("You've hit your limit") || text.includes('resets ');
}

/**
 * Check if output is garbage (empty, too short, or rate-limited).
 */
export function isGarbageOutput(text) {
  if (!text || text.trim().length === 0) return true;
  if (isRateLimited(text)) return true;
  if (text.trim().length < 50) return true;
  return false;
}

/**
 * Build a standardized result object from raw spawn output and parsed adapter output.
 */
export function buildResult(raw, parsed, providerName, adapter) {
  return {
    output: parsed.output,
    completedNormally: parsed.completedNormally,
    exitCode: raw.exitCode,
    numTurns: parsed.numTurns,
    rateLimited: isRateLimited(parsed.output) || adapter.isRateLimited(parsed.output),
    provider: providerName,
    duration: raw.duration,
    sessionId: parsed.sessionId || null,
  };
}

/**
 * Build a standardized failure result for a provider that threw or couldn't run.
 */
export function buildFailureResult(providerName) {
  return {
    output: '',
    completedNormally: false,
    exitCode: -1,
    numTurns: null,
    rateLimited: false,
    provider: providerName,
    duration: 0,
    sessionId: null,
  };
}

/**
 * Pick the best output from multiple results.
 * Prefers structured output (FILES CHANGED/SUMMARY), then longer non-garbage, then any non-empty.
 */
export function pickBestOutput(results) {
  const valid = results.filter((r) => r && r.output && !isGarbageOutput(r.output));
  if (valid.length === 0) {
    return results.find((r) => r && r.output) || results[0] || null;
  }

  const structured = valid.filter((r) =>
    r.output.includes('FILES CHANGED') || r.output.includes('SUMMARY') || r.output.includes('RISKS')
  );
  if (structured.length > 0) {
    return structured.reduce((a, b) => (a.output.length > b.output.length ? a : b));
  }

  const completed = valid.filter((r) => r.completedNormally);
  if (completed.length > 0) {
    return completed.reduce((a, b) => (a.output.length > b.output.length ? a : b));
  }

  return valid.reduce((a, b) => (a.output.length > b.output.length ? a : b));
}
