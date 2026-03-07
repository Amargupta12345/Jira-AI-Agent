/**
 * Provider spawn runtime.
 *
 * Runs provider CLI processes, streams/parses stdout events, tracks heartbeats,
 * enforces timeouts, and writes summarized run logs.
 */

import { spawn as nodeSpawn } from 'child_process';
import { log, warn, debug } from '../../utils/logger.js';
import { processOutputLine } from './event-parser.js';
import { writePromptFile, writeLogFile } from './log-writer.js';

/**
 * Spawn a CLI process and stream output.
 *
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, duration: number}>}
 */
export function spawnRuntime({ command, args, workingDir, timeout, label, logDir, ticketKey, provider, prompt, artifactDir, onEvent }) {
  log(`[${label}] Spawning ${command} (timeout=${Math.round(timeout / 60000)}min)...`);
  debug(`[${label}] Working directory: ${workingDir}`);
  writePromptFile(artifactDir, label, prompt);

  const startTime = Date.now();
  let eventCount = 0;
  const logSummaryLines = [];

  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    log(`[${label}] heartbeat: ${elapsed}s elapsed, ${eventCount} events`);
  }, 30000);

  return new Promise((resolve, reject) => {
    let stdoutBuffer = '';
    let rawStdout = '';
    let rawStderr = '';

    const proc = nodeSpawn(command, args, {
      cwd: workingDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();
    log(`[${label}] Process spawned (PID: ${proc.pid})`);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      rawStdout += chunk;
      stdoutBuffer += chunk;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const counted = processOutputLine({ line, onEvent, label, logSummaryLines });
        if (counted) eventCount++;
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      rawStderr += chunk;
      const trimmed = chunk.trim();
      if (trimmed) debug(`[${label}:stderr] ${trimmed.substring(0, 300)}`);
    });

    const timeoutId = setTimeout(() => {
      clearInterval(heartbeat);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      log(`[${label}] Timed out after ${elapsed}s (${eventCount} events)`);
      proc.kill('SIGTERM');
      reject(new Error(`${command} (${label}) timed out after ${elapsed}s`));
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeat);

      if (stdoutBuffer.trim() && onEvent) {
        try {
          const event = JSON.parse(stdoutBuffer.trim());
          onEvent(event);
        } catch {
          // ignore incomplete JSON
        }
      }

      const duration = Date.now() - startTime;
      const elapsed = Math.floor(duration / 1000);
      log(`[${label}] Finished: exit=${code}, duration=${elapsed}s, events=${eventCount}`);
      if (code !== 0) warn(`[${label}] Exited with code ${code}`);

      if (logDir && ticketKey) {
        writeLogFile({ logDir, ticketKey, provider, label, code, elapsed, eventCount, prompt, logSummaryLines, artifactDir });
      }

      resolve({ stdout: rawStdout, stderr: rawStderr, exitCode: code, duration });
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeat);
      reject(new Error(`Failed to spawn ${command} (${label}): ${error.message}`));
    });
  });
}
