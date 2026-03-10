/**
 * Single strategy — run one provider, return result.
 * If it fails, return failure. No fallback.
 */

import { buildResult } from '../provider.js';

/**
 * @param {string} prompt
 * @param {string} workingDir
 * @param {object} modeConfig - Mode-specific config section (e.g., aiProvider.execute)
 * @param {object} adapters - Map of provider name -> adapter module
 * @param {function} spawnFn - The provider.spawn function
 * @param {object} options - { label, logDir, ticketKey, resumeSessionId }
 * @returns {Promise<{output, completedNormally, exitCode, numTurns, rateLimited, provider, duration, sessionId}>}
 */
export async function run(prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const providerName = modeConfig.provider || 'claude';
  const adapter = adapters[providerName];
  if (!adapter) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  const providerConfig = {
    ...(modeConfig[providerName] || {}),
    ...(options.resumeSessionId && { resumeSessionId: options.resumeSessionId }),
  };
  const { args, timeout } = adapter.buildArgs(prompt, providerConfig);

  const raw = await spawnFn({
    command: adapter.getCommand(),
    args,
    workingDir,
    timeout,
    label: options.label,
    logDir: options.logDir,
    ticketKey: options.ticketKey,
    provider: providerName,
    prompt,
    artifactDir: options.artifactDir,
    env: options.env || {},
  });

  const parsed = adapter.parseStreamOutput(raw.stdout, raw.exitCode);

  return buildResult(raw, parsed, providerName, adapter);
}
