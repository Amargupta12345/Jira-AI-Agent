/**
 * Configuration loader and validator.
 *
 * Reads config.json from project root, validates required fields,
 * returns a structured config object matching the v2 schema.
 */

import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const REQUIRED_FIELDS = [
  'jira.baseUrl',
  'jira.email',
  'jira.apiToken',
  'jira.label',
  'azureDevOps.org',
  'azureDevOps.project',
  'azureDevOps.repoBaseUrl',
];

function getNestedValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, part) => acc?.[part], obj);
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config file not found: ${CONFIG_PATH}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse config.json: ${e.message}`);
    process.exit(1);
  }

  const missing = REQUIRED_FIELDS.filter(f => {
    const v = getNestedValue(raw, f);
    return !v || v === '';
  });
  if (missing.length > 0) {
    console.error('Missing required configuration fields:');
    missing.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  // Build structured config
  const config = {
    jira: {
      baseUrl: raw.jira.baseUrl.replace(/\/$/, ''),
      email: raw.jira.email,
      apiToken: raw.jira.apiToken,
      label: raw.jira.label,
      labelProcessed: raw.jira.labelProcessed || `${raw.jira.label}-done`,
      maxComments: raw.jira?.maxComments || 100,
      fields: raw.jira.fields || {
        affectedSystems: 'customfield_10056',
        fixVersions: 'fixVersions',
      },
    },
    azureDevOps: {
      org: raw.azureDevOps.org,
      project: raw.azureDevOps.project,
      repoBaseUrl: raw.azureDevOps.repoBaseUrl,
      pat: raw.azureDevOps.pat || null,
      patEnvVar: raw.azureDevOps.patEnvVar || null,
      tokenCommand: raw.azureDevOps.tokenCommand || null,
      sourceZshrc: raw.azureDevOps.sourceZshrc ?? false,
    },
    services: raw.services || {},
    slack: {
      botToken: raw.slack?.botToken || null,
      userId: raw.slack?.userId || null,
    },
    agent: {
      pollInterval: raw.agent?.pollInterval || 300,
      maxTicketsPerCycle: raw.agent?.maxTicketsPerCycle || 1,
      logDir: raw.agent?.logDir || './logs',
      executionRetries: raw.agent?.executionRetries ?? 1,
    },
    council: buildCouncilConfig(raw),
    prReviewCouncil: buildPrReviewCouncilConfig(raw),
    aiProvider: buildAiProviderConfig(raw),
    openai: {
      apiKey: raw.openai?.apiKey || null,
    },
    sentry: buildSentryConfig(raw),
    infra: {
      enabled: raw.infra?.enabled ?? false,
      scriptsDir: raw.infra?.scriptsDir || '',
      stopAfterProcessing: raw.infra?.stopAfterProcessing ?? false,
    },
    tests: {
      enabled: raw.tests?.enabled ?? false,
    },
  };

  return config;
}

function buildModeConfig(modeRaw, defaults, openaiApiKey) {
  const { claudeModel, claudeMaxTurns, claudeTimeout, codexTimeout, allowedTools } = defaults;
  return {
    provider: modeRaw?.provider || 'claude',
    fallbackProvider: modeRaw?.fallbackProvider || null,
    allowedTools: modeRaw?.allowedTools || modeRaw?.claude?.allowedTools || allowedTools,
    claude: {
      model: modeRaw?.claude?.model || claudeModel,
      maxTurns: modeRaw?.claude?.maxTurns || claudeMaxTurns,
      timeoutMinutes: modeRaw?.claude?.timeoutMinutes || claudeTimeout,
      allowedTools: modeRaw?.claude?.allowedTools || allowedTools,
    },
    codex: {
      model: modeRaw?.codex?.model || null,
      timeoutMinutes: modeRaw?.codex?.timeoutMinutes || codexTimeout,
      allowedTools: modeRaw?.codex?.allowedTools || allowedTools,
      // Auto-populated from top-level openai.apiKey — no need to set it twice.
      // This is injected as OPENAI_API_KEY env when Codex is spawned.
      apiKey: modeRaw?.codex?.apiKey || openaiApiKey || null,
    },
  };
}

function buildCouncilConfig(raw) {
  return buildCouncilConfigSection(raw.council || {});
}

function buildPrReviewCouncilConfig(raw) {
  if (!raw.prReviewCouncil) return null;
  return buildCouncilConfigSection(raw.prReviewCouncil);
}

function buildCouncilConfigSection(councilRaw = {}) {
  const normalizeMember = (member, defaults) => {
    const provider = member?.provider || defaults.provider;
    return {
      provider,
      fallbackProvider: member?.fallbackProvider || null,
      model: member?.model !== undefined ? member.model : (provider === defaults.provider ? defaults.model : null),
      maxTurns: member?.maxTurns || defaults.maxTurns,
      timeoutMinutes: member?.timeoutMinutes || defaults.timeoutMinutes,
      allowedTools: member?.allowedTools || defaults.allowedTools,
    };
  };
  const debateDefaults = {
    provider: 'claude',
    model: 'sonnet',
    maxTurns: 15,
    timeoutMinutes: 10,
    allowedTools: 'Read,Glob,Grep',
  };
  const evaluateDefaults = {
    provider: 'claude',
    model: 'sonnet',
    maxTurns: 5,
    timeoutMinutes: 5,
    allowedTools: 'Read,Glob,Grep',
  };
  const proposer = normalizeMember(councilRaw.proposer, debateDefaults);
  const critics = Array.isArray(councilRaw.critics) && councilRaw.critics.length > 0
    ? councilRaw.critics.map((critic) => normalizeMember(critic, debateDefaults))
    : [normalizeMember(null, debateDefaults)];
  const evaluator = normalizeMember(councilRaw.evaluator, evaluateDefaults);
  return {
    maxRounds: councilRaw.maxRounds || 3,
    proposer,
    critics,
    evaluator,
  };
}

function buildAiProviderConfig(raw) {
  const ai = raw.aiProvider || {};
  const openaiApiKey = raw.openai?.apiKey || null;

  const execute = {
    ...buildModeConfig(ai.execute, {
      claudeModel: 'haiku', claudeMaxTurns: 30, claudeTimeout: 15,
      codexTimeout: 15, allowedTools: 'Read,Write,Edit,Bash,Glob,Grep',
    }, openaiApiKey),
  };

  return { strategy: ai.strategy || 'single', execute };
}

function buildSentryConfig(raw) {
  const s = raw.sentry || {};

  // Prefer credentials from the shared sentry-alert/sentry-config.json when it exists.
  // This keeps authToken and orgSlug in one place across the CLI, MCP server, and Dr.-Nexus.
  let sharedCreds = {};
  const sharedPath = path.join(path.dirname(CONFIG_PATH), '..', 'sentry-alert', 'sentry-config.json');
  if (fs.existsSync(sharedPath)) {
    try {
      sharedCreds = JSON.parse(fs.readFileSync(sharedPath, 'utf-8'));
    } catch { /* ignore parse errors, fall back to config.json values */ }
  }

  return {
    authToken: sharedCreds.authToken || s.authToken || null,
    baseUrl: ((sharedCreds.baseUrl || s.baseUrl || 'https://sentry.io')).replace(/\/$/, ''),
    orgSlug: sharedCreds.orgSlug || s.orgSlug || null,
    pollInterval: s.pollInterval || 300,
    stateDir: s.stateDir || '.sentry-state',
    services: s.services || {},
  };
}

/**
 * Get JIRA Basic auth header
 */
export function getAuthHeader(config) {
  const auth = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
  return `Basic ${auth}`;
}

/**
 * Get repo URL for a service
 */
export function getRepoUrl(config, serviceName) {
  const service = getServiceConfig(config, serviceName);
  if (!service) return null;
  return `${config.azureDevOps.repoBaseUrl}/${service.repo}`;
}

/**
 * Get service config by name (case-insensitive)
 */
export function getServiceConfig(config, serviceName) {
  if (config.services[serviceName]) {
    return { name: serviceName, ...config.services[serviceName] };
  }
  const lowerName = serviceName.toLowerCase();
  for (const [name, svc] of Object.entries(config.services)) {
    if (name.toLowerCase() === lowerName) {
      return { name, ...svc };
    }
  }
  return null;
}

/**
 * Return a shallow config clone with the requested council profile.
 *
 * Useful when a caller needs to run council logic with an alternate
 * proposer/critic/evaluator setup (e.g. PR review council).
 */
export function withCouncilConfig(config, councilOverride) {
  if (!councilOverride) return config;
  return {
    ...config,
    council: councilOverride,
  };
}
