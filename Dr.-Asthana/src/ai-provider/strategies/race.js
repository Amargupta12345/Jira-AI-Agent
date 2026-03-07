/**
 * Race strategy — run both providers simultaneously, return whichever finishes first
 * with a non-garbage result. Kill the other.
 *
 * Optimizes for speed over quality.
 */

import { isGarbageOutput, buildResult, buildFailureResult } from '../provider.js';
import { log, warn } from '../../utils/logger.js';

/**
 * @param {string} prompt
 * @param {string} workingDir
 * @param {object} modeConfig - Mode-specific config section
 * @param {object} adapters - Map of provider name -> adapter module
 * @param {function} spawnFn - The provider.spawn function
 * @param {object} options - { label, logDir, ticketKey, mode }
 * @returns {Promise<{output, completedNormally, exitCode, numTurns, rateLimited, provider, duration}>}
 */
export async function run(prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const primary = modeConfig.provider || 'claude';
  const secondary = modeConfig.fallbackProvider;

  if (!secondary || !adapters[secondary] || secondary === primary) {
    // Only one provider — just run it
    return runProvider(primary, prompt, workingDir, modeConfig, adapters, spawnFn, options);
  }

  log(`[${options.label}] Racing ${primary} vs ${secondary}`);

  // Use Promise.any-like approach: resolve when first good result arrives
  return new Promise((resolve, reject) => {
    let settled = false;
    const results = [];

    const tryResolve = (result) => {
      if (settled) return;
      results.push(result);

      if (!isGarbageOutput(result.output) && !result.rateLimited) {
        settled = true;
        log(`[${options.label}] Race winner: ${result.provider} (${Math.floor(result.duration / 1000)}s)`);
        resolve(result);
        return;
      }

      // If both have finished and neither is good, return the better of the two
      if (results.length >= 2) {
        settled = true;
        const best = results[0].output.length >= results[1].output.length ? results[0] : results[1];
        warn(`[${options.label}] Race: no good result, returning best of two`);
        resolve(best);
      }
    };

    const tryReject = (err, providerName) => {
      warn(`[${options.label}] Race: ${providerName} failed: ${err.message}`);
      results.push(buildFailureResult(providerName));

      if (results.length >= 2 && !settled) {
        settled = true;
        const valid = results.find(r => r.output && r.output.length > 0);
        if (valid) {
          resolve(valid);
        } else {
          reject(new Error('Both providers failed in race strategy'));
        }
      }
    };

    runProvider(primary, prompt, workingDir, modeConfig, adapters, spawnFn, {
      ...options,
      label: `${options.label}-${primary}`,
    }).then(tryResolve).catch(err => tryReject(err, primary));

    runProvider(secondary, prompt, workingDir, modeConfig, adapters, spawnFn, {
      ...options,
      label: `${options.label}-${secondary}`,
    }).then(tryResolve).catch(err => tryReject(err, secondary));
  });
}

async function runProvider(providerName, prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const adapter = adapters[providerName];
  if (!adapter) throw new Error(`Unknown provider: ${providerName}`);

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
  });

  const parsed = adapter.parseStreamOutput(raw.stdout, raw.exitCode);

  return buildResult(raw, parsed, providerName, adapter);
}
