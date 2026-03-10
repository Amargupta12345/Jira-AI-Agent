/**
 * Run artifact bundler.
 *
 * Copies run logs into the artifact directory, creates a .tar.gz,
 * and uploads it to Pixelbin CDN.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { log, warn } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Bundle the entire artifact directory into a .tar.gz and upload it.
 *
 * Fully async — does not block the event loop during tar or upload.
 * Wraps every step in try/catch so a corrupted artifact dir never
 * prevents the caller from continuing.
 *
 * @param {string} ticketKey - JIRA ticket key (used for tarball name)
 * @param {string} artifactDir - Path to .pipeline-state/{ticketKey}/
 * @param {{ runLog?: string, errorLog?: string }} [runLogPaths] - Paths to run log files to copy in
 * @returns {Promise<{ url: string|null, localPath: string|null }>}
 */
export async function bundleRunArtifact(ticketKey, artifactDir, runLogPaths) {
  if (!artifactDir || !fs.existsSync(artifactDir)) {
    warn(`[bundler] Artifact dir does not exist: ${artifactDir}`);
    return { url: null, localPath: null };
  }

  // 1. Copy run logs into artifact dir (if they exist elsewhere)
  if (runLogPaths) {
    try {
      if (runLogPaths.runLog && fs.existsSync(runLogPaths.runLog)) {
        fs.copyFileSync(runLogPaths.runLog, path.join(artifactDir, 'run.log'));
      }
      if (runLogPaths.errorLog && fs.existsSync(runLogPaths.errorLog)) {
        fs.copyFileSync(runLogPaths.errorLog, path.join(artifactDir, 'run.errors.log'));
      }
    } catch (e) {
      warn(`[bundler] Failed to copy run logs: ${e.message}`);
    }
  }

  // 2. Create .tar.gz (async)
  const parentDir = path.dirname(artifactDir);
  const dirName = path.basename(artifactDir);
  const tarballName = `${ticketKey}-artifact.tar.gz`;
  const tarballPath = path.join(parentDir, tarballName);

  try {
    await execFileAsync('tar', ['-czf', tarballPath, '-C', parentDir, dirName], {
      timeout: 120000,
    });
    log(`[bundler] Created ${tarballPath}`);
  } catch (e) {
    warn(`[bundler] tar failed: ${e.message}`);
    return { url: null, localPath: null };
  }

  // 3. Upload via pixelbin-upload (async)
  let url = null;
  try {
    const { stdout } = await execFileAsync(
      '/bin/bash',
      ['-c', `~/.local/bin/pixelbin-upload "${tarballPath}" --json --unique --format raw --no-progress`],
      { timeout: 120000 }
    );
    const parsed = JSON.parse(stdout);
    url = parsed.url || parsed.cdnUrl || null;
    log(`[bundler] Uploaded artifact: ${url}`);
  } catch (e) {
    warn(`[bundler] Upload failed (non-blocking): ${e.message}`);
  }

  // 4. Clean up tarball
  try {
    fs.unlinkSync(tarballPath);
  } catch { /* non-critical */ }

  return { url, localPath: tarballPath };
}
