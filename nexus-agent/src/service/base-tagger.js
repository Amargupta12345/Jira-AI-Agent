/**
 * Base Image Tagger
 * Auto-detects base image registry from each repo's Dockerfile.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { log, warn } from '../utils/logger.js';

const CMD_TIMEOUT = 10 * 60 * 1000;

function execGit(cmd, cwd, timeout = CMD_TIMEOUT) {
  try {
    return execSync(cmd, {
      cwd,
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    });
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    throw new Error(`Git command failed: ${cmd}\n${stderr || stdout || error.message}`);
  }
}

/**
 * Handle base tag creation when dependencies change.
 */
export function handleBaseTag(tmpDir, baseBranch, repoName) {
  const dockerfilePath = path.join(tmpDir, 'Dockerfile');
  const dockerfileBasePath = path.join(tmpDir, 'Dockerfile.base');
  const pipelinePath = path.join(tmpDir, 'azure-pipelines.yml');

  if (!fs.existsSync(dockerfilePath) || !fs.existsSync(dockerfileBasePath) || !fs.existsSync(pipelinePath)) {
    log('Missing Dockerfile, Dockerfile.base, or azure-pipelines.yml — skipping base tag');
    return { tagged: false };
  }

  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
  const fromMatch = dockerfile.match(/^FROM\s+([\w.\-]+\/base-images\/\S+?):\S+/m);
  if (!fromMatch || !fromMatch[1].endsWith(`/${repoName}`)) {
    log(`Dockerfile FROM line does not match base-images registry for ${repoName}, skipping base tag`);
    return { tagged: false };
  }

  const registry = fromMatch[1];
  const tagPrefix = 'deploy.base';

  let changedFiles;
  try {
    changedFiles = execGit(`git diff "origin/${baseBranch}" HEAD --name-only`, tmpDir).trim();
  } catch {
    try {
      changedFiles = execGit(`git diff "${baseBranch}" HEAD --name-only`, tmpDir).trim();
    } catch {
      warn(`Cannot diff against ${baseBranch}, assuming no dependency changes`);
      changedFiles = '';
    }
  }

  const depFiles = ['package.json', 'package-lock.json'];
  const depsChanged = depFiles.some(f => changedFiles.split('\n').includes(f));

  if (!depsChanged) {
    log('No dependency changes detected, skipping base tag');
    return { tagged: false };
  }

  log('Dependency changes detected, creating base tag...');

  const versionMatch = baseBranch.match(/version\/(.+)/);
  if (!versionMatch) {
    warn(`Cannot parse version from branch name: ${baseBranch}`);
    return { tagged: false };
  }
  const versionSlug = 'v' + versionMatch[1].replace(/\./g, '-');

  execGit('git fetch origin --tags', tmpDir);

  const tagPattern = `${tagPrefix}.${versionSlug}-`;

  let existingTags;
  try {
    existingTags = execGit(`git tag -l "${tagPattern}*"`, tmpDir).trim();
  } catch {
    existingTags = '';
  }

  let nextBuild = 1;
  if (existingTags) {
    const escapedPattern = tagPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buildNumbers = existingTags
      .split('\n')
      .map(tag => {
        const match = tag.match(new RegExp(`${escapedPattern}(\\d{1,4})$`));
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);
    if (buildNumbers.length > 0) {
      nextBuild = Math.max(...buildNumbers) + 1;
    }
  }

  const newTag = `${tagPrefix}.${versionSlug}-${nextBuild}`;
  log(`Creating base tag: ${newTag}`);

  execGit(`git tag -a "${newTag}" HEAD -m "Base image tag for ${baseBranch}"`, tmpDir);
  execGit(`git push origin "${newTag}"`, tmpDir);
  log(`Base tag pushed: ${newTag}`);

  const imageTag = `${versionSlug}-${nextBuild}`;
  {
    let updatedDockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
    const fromRegex = new RegExp(`^(FROM\\s+)${registry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\S+`, 'm');
    if (fromRegex.test(updatedDockerfile)) {
      updatedDockerfile = updatedDockerfile.replace(fromRegex, `$1${registry}:${imageTag}`);
      fs.writeFileSync(dockerfilePath, updatedDockerfile);
      log(`Dockerfile FROM updated to ${registry}:${imageTag}`);
    } else {
      warn('Dockerfile FROM line does not match expected registry, skipping update');
    }
  }

  return { tagged: true, tag: newTag };
}
