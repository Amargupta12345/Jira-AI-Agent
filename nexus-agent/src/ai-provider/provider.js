/**
 * AI provider facade.
 *
 * Exposes the stable public API used by strategies/council while delegating
 * process runtime and helper logic to focused internal modules.
 */

import { spawnRuntime } from './provider/spawn-runtime.js';
export { isRateLimited, isGarbageOutput, buildResult, buildFailureResult, pickBestOutput } from './provider/result-utils.js';

/**
 * Spawn a provider CLI process and stream output.
 *
 * Public signature intentionally remains unchanged.
 */
export function spawn(opts) {
  return spawnRuntime(opts);
}
