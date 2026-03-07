/**
 * AI Provider Module — public API.
 *
 * The SOLE interface for spawning any AI CLI process in the entire codebase.
 * No other module spawns `claude` or `codex` directly.
 *
 * Supports multiple strategies: single, fallback, parallel, race.
 * Supports multiple modes: execute, debate, evaluate.
 */

import { spawn, buildResult } from './provider.js';
import * as claudeAdapter from './adapters/claude.js';
import * as codexAdapter from './adapters/codex.js';
import { run as runSingle } from './strategies/single.js';
import { run as runFallback } from './strategies/fallback.js';
import { run as runParallel } from './strategies/parallel.js';
import { run as runRace } from './strategies/race.js';
import { log, warn } from '../utils/logger.js';

const ADAPTERS = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

const STRATEGIES = {
  single: runSingle,
  fallback: runFallback,
  parallel: runParallel,
  race: runRace,
};

/**
 * Spawn an AI agent with the configured strategy.
 *
 * This is the ONLY function other modules call to run AI.
 *
 * @param {object} options
 * @param {string} options.prompt - The prompt to send
 * @param {string} options.workingDir - Working directory for the process
 * @param {'execute'|'debate'|'evaluate'} options.mode - Determines tool permissions + model
 * @param {string} options.label - Human-readable label for logging
 * @param {string} [options.logDir] - Where to write log files
 * @param {string} [options.ticketKey] - JIRA ticket key for log filenames
 * @param {object} options.config - Full config object (aiProvider section extracted internally)
 * @param {object} [options.providerConfig] - Per-call provider override. When present, bypasses strategy
 *   and spawns directly with this provider+model. Shape: { provider, model, maxTurns?, timeoutMinutes? }
 * @param {string} [options.resumeSessionId] - Session/thread ID from a previous call to resume conversation
 * @returns {Promise<{output: string, completedNormally: boolean, exitCode: number, numTurns: number|null, rateLimited: boolean, provider: string, duration: number, sessionId: string|null}>}
 */
export async function runAI(options) {
  const { prompt, workingDir, mode, label, logDir, ticketKey, config, providerConfig, resumeSessionId } = options;
  const artifactDir = config._artifactDir || null;

  // --- Per-call provider override: bypass strategy entirely ---
  if (providerConfig) {
    const providerName = providerConfig.provider || 'claude';
    const adapter = ADAPTERS[providerName];
    if (!adapter) {
      throw new Error(`Unknown provider in providerConfig: ${providerName}`);
    }

    // Merge mode-level allowedTools if not specified in providerConfig
    const modeConfig = config.aiProvider?.[mode] || {};
    const effectiveConfig = {
      ...providerConfig,
      allowedTools: providerConfig.allowedTools || modeConfig.allowedTools || null,
      ...(resumeSessionId && { resumeSessionId }),
    };

    log(`[${label}] runAI: mode=${mode}, direct provider=${providerName}, model=${effectiveConfig.model || 'default'}${resumeSessionId ? `, resume=${resumeSessionId.substring(0, 8)}...` : ''}`);
    log(`[${label}] Prompt length: ${prompt.length} characters`);

    const { args, timeout } = adapter.buildArgs(prompt, effectiveConfig);
    const env = {};
    if (providerName === 'codex' && config.openai?.apiKey) {
      env.OPENAI_API_KEY = config.openai.apiKey;
    }

    const raw = await spawn({
      command: adapter.getCommand(),
      args,
      workingDir,
      timeout,
      label,
      logDir,
      ticketKey,
      provider: providerName,
      prompt,
      artifactDir,
      env,
    });

    const parsed = adapter.parseStreamOutput(raw.stdout, raw.exitCode);
    const result = buildResult(raw, parsed, providerName, adapter);

    log(`[${label}] runAI complete: provider=${result.provider}, exit=${result.exitCode}, duration=${Math.floor(result.duration / 1000)}s, output=${result.output?.length || 0} chars${result.sessionId ? `, session=${result.sessionId.substring(0, 8)}...` : ''}`);
    return result;
  }

  // --- Standard strategy-based flow ---
  const aiConfig = config.aiProvider || {};
  const strategy = aiConfig.strategy || 'single';
  const modeConfig = aiConfig[mode];

  if (!modeConfig) {
    throw new Error(`No aiProvider config for mode '${mode}'. Check config.json aiProvider.${mode} section.`);
  }

  const strategyFn = STRATEGIES[strategy];
  if (!strategyFn) {
    throw new Error(`Unknown AI provider strategy: ${strategy}. Valid: ${Object.keys(STRATEGIES).join(', ')}`);
  }

  log(`[${label}] runAI: mode=${mode}, strategy=${strategy}, provider=${modeConfig.provider || 'claude'}`);
  log(`[${label}] Prompt length: ${prompt.length} characters`);

  const env = {};
  if (config.openai?.apiKey) {
    env.OPENAI_API_KEY = config.openai.apiKey;
  }

  const result = await strategyFn(prompt, workingDir, modeConfig, ADAPTERS, spawn, {
    label,
    logDir,
    ticketKey,
    mode,
    resumeSessionId,
    artifactDir,
    env,
  });

  log(`[${label}] runAI complete: provider=${result.provider}, exit=${result.exitCode}, duration=${Math.floor(result.duration / 1000)}s, output=${result.output?.length || 0} chars${result.sessionId ? `, session=${result.sessionId.substring(0, 8)}...` : ''}`);

  return result;
}

/**
 * Get display label for current provider config.
 *
 * @param {object} config - Full config object
 * @returns {string} e.g., "claude (haiku) [single]"
 */
export function getProviderLabel(config) {
  const aiConfig = config.aiProvider || {};
  const strategy = aiConfig.strategy || 'single';
  const execConfig = aiConfig.execute || {};
  const provider = execConfig.provider || 'claude';
  const model = execConfig[provider]?.model || 'default';
  return `${provider} (${model}) [${strategy}]`;
}
