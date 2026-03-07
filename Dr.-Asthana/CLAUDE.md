# Agent Context

You are an AI developer agent working autonomously on JIRA tickets.
Your changes will be submitted as draft PRs for human review.

## Rules
1. Read before writing. Explore relevant files and understand patterns first.
2. Minimal diff. Only change what the ticket requires.
3. Follow existing conventions. Match code style, naming, patterns.
4. Handle errors properly. This is a high-throughput production system.
5. No placeholders or TODOs. Every line must be production-ready.
6. Run lint/test if available. Note failures but don't block on infra issues.
7. All changes must be submitted via PR. Always create feature branches from `main`.

## Tech Stack
- Node.js + Express backend
- MongoDB with Mongoose
- Redis caching (two-layer: in-memory + Redis with pub/sub invalidation)
- Microservices on Kubernetes
- Async/await throughout

## CLI Modes
The bot is invoked via `node src/index.js <command>`:
- `daemon` — continuous poll loop, checks JIRA every `agent.pollInterval` seconds (default 300s), processes up to `agent.maxTicketsPerCycle` tickets per cycle.
- `single <KEY>` — process one specific JIRA ticket by key (e.g., `single JCP-123`).
- `dry-run` — poll once, display parsed ticket details, make no changes.
- `resume <KEY> --from-step=N` — resume a failed run from a specific step.

## Package Manager
This project uses **pnpm**. Do not use npm or yarn.

## Working Directory
- Repos are cloned into `.tmp/` within the project root (not the system temp directory).
- Implementation clones get a unique subdirectory under `.tmp/agent-*`.
- `.tmp/` is git-ignored and cleaned up automatically after each run.

## Directory Structure
```
src/
  index.js                → CLI entry point (daemon, single, dry-run, resume)
  ai-provider/
    index.js              → Public API: runAI(), getProviderLabel()
    provider.js           → Public facade (stable exports used by strategies/council)
    provider/             → Internal runtime (spawn-runtime, event-parser, log-writer, result-utils)
    adapters/
      claude.js           → Claude Code CLI adapter (args builder, stream-json parser)
      codex.js            → Codex CLI adapter (args builder, output parser)
    strategies/
      single.js           → Run one provider, return result
      fallback.js         → Run primary, if it fails run secondary
      parallel.js         → Run both simultaneously, pick best result
      race.js             → Run both, return whichever finishes first
  agent/
    index.js              → Deliberately dumb executor (static prompt + cheatsheet → runAI)
  council/
    index.js              → Public API: createCouncil()
    create-council.js     → Public API + options validation (createCouncil)
    orchestrator/         → run-council coordinator
    stages/               → proposer, critics, agreement, evaluation stage modules
    runtime/              → runner + workspace (AI calls, artifacts, human feedback)
    evaluator/            → configurable quality gate (structural pre-checks + AI evaluation)
    config/               → defaults + agent resolver
    utils/                → feedback helper(s)
  infra/
    index.js              → Infrastructure lifecycle (start/stop MongoDB, Redis, Kafka)
  jira/
    index.js              → Public API re-exports
    client.js             → JIRA REST API (getTicketDetails, getTicketStatus) — read-only
    parser.js             → Ticket parsing, ADF→markdown, fix-version-to-branch mapping
    transitions.js        → JIRA CLI operations via jira-cli.mjs (transitions, comments, search, labels)
    validator.js          → Pre-processing ticket validation (required fields, scope checks)
  notification/
    index.js              → Public API: postJiraStep, postFinalJiraReport, notifySlack*
    report.js             → Report builders (JIRA ADF comments, Slack Block Kit messages)
    slack.js              → Slack WebClient DM sender
  pipeline/
    index.js              → Pipeline orchestrator (runPipeline, resume)
    bundler.js            → Run artifact bundler (tar + upload to Pixelbin CDN)
    checkpoint.js         → Checkpoint persistence (.pipeline-state/<ticketKey>/)
    steps.js              → Step definitions (FETCH_TICKET through NOTIFY)
  prompt/
    index.js              → Orchestrates: ticket context → codebase context → council → cheatsheet
    council-prompts.js    → Prompt builders for council phases (proposer, critic, agreement)
    pr-review.js          → PR review council orchestrator (thin wiring only)
    review-context.js     → Builds PR review diff context (working-tree + base-branch diff)
    review-prompts.js     → PR review roles, prompt builders, structural checks
    review-parser.js      → PR review output parser (verdict/findings/summary)
    validator.js          → Post-execution validation (git diff, file alignment, debug log check)
    static.js             → Static system prompt for the executor agent
    ticket-context.js     → Builds ticket context markdown from parsed ticket data
    codebase-context.js   → Reads CLAUDE.md, file tree, package.json from clone
  service/
    index.js              → Public API re-exports
    git.js                → Clone, branch, commit, push, cleanup
    azure.js              → Azure DevOps PR creation via az CLI
    base-tagger.js        → Base image tag creation (auto-detected from Dockerfile)
  utils/
    index.js              → Public API re-exports
    config.js             → Config loader, validator, getRepoUrl(), getServiceConfig()
    logger.js             → Enhanced logger with file output, run/step tracking
    summariser.js         → aisum wrapper for length-safe summaries
agent-rules-with-tests.md  → Standing rules injected into clone's CLAUDE.md when tests enabled
agent-rules-no-tests.md    → Standing rules injected when tests handled externally
config.json                → Runtime configuration (JIRA, Azure DevOps, services, Slack, aiProvider, council)
clean.sh                   → Cleanup utility: ./clean.sh (all) or ./clean.sh <KEY> (specific ticket)
```

## Core Architecture: Council-then-Execute

The system separates **thinking** from **doing**: expensive models collaborate in a council to produce a plan, then a cheap model executes it.

### 1. Council (expensive models)
A group of AI agents collaborate via file-based discussions to produce an actionable output. A proposer explores the codebase and proposes a strategy — must follow the service's own instruction files (CLAUDE.md/codex.md/README.md) for test commands and validation steps, not invent ad-hoc ones. Adversarial critics must independently verify claims in the codebase and find at least 3 concrete issues (missing files, missing tests, broken references, incomplete removal, test infrastructure like mocks/fixtures/setupFiles, wrong approach). The proposer then synthesizes critiques via AGREED/DISAGREE protocol — AGREED means the existing plan already covers every critique WITHOUT changes; DISAGREE means at least one critique requires plan changes (triggers another round). Runs 1-3 rounds until convergence. All discussions are persisted to disk for full visibility. Human feedback can be injected mid-council via a `human-feedback.md` file. Agents maintain session memory across rounds to avoid re-reading the codebase.

The council engine is used in two independent paths:
- **Cheatsheet planning council** (feature-development plan generation)
- **PR review council** (diff-based quality gate before shipping; optional separate `prReviewCouncil` config)

### 2. Evaluate (configurable quality gate)
Structural pre-checks (fast, no API calls: minimum length, file paths, action verbs) followed by an AI evaluator that judges the council output and extracts a clean artifact between configurable markers. Approval/rejection keywords and extraction markers are defined by the caller.

### 3. Execute (cheap model)
A deliberately dumb executor follows the extracted cheatsheet exactly. No planning, no exploration, no decisions. Gets a static system prompt with strict guardrails (no git, no docker, no deploy).

The **cheatsheet** is the most valuable artifact. It's persisted to `.pipeline-state/<ticketKey>/cheatsheet.md` so failed executions can retry without re-running the council.

## Council Module (`src/council/`)
A reusable multi-agent deliberation engine — decoupled from any specific use case. The caller configures everything: goal, context, agent roles, prompt builders, evaluation criteria, and output format. The council handles: round orchestration, turn-taking, session continuity (memory), file-based discussions, human-in-the-loop, and failure recovery.

**API:**
```js
import { createCouncil } from '../council/index.js';

const council = createCouncil({
  goal: 'What the council should achieve',
  context: 'All information the agents need',
  workingDir: '/path/to/repo',
  roles: { proposer: '...', critic: '...', agreement: '...(optional)' },
  prompts: {
    buildProposer: (round, baseContext, proposerOutput, criticOutputs, role, feedback) => string,
    buildCritic: (round, baseContext, proposerOutput, criticOutputs, criticIndex, role) => string,
    buildAgreement: (baseContext, proposerOutput, criticOutputs, agreementRole) => string,
  },
  evaluation: {
    structural: (output) => ({ passed, feedback }),     // optional, default checks length/files/verbs
    buildAiPrompt: (output, context, force) => string,  // required
    outputMarkers: { start: '=== START ===', end: '=== END ===' },  // required
    approvalKeyword: 'APPROVED',    // optional
    rejectionKeyword: 'REJECTED',   // optional
    forceOnLastRound: true,         // optional
  },
  config,
  label: 'identifier-for-logs',
  checkpointDir: '/path/to/workspace',
  feedback: 'prior feedback from failed run',  // optional
});

const result = await council.run();
// { passed: boolean, output: string|null, feedback: string|null, rounds: number }
```

**Round flow:**
1. **Proposer** (agent-0): Proposes strategy (round 1) or revises based on critiques (round 2+)
2. **Critics** (agent-1..N): Each critiques the proposal, sees prior critics' outputs
3. **Agreement**: Proposer synthesizes all critiques → responds AGREED or DISAGREE
4. **Evaluate**: Structural pre-checks + AI quality gate → extract output or reject

**Workspace layout** (`.pipeline-state/<label>/council/`):
```
council/
├── status.md                    ← Live status: current round, phase, timestamps
├── round-1/
│   ├── agent-0-proposal.md      ← Proposer's output
│   ├── agent-1-critique.md      ← Critic's output
│   ├── agreement.md             ← AGREED/DISAGREE + synthesis
│   └── evaluation.md            ← Pass/fail + feedback
├── round-2/
│   └── ...
└── human-feedback.md            ← Drop this file to steer mid-council
```

**Failure modes:**
- Critic fails or rate-limited → skip that critic, continue with rest
- Zero critics succeed → use proposer output directly for evaluation
- Proposer fails → break loop
- Max rounds exhausted → force-evaluate last output as best-effort

## Prompt Module (`src/prompt/`)
Owns all prompt construction across the pipeline. For the council, it provides ticket-specific configuration: proposer/critic role instructions, the AI evaluator prompt, and cheatsheet extraction markers. For the executor, it provides the static system prompt with guardrails.

**Key responsibilities:**
- `buildCheatsheet()` — builds ticket + codebase context, configures a council with ticket-specific roles and evaluation, runs it, returns the cheatsheet
- `reviewPullRequest()` — builds diff context, runs an independent PR-review council, returns verdict + critical/warning findings
- `council-prompts.js` — prompt builders passed into `createCouncil()` (proposer, critic, agreement phase prompts)
- `review-prompts.js` — PR review roles, wrappers for council prompt builders, evaluator prompt, structural pre-check
- `review-context.js` — builds review context from ticket + git diff (both working-tree and base-branch views)
- `review-parser.js` — parses review output sections into `{verdict, critical, warnings, summary}`
- `ticket-context.js` — converts parsed ticket data into markdown context
- `codebase-context.js` — reads CLAUDE.md/CODEX.md/codex.md/README.md (labeled as "Service Rules" — the authoritative source for test/build commands), file tree, package.json from clone. Pre-loads referenced files as 2K previews (40K total budget) — agents read full files on demand via tools.
- `static.js` — executor rules (follow cheatsheet exactly, no git/docker/deploy)
- `validator.js` — post-execution validation: empty diff (critical), cheatsheet step completeness (critical if <50% or test files missing), broken imports (warning), debug logs (warning). Also provides `reviewDiff()` for structural diff review (TODO/FIXME, JSON validity, broken imports). Returns `{valid, issues, critical, warnings}`.

## AI Provider Module (`src/ai-provider/`)
Single interface for all AI CLI spawning. No other module spawns `claude` or `codex` directly. `provider.js` is the public facade; process lifecycle, JSON event parsing, timeout/heartbeat, and log capture live under `provider/`.

### Modes
| Mode | Purpose | Tools | Model | Used By |
|------|---------|-------|-------|---------|
| `execute` | Follow cheatsheet — write code | Read,Write,Edit,Bash,Glob,Grep | Cheap (haiku) | Agent |
| `debate` | Explore codebase, argue strategy | Read,Glob,Grep (read-only) | Expensive (sonnet) | Council |
| `evaluate` | Judge council output quality | Read,Glob,Grep | Expensive (sonnet) | Council Evaluator |

### Strategies
- **single** (default): One provider, return result.
- **fallback**: Primary first, secondary on failure.
- **parallel**: Both simultaneously, pick best result (clones workdir for write mode to avoid conflicts).
- **race**: Both simultaneously, return whichever finishes first.

### Adapters
- **Claude Code** (`adapters/claude.js`): Builds `claude -p <prompt> --output-format stream-json`, parses stream-json events, extracts sessionId for resume.
- **Codex** (`adapters/codex.js`): Builds `codex exec <prompt> --json --approval-mode full-auto`, parses JSONL events, extracts thread_id for resume.

## Pipeline Module (`src/pipeline/`)
Orchestrates the full ticket processing flow. Each step is checkpointed to disk so failed runs can resume from any point.

### Processing Pipeline
```
Step 1:   FETCH_TICKET — fetch from JIRA REST API, parse ADF → markdown
Step 2:   VALIDATE_TICKET — required fields, scope checks, service config lookup
Step 2.5: Transition to In-Progress + JIRA comment (both non-blocking, independent)
Steps 3-7: For each service × branch (fully sequential, isolated clones):
  Step 3: CLONE_REPO — shallow clone, create feature branch, inject agent rules
  Step 4: BUILD_CHEATSHEET — council deliberation → quality gate → extract cheatsheet
  Step 5: EXECUTE — cheap model follows cheatsheet (static prompt + guardrails)
  Step 6: VALIDATE_EXECUTION — structural validation + structural diff review + PR-review council. Critical issues from validation or PR review trigger retry; warnings are carried into PR notes.
  Step 7: SHIP — commit, push (force if needed), base tag if applicable, create PR (cheatsheet + validation warnings in description)
Step 8:   NOTIFY — bundle artifact, transition (non-blocking), JIRA comment + Slack DM (always, even if transition fails), label updates
```

### Checkpoint Persistence
All step data is saved to `.pipeline-state/<ticketKey>/state.json`. The cheatsheet is separately persisted to `.pipeline-state/<ticketKey>/cheatsheet.md`. On resume, the pipeline skips completed steps and picks up from the specified step.

## Processing Model
- One service, one branch at a time — fully sequential.
- Each branch gets a fresh clone, processes completely (Clone → Council → Execute → Validate → Ship), then the next branch starts.
- No shared git state between branches; each is fully isolated.
- Multi-version tickets: each fix version produces a separate branch and PR per service.

## Agent Module (`src/agent/`)
The deliberately dumb executor. Combines the static system prompt (from `prompt/static.js`) with the cheatsheet and calls `runAI()` in `execute` mode with a cheap model. The static prompt enforces strict guardrails: follow the cheatsheet exactly, don't touch unlisted files, no git/docker/deploy commands, pnpm allowed for dependency management.

`execute(cheatsheet, cloneDir, config, options)` supports optional `options.feedback`, which is appended as retry guidance when prior validation/PR-review attempts failed.

## JIRA Module (`src/jira/`)
Two-layer architecture: `client.js` handles read-only REST API calls (fetch ticket, get status), while `transitions.js` handles all write operations via `jira-cli.mjs` (transitions, comments, search, labels).

- **Ticket parsing** (`parser.js`): Converts raw JIRA response + ADF content → structured `{key, summary, description, comments, type, priority, status, affectedSystems, fixVersion, targetBranch, targetBranches, labels}`.
- **Validation** (`validator.js`): Pre-processing checks — content present, structural fields set (affectedSystems, fixVersion), scope limits (single system, single version), service exists in config.
- **Transitions**: Dev Started, Dev Testing, EM Review — API-first with automatic browser fallback.
- **Comments**: Posted via `jira-cli.mjs comment add --file --auto-summarize`. Long content auto-summarized via `aisum`.

## Service Module (`src/service/`)
Git operations, Azure DevOps PR creation, and base image tagging.

- **Git** (`git.js`): Shallow clone (`--depth=50`), feature branch creation, agent rules injection (CLAUDE.md/CODEX.md restored before commit), force push on branch conflict.
- **Azure DevOps** (`azure.js`): PR creation via `az repos pr create`. PR description is structured for code reviewers (human and AI): ticket context, 2000-char implementation approach summarised from cheatsheet, file change list extracted from cheatsheet with per-file descriptions, diff stats, and review notes (validation warnings/critical issues). Hard-capped at 4000 chars (Azure DevOps limit). Handles TF401179 (PR already exists) by finding and returning the existing PR.
- **Base Tagger** (`base-tagger.js`): Auto-detected from Dockerfile. Creates `deploy.base.vMAJOR-MINOR-PATCH-BUILD` tags when `package.json`/`package-lock.json` change. Requires: Dockerfile with base-images registry FROM, Dockerfile.base, and azure-pipelines.yml.

## Notification Module (`src/notification/`)
Design principle: **Slack and JIRA messages are for humans** — plain language, no jargon, no code blocks. Link to the run report for debugging details. PR descriptions are the one place for comprehensive technical detail.

- **JIRA comments:** Layman-friendly plain English. In-progress: "Working on X — targeting branch Y". Final: plain-English summary + PR links + report link. No tables, no code blocks, no cheatsheet dumps.
- **Slack DMs:** Concise Block Kit messages — 3-4 blocks max. Header, PR link + 200-char summary, footer with report link. Not a wall of text.
- **Report link:** All debugging detail is in the run artifact (uploaded to Pixelbin CDN). JIRA/Slack just link to it.
- **Sanitization:** All Slack mrkdwn fields sanitized via `sanitizeForSlack()` (strips control chars, caps at 3000 chars). `sendDM()` retries with plain text fallback on `invalid_blocks` errors.
- **Summarisation:** Via `utils/summariser.js` (`aisum` with presets: jira-comment 32k, slack-message 500, pr-title 120, pr-description 2500). Hard truncation only as fallback.
- JIRA comments and transitions are decoupled — comment always posts even if transition fails.

## Git Operations
- Feature branches: `feature/{ticketKey}-{sanitized-summary}` (single branch) or `feature/{ticketKey}-{sanitized-summary}-{version}` (multi-branch).
- Shallow clone (`--depth=50`) for implementation.
- CLAUDE.md/CODEX.md is always restored before committing — injected rules never reach the remote.
- Force push on branch conflict (previous run left a remote branch).

## Base Image Tagging
- Base tags are auto-detected from each repo's `Dockerfile` — no per-service config needed.
- Three conditions must be met: `Dockerfile` with a matching base-images registry FROM line, `Dockerfile.base`, and `azure-pipelines.yml` all present.
- Tag prefix is always `deploy.base`, format: `deploy.base.vMAJOR-MINOR-PATCH-BUILD`.
- Only triggered when `package.json` or `package-lock.json` change in the committed diff.

## JIRA CLI Operations (`jira/transitions.js`)
All JIRA write operations route through `jira-cli.mjs` via `jira/transitions.js`. Direct REST API calls in `jira/client.js` are read-only.

- **Transitions** (Dev Started, Dev Testing, EM Review): via `jira-cli.mjs transition`. API-first with automatic browser fallback.
- **Comments**: via `jira-cli.mjs comment add --file --auto-summarize`.
- **Search**: via `jira-cli.mjs search --jql --json`. Throws on failure.
- **Labels**: via `jira-cli.mjs label add/remove`. Non-blocking.
- **jira-cli.mjs**: Working directory defaults to `~/Desktop/skills/jira/scripts/`.

## Notifications
- **JIRA:** Plain-English comments for non-technical readers. PR links + brief summary + report link for details.
- **Slack:** Concise DM with PR link, 200-char summary, and report link. Designed to be read in 5 seconds.
- **Run Artifact:** At end of run, `.pipeline-state/{ticketKey}/` is bundled into a `.tar.gz` and uploaded to Pixelbin CDN via `bundleRunArtifact()`. URL included in JIRA/Slack as "Full report" link for debugging.
- **Length limits:** Summarized via `utils/summariser.js` (`aisum` with presets). Hard truncation only as fallback.
- Comments are always posted regardless of whether JIRA transitions succeed or fail.

## Azure DevOps PR Creation
- PRs created via `az repos pr create` with org/project from config.
- If a PR already exists (TF401179 error), falls back to finding and returning the existing PR.

## Configuration (`config.json`)
Key sections:
- `jira` — baseUrl, email, apiToken, label, labelProcessed, custom field IDs
- `azureDevOps` — org, project, repoBaseUrl (SSH)
- `services` — map of service name to { repo }
- `slack` — botToken, userId
- `agent` — pollInterval (300s), maxTicketsPerCycle (1), logDir, executionRetries
- `aiProvider` — strategy + execute-mode provider settings
- `council` — `maxRounds`, `proposer`, `critics`, `evaluator`
- `prReviewCouncil` — optional independent council profile used only by PR review
- `infra` — enabled, scriptsDir, stopAfterProcessing
- `tests` — enabled

## Logging
- Run-level logging: each ticket run gets a unique ID, logs to `logs/YYYY-MM-DD/{runId}.log`.
- Step tracking with durations (startStep/endStep).
- AI pass logs saved to `.pipeline-state/{ticketKey}/ai-calls/{label}.log` — contains run info, full prompt (`=== PROMPT ===`), and human-readable agent output (`=== AGENT OUTPUT ===` with `[text]`, `[tool]`, `[exec]`, `[thinking]`, `[agent]`, `[result]` prefixes). Prompts are also written immediately as `.prompt.md` files when the process spawns.
- Council round artifacts saved to `.pipeline-state/<label>/council/round-N/`.
- Console output with ANSI colors; file output strips colors.

## Artifacts

All run output is consolidated under `.pipeline-state/{ticketKey}/` — one directory per ticket run:

```
.pipeline-state/{ticketKey}/
├── run.log                          ← Main run log (copied from logs/ at end)
├── run.errors.log                   ← Error-only log (copied from logs/ at end)
├── ai-calls/                        ← Per-AI-call logs
│   ├── council-r1-agent-0.log
│   ├── council-r1-agent-1.log
│   ├── evaluator-0.log
│   └── execute-attempt-1.log
├── council/                         ← Council workspace: round artifacts, status, human feedback
│   ├── status.md
│   ├── round-1/
│   │   ├── agent-0-proposal.md
│   │   ├── agent-1-critique.md
│   │   ├── agreement.md
│   │   └── evaluation.md
│   └── human-feedback.md
├── pr-review/
│   └── council/                     ← PR review council workspace (independent of planning council)
│       ├── status.md
│       ├── round-1/
│       │   ├── agent-0-proposal.md
│       │   ├── agent-1-critique.md
│       │   ├── agreement.md
│       │   └── evaluation.md
│       └── human-feedback.md
├── cheatsheet.md                    ← Persisted cheatsheet (survives retries)
└── state.json                       ← Pipeline checkpoint for resume
```

At the end of a run (step 8), the directory is bundled into a `.tar.gz` and uploaded to Pixelbin CDN as a single artifact. The CDN URL is included in JIRA comments and Slack DMs.

| Location | Purpose |
|----------|---------|
| `.tmp/agent-*` | Cloned repos (cleaned up after each service branch) |
| `.pipeline-state/<ticketKey>/` | Unified run artifact (see structure above) |
| `logs/YYYY-MM-DD/<runId>.log` | Console run log (copied into artifact dir at end) |
| `logs/YYYY-MM-DD/<runId>.errors.log` | Error log (copied into artifact dir at end) |

## Module Boundaries
Every module's `index.js` is the ONLY public interface. Internal files are private. Cross-module imports must go through `index.js`.

## Output Format
When done, summarize:
- FILES CHANGED: list of files
- SUMMARY: what was done (2-3 sentences)
- RISKS: what reviewer should check
