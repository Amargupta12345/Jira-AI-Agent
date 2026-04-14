/**
 * Enhanced logger with file output and run tracking
 *
 * Features:
 * - Console output with colors
 * - File logging organized by date/run
 * - Step tracking with durations
 * - Separate error log file
 */

import fs from 'fs';
import path from 'path';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

// Global state
let currentRunId = null;
let currentTicketKey = null;
let currentStep = null;
let stepStartTime = null;
let runStartTime = null;
let logDir = './logs';
let runLogPath = null;
let errorLogPath = null;
let debugMode = true;

export function initRun(ticketKey, logDirectory = './logs') {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');

  currentRunId = `${dateStr}_${timeStr}_${ticketKey || 'batch'}`;
  currentTicketKey = ticketKey;
  runStartTime = now;
  logDir = logDirectory;

  const dayDir = path.join(logDir, dateStr);
  if (!fs.existsSync(dayDir)) {
    fs.mkdirSync(dayDir, { recursive: true });
  }

  runLogPath = path.join(dayDir, `${currentRunId}.log`);
  errorLogPath = path.join(dayDir, `${currentRunId}.errors.log`);

  const header = [
    '='.repeat(80),
    `RUN: ${currentRunId}`,
    `Ticket: ${ticketKey || 'N/A'}`,
    `Started: ${now.toISOString()}`,
    `Machine: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    '='.repeat(80),
    '',
  ].join('\n');

  fs.writeFileSync(runLogPath, header);

  console.log('');
  console.log(`${COLORS.bgBlue}${COLORS.bold}${COLORS.white} RUN STARTED ${COLORS.reset} ${COLORS.bold}${ticketKey || 'batch'}${COLORS.reset}`);
  console.log(`${COLORS.dim}  ID      ${COLORS.reset}${currentRunId}`);
  console.log(`${COLORS.dim}  Log     ${COLORS.reset}${runLogPath}`);
  console.log('');

  return currentRunId;
}

export function getRunLogPaths() {
  return { runLog: runLogPath, errorLog: errorLogPath };
}

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 23);
}

function getShortTimestamp() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function stripColors(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function writeToFile(level, message, isError = false) {
  if (!runLogPath) return;

  const timestamp = getTimestamp();
  const stepInfo = currentStep ? `[Step ${currentStep}]` : '';
  const line = `[${timestamp}] [${level}] ${stepInfo} ${stripColors(message)}\n`;

  try {
    fs.appendFileSync(runLogPath, line);
    if (isError && errorLogPath) {
      fs.appendFileSync(errorLogPath, line);
    }
  } catch (e) {
    // Silently fail if can't write to file
  }
}

function formatConsole(color, prefix, ...args) {
  const timestamp = `${COLORS.dim}${getShortTimestamp()}${COLORS.reset}`;
  const stepInfo = currentStep ? `${COLORS.cyan}${COLORS.bold}[S${currentStep}]${COLORS.reset}` : '';
  const coloredPrefix = `${color}${COLORS.bold}${prefix}${COLORS.reset}`;
  const message = args.map(a => `${color}${a}${COLORS.reset}`);
  return [timestamp, stepInfo, coloredPrefix, ...message].filter(Boolean);
}

export function startStep(stepNumber, stepName) {
  if (currentStep && stepStartTime) {
    const duration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
    writeToFile('STEP', `Step ${currentStep} completed in ${duration}s`);
  }

  currentStep = stepNumber;
  stepStartTime = Date.now();

  console.log('');
  console.log(`${COLORS.bgMagenta}${COLORS.bold}${COLORS.white} STEP ${stepNumber} ${COLORS.reset} ${COLORS.magenta}${COLORS.bold}${stepName}${COLORS.reset}`);
  console.log(`${COLORS.magenta}${'─'.repeat(60)}${COLORS.reset}`);
  writeToFile('STEP', `Starting: ${stepName}`);
}

export function endStep(success = true, message = '') {
  if (!currentStep || !stepStartTime) return;

  const duration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
  const status = success ? 'PASS' : 'FAIL';
  const bg = success ? COLORS.bgGreen : COLORS.bgRed;

  console.log(`${bg}${COLORS.bold}${COLORS.white} ${status} ${COLORS.reset} ${COLORS.dim}S${currentStep} ${duration}s${COLORS.reset} ${message}`);
  writeToFile('STEP', `${status}: ${message} (${duration}s)`, !success);

  currentStep = null;
  stepStartTime = null;
}

export function finalizeRun(success = true, summary = '') {
  if (!runStartTime) return;

  const duration = ((Date.now() - runStartTime) / 1000).toFixed(2);
  const status = success ? 'SUCCESS' : 'FAILED';
  const bg = success ? COLORS.bgGreen : COLORS.bgRed;

  const footer = [
    '',
    '='.repeat(80),
    `RUN ${status}`,
    `Duration: ${duration}s`,
    `Summary: ${summary}`,
    `Ended: ${new Date().toISOString()}`,
    '='.repeat(80),
  ].join('\n');

  writeToFile('RUN', `${status}: ${summary} (${duration}s)`, !success);

  if (runLogPath) {
    fs.appendFileSync(runLogPath, footer + '\n');
  }

  console.log('');
  console.log(`${bg}${COLORS.bold}${COLORS.white} RUN ${status} ${COLORS.reset} ${COLORS.dim}${duration}s${COLORS.reset} ${summary}`);
  console.log('');
  console.log(`${COLORS.cyan}${COLORS.bold}Logs:${COLORS.reset}`);
  console.log(`  ${COLORS.dim}Run log${COLORS.reset}  ${runLogPath}`);
  if (errorLogPath && fs.existsSync(errorLogPath)) {
    console.log(`  ${COLORS.red}Errors${COLORS.reset}   ${errorLogPath}`);
  }

  currentRunId = null;
  currentTicketKey = null;
  runStartTime = null;
  runLogPath = null;
  errorLogPath = null;
}

export function log(...args) {
  const message = args.join(' ');
  console.log(...formatConsole(COLORS.blue, '[INFO]', ...args));
  writeToFile('INFO', message);
}

export function ok(...args) {
  const message = args.join(' ');
  console.log(...formatConsole(COLORS.green, '[OK]', ...args));
  writeToFile('OK', message);
}

export function warn(...args) {
  const message = args.join(' ');
  console.log(...formatConsole(COLORS.yellow, '[WARN]', ...args));
  writeToFile('WARN', message);
}

export function err(...args) {
  const message = args.join(' ');
  console.error(...formatConsole(COLORS.red, '[ERROR]', ...args));
  writeToFile('ERROR', message, true);
}

export function debug(...args) {
  if (!debugMode) return;
  const message = args.join(' ');
  console.log(...formatConsole(COLORS.gray, '[DEBUG]', ...args));
  writeToFile('DEBUG', message);
}

export function logData(label, data) {
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  console.log(`${COLORS.cyan}${COLORS.bold}[DATA]${COLORS.reset} ${COLORS.cyan}${label}:${COLORS.reset}`);
  const indented = dataStr.split('\n').map(l => `  ${COLORS.dim}${l}${COLORS.reset}`).join('\n');
  console.log(indented);
  writeToFile('DATA', `${label}: ${dataStr}`);
}
