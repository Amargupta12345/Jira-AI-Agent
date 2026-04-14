#!/usr/bin/env node
/**
 * Weekly Productivity Report — CLI entry point
 *
 * Data sources:
 *   Jira      — credentials from jira-creator/jira-config.json
 *   Azure DevOps — AZURE_TOKEN env var (or azureDevOps.pat in Dr.-Nexus/config.json)
 *
 * Commands:
 *   node weekly-report.mjs                  Generate report for the current week
 *   node weekly-report.mjs --last           Generate report for last week (default Mon)
 *   node weekly-report.mjs --week 2026-W15  Generate report for a specific ISO week
 *   node weekly-report.mjs history          List all saved weekly snapshots
 *   node weekly-report.mjs open 2026-W14    Open a saved report in the browser
 *
 * Output:
 *   weekly-report/reports/YYYY-WNN.html   — self-contained HTML (open in browser)
 *   weekly-report/history/YYYY-WNN.json   — raw data snapshot (for week-over-week)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HISTORY_DIR = resolve(__dirname, 'history');
const REPORTS_DIR = resolve(__dirname, 'reports');

// ── Week helpers ───────────────────────────────────────────────────────────────

/** Returns Monday of the ISO week containing `date`. */
function isoWeekMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Returns Sunday (end of week) from a Monday. */
function isoWeekSunday(monday) {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Returns ISO week label "YYYY-WNN" for a given Monday date. */
function isoWeekLabel(monday) {
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Parse a "YYYY-WNN" string into { monday, sunday, label }.
 * Throws if the format is invalid.
 */
function parseWeekArg(str) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(str.trim());
  if (!m) throw new Error(`Invalid week format "${str}". Use YYYY-WNN, e.g. 2026-W15`);

  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) throw new Error(`Week number ${week} out of range.`);

  // ISO week 1 contains the first Thursday of the year (or Jan 4th).
  // Monday of week N = Jan 4 of that year + (N-1)*7 days, then back to nearest Mon.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const w1Mon = new Date(jan4);
  w1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);

  const monday = new Date(w1Mon);
  monday.setUTCDate(w1Mon.getUTCDate() + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = isoWeekSunday(monday);

  return { monday, sunday, label: `${year}-W${String(week).padStart(2, '0')}` };
}

/** Detect week from args or default to current/last week. */
function resolveWeek(args) {
  const weekArg = args.find(a => a.startsWith('--week='))?.split('=')[1]
    ?? (args.includes('--week') ? args[args.indexOf('--week') + 1] : null);

  if (weekArg) return parseWeekArg(weekArg);

  const today = new Date();
  const thisMonday = isoWeekMonday(today);
  const isMonday = today.getUTCDay() === 1;

  // Default to last week when run on a Monday (current week barely started)
  if (args.includes('--last') || isMonday) {
    const lastMonday = new Date(thisMonday);
    lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
    const lastSunday = isoWeekSunday(lastMonday);
    return { monday: lastMonday, sunday: lastSunday, label: isoWeekLabel(lastMonday) };
  }

  return {
    monday: thisMonday,
    sunday: isoWeekSunday(thisMonday),
    label: isoWeekLabel(thisMonday),
  };
}

// ── History helpers ────────────────────────────────────────────────────────────

function historyPath(label) {
  return resolve(HISTORY_DIR, `${label}.json`);
}

function reportPath(label) {
  return resolve(REPORTS_DIR, `${label}.html`);
}

function saveSnapshot(label, data) {
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(historyPath(label), JSON.stringify(data, null, 2), 'utf-8');
}

function loadSnapshot(label) {
  const p = historyPath(label);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function prevWeekLabel(label) {
  const { monday } = parseWeekArg(label);
  const prevMonday = new Date(monday);
  prevMonday.setUTCDate(monday.getUTCDate() - 7);
  return isoWeekLabel(prevMonday);
}

// ── CLI commands ───────────────────────────────────────────────────────────────

function cmdHistory() {
  if (!existsSync(HISTORY_DIR)) {
    console.log('No history yet. Run `node weekly-report.mjs` to generate your first report.');
    return;
  }
  const files = readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('No saved snapshots found.');
    return;
  }

  console.log('\n  Saved weekly reports:\n');
  for (const f of files) {
    const label = f.replace('.json', '');
    const htmlExists = existsSync(reportPath(label));
    console.log(`  ${label}${htmlExists ? '  [HTML]' : ''}`);
  }
  console.log(`\n  Open with: node weekly-report.mjs open <LABEL>\n`);
}

function cmdOpen(label) {
  const p = reportPath(label);
  if (!existsSync(p)) {
    console.error(`Report not found: ${p}`);
    console.error(`Run: node weekly-report.mjs --week ${label}`);
    process.exit(1);
  }
  // Cross-platform open
  const cmd = process.platform === 'darwin' ? `open "${p}"`
    : process.platform === 'win32' ? `start "" "${p}"`
    : `xdg-open "${p}"`;
  execSync(cmd);
  console.log(`Opened: ${p}`);
}

// ── Logging ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  blue:  '\x1b[34m',
  yellow:'\x1b[33m',
  violet:'\x1b[35m',
  gray:  '\x1b[90m',
};

function log(msg)  { console.log(`${C.gray}${new Date().toISOString().slice(11,19)}${C.reset} ${msg}`); }
function ok(msg)   { console.log(`${C.green}✔${C.reset}  ${msg}`); }
function info(msg) { console.log(`${C.blue}ℹ${C.reset}  ${msg}`); }
function warn(msg) { console.log(`${C.yellow}⚠${C.reset}  ${msg}`); }
function hdr(msg)  { console.log(`\n${C.bold}${msg}${C.reset}`); }

function printSummary(label, range, jira, azure) {
  hdr('══════════════════════════════════════════');
  hdr(`  Weekly Report — ${label}`);
  console.log(`  ${range}\n`);

  console.log('  Jira:');
  console.log(`    Resolved:     ${jira.summary.resolved}`);
  console.log(`    In Progress:  ${jira.summary.inProgress}`);
  console.log(`    Story Points: ${jira.summary.storyPointsResolved} SP resolved\n`);

  if (azure.skipped) {
    console.log(`  Azure DevOps:  ⚠  ${azure.reason}\n`);
  } else {
    const s = azure.summary;
    console.log('  Azure DevOps:');
    console.log(`    PRs merged:   ${s.mergedPRs}`);
    console.log(`    Commits:      ${s.totalCommits}`);
    console.log(`    AI assists:   ${s.aiPRs} PRs (${s.aiAssistRate}%)`);
    if (Object.keys(azure.byTool || {}).length > 0) {
      const tools = Object.entries(azure.byTool).map(([t, n]) => `${t}(${n})`).join(' · ');
      console.log(`    By tool:      ${tools}`);
    }
    console.log('');
  }
  hdr('══════════════════════════════════════════');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // ── Subcommands ──────────────────────────────────────────────────────────────
  if (command === 'history') { cmdHistory(); return; }

  if (command === 'open') {
    const label = args[1];
    if (!label) { console.error('Usage: node weekly-report.mjs open <YYYY-WNN>'); process.exit(1); }
    cmdOpen(label);
    return;
  }

  if (!command || command === '--help' || command === '-h') {
    console.log(`
  Weekly Productivity Report

  Usage:
    node weekly-report.mjs                    current week (last week on Mondays)
    node weekly-report.mjs --last             last completed week
    node weekly-report.mjs --week 2026-W15    specific ISO week
    node weekly-report.mjs history            list saved reports
    node weekly-report.mjs open 2026-W14      open a saved HTML report

  Auth:
    Jira:          auto (jira-creator/jira-config.json)
    Azure DevOps:  export AZURE_TOKEN=<PAT>   # Code (Read) scope needed
`);
    return;
  }

  // ── Resolve week ─────────────────────────────────────────────────────────────
  let weekInfo;
  try {
    weekInfo = resolveWeek(args);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const { monday, sunday, label } = weekInfo;
  const range = `${monday.toISOString().slice(0, 10)} → ${sunday.toISOString().slice(0, 10)}`;

  hdr(`\n  Generating weekly report for ${label}  (${range})`);

  // ── Fetch Jira ───────────────────────────────────────────────────────────────
  log('Fetching Jira tickets...');
  let jira;
  try {
    const { fetchWeeklyJiraData } = await import('./lib/jira.mjs');
    jira = await fetchWeeklyJiraData(monday, sunday);
    ok(`Jira: ${jira.summary.resolved} resolved, ${jira.summary.inProgress} in-progress`);
  } catch (e) {
    warn(`Jira fetch failed: ${e.message}`);
    jira = {
      user: { name: 'Amar Gupta' },
      siteUrl: 'https://gofynd.atlassian.net',
      weekFrom: monday.toISOString().slice(0, 10),
      weekTo: sunday.toISOString().slice(0, 10),
      all: [], resolved: [], inProgress: [],
      summary: { total: 0, resolved: 0, inProgress: 0, storyPointsResolved: 0, storyPointsTotal: 0 },
      byType: {}, byPriority: {},
      error: e.message,
    };
  }

  // ── Fetch Azure DevOps ───────────────────────────────────────────────────────
  log('Fetching Azure DevOps PRs and commits...');
  let azure;
  try {
    const { fetchWeeklyAzureData } = await import('./lib/azure.mjs');
    azure = await fetchWeeklyAzureData(monday, sunday);
    if (azure.skipped) {
      warn(`Azure DevOps: ${azure.reason}`);
    } else {
      ok(`Azure: ${azure.summary.mergedPRs} merged PRs, ${azure.summary.totalCommits} commits, ${azure.summary.aiPRs} AI-assisted`);
    }
  } catch (e) {
    warn(`Azure fetch failed: ${e.message}`);
    azure = { skipped: true, reason: e.message, prs: [], mergedPRs: [], commits: [], aiPRs: [], byTool: {}, commitsByDay: {}, commitsByRepo: {}, repos: [], summary: { totalPRs: 0, mergedPRs: 0, activePRs: 0, totalCommits: 0, cursorCommits: 0, aiPRs: 0, aiAssistRate: 0 } };
  }

  // ── Load previous week snapshot (for deltas) ─────────────────────────────────
  const prevLabel = prevWeekLabel(label);
  const prev = loadSnapshot(prevLabel);
  if (prev) {
    info(`Loaded last week snapshot (${prevLabel}) for comparison`);
  }

  // ── Save snapshot ────────────────────────────────────────────────────────────
  const snapshot = { label, weekFrom: monday.toISOString().slice(0, 10), weekTo: sunday.toISOString().slice(0, 10), generatedAt: new Date().toISOString(), jira: { summary: jira.summary }, azure: { summary: azure.summary, byTool: azure.byTool } };
  saveSnapshot(label, snapshot);
  ok(`Snapshot saved → weekly-report/history/${label}.json`);

  // ── Generate HTML ────────────────────────────────────────────────────────────
  log('Generating HTML report...');
  const { generateReport } = await import('./lib/html.mjs');
  const html = generateReport({
    jira,
    azure,
    weekFrom: monday.toISOString().slice(0, 10),
    weekTo: sunday.toISOString().slice(0, 10),
    prev,
  });

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = reportPath(label);
  writeFileSync(outPath, html, 'utf-8');
  ok(`HTML report  → weekly-report/reports/${label}.html`);

  // ── Print summary ─────────────────────────────────────────────────────────────
  printSummary(label, range, jira, azure);

  // ── Auto-open in browser ─────────────────────────────────────────────────────
  if (!args.includes('--no-open')) {
    try {
      const cmd = process.platform === 'darwin' ? `open "${outPath}"`
        : process.platform === 'win32' ? `start "" "${outPath}"`
        : `xdg-open "${outPath}"`;
      execSync(cmd);
      info(`Opened in browser: ${outPath}`);
    } catch { /* best-effort */ }
  }

  console.log('');
}

main().catch(e => {
  console.error(`\nFatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
