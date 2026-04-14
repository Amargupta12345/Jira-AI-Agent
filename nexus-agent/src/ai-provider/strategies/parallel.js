/**
 * Parallel strategy — run both providers simultaneously, pick best result.
 *
 * For 'debate' and 'evaluate' modes (read-only tools), both can share the same workingDir.
 * For 'execute' mode (write tools), the second provider gets a cloned copy of workingDir
 * to avoid file conflicts.
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { isGarbageOutput, pickBestOutput, buildResult, buildFailureResult } from '../provider.js';
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
  const providerNames = getProviderPair(modeConfig, adapters);
  if (providerNames.length < 2) {
    // Fall back to single if only one provider available
    return runSingle(providerNames[0], prompt, workingDir, modeConfig, adapters, spawnFn, options);
  }

  const [nameA, nameB] = providerNames;
  const isWriteMode = options.mode === 'execute';

  // For write mode, clone the working directory for the second provider
  let workingDirB = workingDir;
  if (isWriteMode) {
    workingDirB = `${workingDir}-parallel`;
    try {
      execSync(`cp -r "${workingDir}" "${workingDirB}"`, { timeout: 60000 });
      log(`[${options.label}] Cloned workingDir for parallel provider B: ${workingDirB}`);
    } catch (err) {
      warn(`[${options.label}] Failed to clone workingDir for parallel: ${err.message}`);
      // Fall back to single
      return runSingle(nameA, prompt, workingDir, modeConfig, adapters, spawnFn, options);
    }
  }

  log(`[${options.label}] Running ${nameA} and ${nameB} in parallel`);

  const [resultA, resultB] = await Promise.allSettled([
    runProvider(nameA, prompt, workingDir, modeConfig, adapters, spawnFn, {
      ...options,
      label: `${options.label}-${nameA}`,
    }),
    runProvider(nameB, prompt, workingDirB, modeConfig, adapters, spawnFn, {
      ...options,
      label: `${options.label}-${nameB}`,
    }),
  ]);

  const results = [];
  if (resultA.status === 'fulfilled') results.push(resultA.value);
  if (resultB.status === 'fulfilled') results.push(resultB.value);

  // Clean up parallel clone
  if (isWriteMode && workingDirB !== workingDir) {
    try {
      fs.rmSync(workingDirB, { recursive: true, force: true });
    } catch { /* non-critical */ }
  }

  if (results.length === 0) {
    throw new Error(`Both providers failed in parallel strategy`);
  }

  const best = pickBestOutput(results);

  // If the winner was from the cloned dir (provider B in write mode), we'd need to copy its changes back.
  // However, since provider B wrote to a clone, and provider A wrote to the original, the original already
  // has A's changes. If B is picked, the caller would need to re-run. For simplicity, prefer A in write mode
  // unless A failed entirely.
  if (isWriteMode && best.provider === nameB && results[0] && !isGarbageOutput(results[0].output)) {
    log(`[${options.label}] Parallel: preferring ${nameA} in write mode (original workingDir)`);
    return results[0];
  }

  return best;
}

function getProviderPair(modeConfig, adapters) {
  const primary = modeConfig.provider || 'claude';
  const secondary = modeConfig.fallbackProvider;
  const names = [primary];
  if (secondary && secondary !== primary && adapters[secondary]) {
    names.push(secondary);
  }
  return names;
}

async function runSingle(providerName, prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  return runProvider(providerName, prompt, workingDir, modeConfig, adapters, spawnFn, options);
}

async function runProvider(providerName, prompt, workingDir, modeConfig, adapters, spawnFn, options) {
  const adapter = adapters[providerName];
  if (!adapter) throw new Error(`Unknown provider: ${providerName}`);

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
      stdinInput,
    });

    const parsed = adapter.parseStreamOutput(raw.stdout, raw.exitCode);

    return buildResult(raw, parsed, providerName, adapter);
  } catch (err) {
    warn(`[${options.label}] Provider ${providerName} threw: ${err.message}`);
    return buildFailureResult(providerName);
  }
}
