#!/usr/bin/env node

/**
 * jira-transition.mjs — CLI tool for browser-based JIRA transitions
 *
 * Usage:
 *   node jira-transition.mjs --setup                         # Save login session
 *   node jira-transition.mjs --inspect JCP-9808              # Inspect DOM for selectors
 *   node jira-transition.mjs JCP-9808 "Dev Testing"          # Headless transition
 *   node jira-transition.mjs JCP-9808 "Dev Testing" --file ./evidence.png
 *   node jira-transition.mjs JCP-9808 "Dev Testing" --visible
 *   node jira-transition.mjs JCP-9808 "Dev Testing" --visible --slowmo 500
 */

import { setupAuth } from './lib/auth.mjs';
import { inspectPage, performTransition } from './lib/transition.mjs';

// ── Arg parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getFlagValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function getPositionalArgs() {
  return args.filter((a) => !a.startsWith('--'));
}

// ── Help ─────────────────────────────────────────────────────────────

if (hasFlag('--help') || hasFlag('-h') || args.length === 0) {
  console.log(`
jira-transition — Browser-based JIRA transition tool

Usage:
  node jira-transition.mjs --setup
    Open browser for manual JIRA login. Saves session cookies.

  node jira-transition.mjs --inspect <ISSUE_KEY>
    Open the issue in a visible browser and dump DOM info for selector discovery.

  node jira-transition.mjs <ISSUE_KEY> <TRANSITION_NAME> [options]
    Perform a JIRA transition (with attachment if the screen requires one).

Options:
  --file <path>    Attach this file instead of a placeholder
  --visible        Run with visible browser (for debugging)
  --slowmo <ms>    Slow down browser actions (use with --visible)
  --help, -h       Show this help
`);
  process.exit(0);
}

// ── Route ────────────────────────────────────────────────────────────

async function main() {
  try {
    // --setup
    if (hasFlag('--setup')) {
      await setupAuth();
      return;
    }

    // --inspect <ISSUE_KEY>
    if (hasFlag('--inspect')) {
      const issueKey = getFlagValue('--inspect') || getPositionalArgs()[0];
      if (!issueKey) {
        console.error('Error: --inspect requires an issue key. E.g. --inspect JCP-9808');
        process.exit(1);
      }
      await inspectPage(issueKey);
      return;
    }

    // Transition mode: <ISSUE_KEY> <TRANSITION_NAME>
    const positional = getPositionalArgs();
    if (positional.length < 2) {
      console.error('Error: Expected <ISSUE_KEY> and <TRANSITION_NAME>.');
      console.error('Run with --help for usage.');
      process.exit(1);
    }

    const [issueKey, transitionName] = positional;
    const filePath = getFlagValue('--file');
    const visible = hasFlag('--visible');
    const slowMo = parseInt(getFlagValue('--slowmo') || '0', 10);

    await performTransition(issueKey, transitionName, {
      visible,
      slowMo,
      filePath,
    });
  } catch (err) {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  }
}

main();
