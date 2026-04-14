# Automation Runbook

This document explains the operational flow and the exact commands to run for:

1. Sentry alert polling
2. Jira ticket creation
3. Agent execution
4. Azure DevOps PR creation
5. Recovery when execution or PR creation fails

## Flow Overview

The current automation is split into two parts:

1. Sentry side
   Sentry is polled for new unresolved issues and Jira tickets are created.
2. Agent side
   Dr.-Nexus picks Jira tickets, works on the code, pushes the feature branch, and creates the Azure DevOps PR.

## Prerequisites

Run everything from the project root:

```bash
cd <project-dir>
```

Required tools:

```bash
node -v
pnpm -v
az version
git --version
```

Expected CLIs on `PATH`:

- `az`
- `git`
- your configured AI CLI (`claude` and/or `codex`)

Optional but recommended:

- `aisum` for better PR title/description summarisation

Install project dependencies:

```bash
pnpm install
```

## Configuration Files

Main runtime config:

```bash
config.json
```

Reference schema:

```bash
config.example.json
```

Sentry credentials may also be loaded from:

```bash
../sentry-alert/sentry-config.json
```

Sentry service filters support:

- `minLevel`
  Minimum event level to fetch, for example `error`
- `issueStatus`
  Use `unresolved` to fetch only unresolved issues, or `all` to fetch all matching issues regardless of status

## Commands

### 1. Check CLI Help

```bash
node src/index.js --help
```

### 2. Poll Sentry Once

Use this to list Sentry issues once and exit. This does not create Jira tickets.

```bash
node src/index.js sentry-poll
```

### 3. Create Jira Ticket for One Chosen Sentry Issue

After reviewing the listed issues, pick the issue ID you want and create Jira only for that issue.

```bash
node src/index.js sentry-jira 135345
```

### 4. Run the Sentry Daemon

Use this when you want continuous Sentry polling that lists issues continuously for operator review.

```bash
node src/index.js sentry-daemon
```

### 5. Dry Run Jira Processing

Use this to see what tickets would be processed without making changes.

```bash
pnpm run dry-run
```

### 6. Process a Single Jira Ticket

Use this when a Jira ticket already exists and you want the agent to work on it end to end.

```bash
pnpm run single -- JCP-123
```

Direct form:

```bash
node src/index.js single JCP-123
```

### 7. Run the Jira Daemon

Use this when you want Dr.-Nexus to continuously pick Jira tickets with the configured trigger label.

```bash
pnpm start
```

Direct form:

```bash
node src/index.js daemon
```

### 8. Resume a Failed Run

Use this when the pipeline failed after creating a checkpoint.

```bash
pnpm run resume -- JCP-123 --from-step=5
```

Direct form:

```bash
node src/index.js resume JCP-123 --from-step=5
```

Common resume points:

- `--from-step=5`
  Resume from execution using the saved cheatsheet.
- `--from-step=7`
  Resume ship/notify path only.

Important:

- Run the command from the `Dr.-Nexus` directory.
- Resume uses `.pipeline-state/<ticketKey>/state.json` relative to the current working directory.

Checkpoint check:

```bash
ls .pipeline-state/JCP-123/state.json
```

### 9. Retry Only PR Creation

Use this when code is already pushed but PR creation failed due to Azure auth.

```bash
node src/index.js create-pr JCP-123
```

This command:

- loads the saved checkpoint
- reuses the saved feature branch
- retries only Azure DevOps PR creation
- does not rerun execution, validation, commit, or push

## Recommended End-to-End Operational Flows

### Flow A: Operator-Driven Sentry -> Jira -> Agent

Terminal 1:

```bash
cd <project-dir>
node src/index.js sentry-poll
```

Terminal 2:

```bash
cd <project-dir>
node src/index.js sentry-jira <ISSUE-ID>
```

Terminal 3:

```bash
cd <project-dir>
pnpm start
```

What happens:

1. Sentry issues are listed.
2. Operator picks the desired Sentry issue ID.
3. Jira ticket is created only for that selected issue.
4. Dr.-Nexus daemon picks matching Jira tickets.
5. Agent creates code changes, pushes branch, and opens Azure DevOps PRs.

### Flow B: Manual Single-Ticket Run

Use this when you already have a Jira ticket and want to process it directly.

```bash
cd <project-dir>
pnpm run single -- JCP-123
```

### Flow C: Recovery After Azure PR Auth Failure

Use this when git push worked but Azure PR creation failed.

Step 1:
Load shell auth helper.

```bash
cd <project-dir>
source ~/.zshrc
```

Step 2:
Resolve Azure token into the current shell.

```bash
export AZURE_DEVOPS_EXT_PAT="$(_ado_token)"
```

Step 3:
Verify Azure auth.

```bash
az repos pr list \
  --organization https://dev.azure.com/YOUR_ORG \
  --project YOUR_ADO_PROJECT \
  --repository your-service \
  --top 1 \
  --output table
```

Step 4:
Retry only PR creation.

```bash
node src/index.js create-pr JCP-123
```

## Troubleshooting

### Resume starts from step 1

Cause:
The command was not run from the `Dr.-Nexus` directory, so the checkpoint was not found.

Fix:

```bash
cd <project-dir>
node src/index.js resume JCP-123 --from-step=7
```

### Git push succeeds but PR creation fails

Cause:
SSH auth worked for git, but Azure CLI auth was missing or invalid.

Fix:

```bash
source ~/.zshrc
export AZURE_DEVOPS_EXT_PAT="$(_ado_token)"
node src/index.js create-pr JCP-123
```

### `aisum` warning appears

Example:

```text
Summariser failed for pr-title: spawnSync aisum ENOENT
```

Meaning:
`aisum` is not installed on `PATH`.

Impact:
Non-blocking. The system falls back to hard truncation.

### `pixelbin-upload` warning appears

Meaning:
Artifact upload helper is missing.

Impact:
Non-blocking. Jira/Slack "full report" link may be missing, but PR creation is unaffected.

## Useful File Locations

Checkpoint state:

```bash
.pipeline-state/JCP-123/state.json
```

Cheatsheet:

```bash
.pipeline-state/JCP-123/cheatsheet.md
```

Run logs:

```bash
logs/YYYY-MM-DD/
```

PR review artifacts:

```bash
.pipeline-state/JCP-123/pr-review/
```

## Quick Command Summary

```bash
cd <project-dir>
pnpm install
node src/index.js --help
node src/index.js sentry-poll
node src/index.js sentry-jira 135345
node src/index.js sentry-daemon
pnpm start
pnpm run dry-run
pnpm run single -- JCP-123
pnpm run resume -- JCP-123 --from-step=5
source ~/.zshrc
export AZURE_DEVOPS_EXT_PAT="$(_ado_token)"
node src/index.js create-pr JCP-123
```
