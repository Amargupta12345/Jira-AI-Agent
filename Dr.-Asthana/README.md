# Auto Dev Agent (Dr. Asthana) v2

An autonomous AI developer agent that picks up JIRA tickets, runs a multi-agent council to debate implementation strategy, and submits draft PRs for human review.

## Architecture: Council-then-Execute

The core insight: **expensive models think together, a cheap model does the work.**

```
JIRA Ticket
    ↓
┌─────────────────────────────────────────────────────────────┐
│  COUNCIL (expensive models, read-only tools)                │
│                                                             │
│  Round 1..N:                                                │
│    Proposer → explores codebase, proposes strategy          │
│    Critics  → adversarial review, must find 3+ issues       │
│    Agreement → AGREED (all critiques addressed) or DISAGREE │
│                                                             │
│  All discussions written to files for full visibility.      │
│  Agents have session memory — no rework across rounds.      │
│  Human feedback via human-feedback.md at any time.          │
│                                                             │
│  ↓ Quality gate: structural checks + AI evaluator           │
│  ↓ Extract cheatsheet between configurable markers          │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│  EXECUTE (cheap model, full tools)                          │
│  Follows cheatsheet exactly. No planning. No decisions.     │
└─────────────────────────────────────────────────────────────┘
    ↓
Validate (critical/warnings) → Diff Review + PR Review Council → Commit → Push → PR on Azure DevOps
```

The **cheatsheet** is the most valuable artifact. It's persisted to disk so failed executions can retry without re-running the council.

## Tech Stack

- **Runtime:** Node.js (ES modules, async/await throughout)
- **Package manager:** pnpm
- **AI:** Claude Code / Codex via AI Provider module (pluggable strategies)
- **Source control:** Azure DevOps (PRs via `az` CLI)
- **Ticketing:** JIRA REST API v3 + jira-cli.mjs (ADF comments, label management)
- **Notifications:** Slack (Block Kit DMs via `@slack/web-api`)

## Project Structure

```
src/
  index.js                → CLI entry point (daemon, single, dry-run, resume)
  ai-provider/            → Sole interface for spawning AI CLIs
    index.js              → runAI(), getProviderLabel()
    provider.js           → Public facade (stable exports used by strategies/council)
    provider/             → Internal runtime pieces (spawn-runtime, event-parser, log-writer, result-utils)
    adapters/             → Claude Code and Codex CLI adapters
    strategies/           → single, fallback, parallel, race
  agent/                  → Deliberately dumb executor (static prompt + cheatsheet)
  council/                → Reusable multi-agent deliberation engine
    create-council.js     → Public API + options validation (createCouncil)
    orchestrator/         → run-council coordinator
    stages/               → proposer, critics, agreement, evaluation stage modules
    runtime/              → runner + workspace (AI calls, artifacts, human feedback)
    evaluator/            → configurable quality gate (structural + AI)
    config/               → defaults + agent resolver
    utils/                → feedback helper(s)
  infra/                  → MongoDB/Redis/Kafka lifecycle
  jira/                   → JIRA REST API (read), CLI operations (write), ticket parser, validator
  notification/           → Slack DMs, JIRA ADF comments, report formatters, log upload
  pipeline/               → Orchestrator, checkpoint persistence, step definitions
  prompt/                 → All prompt construction: council config, context builders, executor rules
    council-prompts.js    → Prompt builders for council phases (proposer, critic, agreement)
    pr-review.js          → PR review council orchestrator (thin wiring only)
    review-context.js     → Builds PR review context (working-tree + base-branch diff)
    review-prompts.js     → PR review roles, prompt builders, structural checks
    review-parser.js      → Parses PR review verdict/findings/summary
    ticket-context.js     → Ticket data → markdown context
    codebase-context.js   → Clone analysis → markdown context
    static.js             → Executor guardrails (no git, no docker, follow cheatsheet)
    validator.js          → Post-execution validation (critical/warnings) + structural diff review
  service/                → Git operations, Azure DevOps PR creation, base image tagger
  utils/                  → Config loader, logger (run/step tracking), AI summariser
agent-rules-with-tests.md → Rules injected into clone when tests enabled
agent-rules-no-tests.md   → Rules injected when tests handled externally
config.json               → Runtime configuration
clean.sh                  → Cleanup utility: ./clean.sh (all) or ./clean.sh <KEY> (specific ticket)
```

## How It Works

1. Agent polls JIRA for tickets with the configured trigger label.
2. Fetches and parses ticket details (title, description, comments, affected systems, fix versions).
3. Validates required fields (content, structure, scope, service config).
4. **Transitions ticket to In-Progress** and posts a JIRA comment (both non-blocking, independent).
5. For each affected service x target branch:
   a. Clones the repo, creates a feature branch, injects agent rules.
   b. **Council phase** — a proposer explores the codebase (follows the service's own CLAUDE.md/codex.md for test commands); adversarial critics must find 3+ concrete issues (missing files/tests, broken refs, test infrastructure, incomplete removal). AGREED = plan already covers critiques without changes; DISAGREE = plan needs revision (triggers next round). Runs 1-3 rounds.
   c. **Evaluate** — quality gate runs structural pre-checks + AI evaluator, extracts a clean cheatsheet.
   d. **Execute** — cheap model follows the cheatsheet exactly (static prompt + guardrails).
   e. **Validate + PR review** — structural validation + structural diff review + independent PR-review council. Critical issues from validation or PR review trigger retry; warnings are flagged in PR.
   f. Commits, pushes (force if needed), handles base image tagging, opens a PR on Azure DevOps (approach summary + file change list + diff stats + review notes, capped at 4000 chars).
6. **Transitions ticket to LEAD REVIEW** (if PRs were created).
7. Bundles run artifact to CDN. Posts plain-English JIRA comment and concise Slack DM (both always fire, even if transitions fail). Updates labels.

## Council Module

The council is a **reusable multi-agent deliberation engine** — decoupled from tickets or any specific use case. The caller provides everything: goal, context, agent roles, prompt builders, evaluation criteria, and output format.

Used in two independent paths:
- Cheatsheet planning council (feature implementation strategy)
- PR review council (diff-based quality gate before shipping, optional `prReviewCouncil` config)

**What it handles:** round orchestration, turn-taking, session continuity (agents don't re-read the codebase), file-based discussions (all outputs written to disk), human-in-the-loop (drop a file to steer), and graceful degradation (critic failures skip, proposer failure breaks, last-round force-evaluates).

**Workspace** — all agent discussions are written to `.pipeline-state/<label>/council/`:
```
council/
├── status.md                 ← Live status with timestamps
├── round-1/
│   ├── agent-0-proposal.md   ← Proposer's full output
│   ├── agent-1-critique.md   ← Critic's review
│   ├── agreement.md          ← AGREED/DISAGREE + synthesis
│   └── evaluation.md         ← Pass/fail + feedback
├── round-2/ ...
└── human-feedback.md         ← Drop this file to inject guidance mid-council
```

## AI Provider

All AI spawning goes through `src/ai-provider/`. Supports four strategies:

| Strategy | Behavior |
|----------|----------|
| `single` | One provider, return result (default) |
| `fallback` | Primary first, secondary on failure |
| `parallel` | Both simultaneously, pick best result |
| `race` | Both simultaneously, return first finisher |

Three modes with different tool permissions:

| Mode | Purpose | Tools | Default Model |
|------|---------|-------|---------------|
| `execute` | Write code | Read,Write,Edit,Bash,Glob,Grep | haiku |
| `debate` | Explore & argue | Read,Glob,Grep | sonnet |
| `evaluate` | Judge quality | Read,Glob,Grep | sonnet |

## Configuration

Edit `config.json` in the project root. See `config.example.json` for the full schema.

| Section | What it configures |
|---|---|
| `jira` | baseUrl, email, apiToken, trigger label, done label, custom field IDs |
| `azureDevOps` | org URL, project, SSH repo base URL |
| `services` | map of service name -> { repo } |
| `slack` | botToken, userId for DM notifications |
| `agent` | pollInterval (300s), maxTicketsPerCycle (1), logDir, executionRetries |
| `aiProvider` | execute strategy + execute-mode provider settings |
| `council` | council runtime config: `maxRounds`, `proposer`, `critics`, `evaluator` |
| `prReviewCouncil` | optional independent council config used only for PR review (same shape as `council`) |
| `infra` | enabled, scriptsDir, stopAfterProcessing |
| `tests` | enabled |

Provider can be set per council role (`proposer`, `critics[*]`, `evaluator`) to either `claude` or `codex`.

## Artifacts

| Location | Purpose |
|----------|---------|
| `.tmp/agent-*` | Cloned repos (cleaned up after each service branch) |
| `.pipeline-state/<ticketKey>/state.json` | Pipeline checkpoint for resume |
| `.pipeline-state/<ticketKey>/cheatsheet.md` | Persisted cheatsheet (survives retries) |
| `.pipeline-state/<ticketKey>/council/` | Council workspace: round artifacts, status, human feedback |
| `.pipeline-state/<ticketKey>/pr-review/council/` | PR review council workspace (separate from planning council) |
| `logs/YYYY-MM-DD/<runId>.log` | Full run log |

## Infrastructure (Optional)

The agent can optionally start/stop local infrastructure services (MongoDB, Redis, Kafka) before running tests. Disabled by default. Set `infra.enabled: true` and point `infra.scriptsDir` to a directory containing `run_services.sh` and `stop-services.sh`.

## Setup

```bash
pnpm install
cp config.example.json config.json  # then fill in your values
```

Ensure `az` CLI is authenticated for Azure DevOps and the configured AI CLI (`claude` and/or `codex`) is available on PATH.
For length-safe summaries, ensure `aisum` is installed on PATH.

## Running

```bash
# Continuous polling (daemon mode)
pnpm start

# Process a single ticket
pnpm run single -- JCP-123

# Dry run — show what would be processed without making changes
pnpm run dry-run

# Resume a failed run from a specific step
pnpm run resume -- JCP-123 --from-step=5
```
