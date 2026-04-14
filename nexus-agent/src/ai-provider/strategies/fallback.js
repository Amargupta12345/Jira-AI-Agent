/**
 * Fallback strategy — run primary provider, if it fails run secondary.
 *
 * Failure conditions: non-zero exit, timeout, rate limit, garbage output.
 */

import { isGarbageOutput, buildResult, buildFailureResult } from '../provider.js';
import { log, warn } from '../../utils/logger.js';

/**
 * @param {string} prompt
 * @param {string} workingDir
 * @param {object} modeConfig - Mode-specific config section
 * @param {object} adapters - Map of provider name -> adapter module
 * @param {function} spawnFn - The provider.spawn function
 * @param {object} options - { label, logDir, ticketKey }
 * @returns {Promise<{output, completedNormally, exitCode, numTurns, rateLimited, provider, duration}>}
 */
export async function run(prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const primaryName = modeConfig.provider || 'claude';
  const fallbackName = modeConfig.fallbackProvider;

  // Run primary
  const primaryResult = await runProvider(primaryName, prompt, workingDir, modeConfig, adapters, spawnFn, options);

  // Check if primary succeeded
  if (primaryResult.completedNormally && !primaryResult.rateLimited && !isGarbageOutput(primaryResult.output)) {
    return primaryResult;
  }

  // If no fallback configured, return primary (even if failed)
  if (!fallbackName || !adapters[fallbackName]) {
    warn(`[${options.label}] Primary provider ${primaryName} failed, no fallback configured`);
    return primaryResult;
  }

  // Run fallback
  log(`[${options.label}] Primary ${primaryName} failed (exit=${primaryResult.exitCode}, rateLimited=${primaryResult.rateLimited}), falling back to ${fallbackName}`);
  return runProvider(fallbackName, prompt, workingDir, modeConfig, adapters, spawnFn, {
    ...options,
    label: `${options.label}-fallback`,
  });
}

async function runProvider(providerName, prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const adapter = adapters[providerName];
  if (!adapter) {
    throw new Error(`Unknown provider: ${providerName}`);
  }

  const providerConfig = {
    ...(modeConfig[providerName] || {}),
    ...(options.resumeSessionId && { resumeSessionId: options.resumeSessionId }),
  };
  const { args, timeout, stdinInput } = adapter.buildArgs(prompt, providerConfig);

  try {
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
      stdinInput,
    });

    const parsed = adapter.parseStreamOutput(raw.stdout, raw.exitCode);

    return buildResult(raw, parsed, providerName, adapter);
  } catch (err) {
    warn(`[${options.label}] Provider ${providerName} threw: ${err.message}`);
    return buildFailureResult(providerName);
  }
}
