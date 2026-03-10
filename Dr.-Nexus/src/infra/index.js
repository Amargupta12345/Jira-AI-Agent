/**
 * Infrastructure Service
 * Manages local services (MongoDB, Redis, Kafka, Zookeeper).
 * Disabled by default (config.infra.enabled = false).
 */

import { execSync } from 'child_process';
import { log, warn, err } from '../utils/logger.js';

const SCRIPT_TIMEOUT = 2 * 60 * 1000;

function checkServicesRunning() {
  try {
    execSync('lsof -i:27017', { stdio: 'pipe' });
    execSync('lsof -i:6379', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function startServices(config) {
  if (!config.infra.enabled) {
    log('Infrastructure management disabled, skipping');
    return true;
  }

  log('Starting infrastructure services...');

  if (checkServicesRunning()) {
    log('Services already running');
    return true;
  }

  const startScript = `${config.infra.scriptsDir}/run_services.sh`;

  try {
    execSync(`zsh "${startScript}"`, {
      cwd: config.infra.scriptsDir,
      stdio: 'inherit',
      timeout: SCRIPT_TIMEOUT,
    });
    log('Infrastructure services started');
    return true;
  } catch (error) {
    err(`Failed to start services: ${error.message}`);
    return false;
  }
}

export async function stopServices(config) {
  if (!config.infra.enabled || !config.infra.stopAfterProcessing) {
    return true;
  }

  log('Stopping infrastructure services...');
  const stopScript = `${config.infra.scriptsDir}/stop-services.sh`;

  try {
    execSync(`zsh "${stopScript}"`, {
      cwd: config.infra.scriptsDir,
      stdio: 'inherit',
      timeout: SCRIPT_TIMEOUT,
    });
    log('Infrastructure services stopped');
    return true;
  } catch (error) {
    warn(`Failed to stop services: ${error.message}`);
    return false;
  }
}
