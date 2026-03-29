# My AI Dev Automation Playbook

A single reference for everything: how to automate daily work, all commands, and when to use what.

---

## The Big Picture

Four tools working together in a pipeline:

| Tool | What it does | Where it lives |
|------|-------------|----------------|
| **Sentry CLI + MCP** | Monitor production errors, get stack traces, resolve issues | `~/Documents/AI-Agent/sentry-alert/` |
| **jira-creator** | Create/manage Jira tickets, transitions, comments via CLI | `~/Documents/AI-Agent/jira-creator/` |
| **NEXUS** | Reads a Jira ticket → writes code → creates ADO PR → updates Jira + Slack — fully automatic | `~/Documents/AI-Agent/Dr.-Nexus/` |
| **Claude Code** (`claude`) | Interactive AI coding in your terminal (you drive, Claude helps) | your terminal |

```
Sentry Error → Jira Ticket (label: nexus) → NEXUS → ADO PR → Merge
```

---

## Scenario 0 — Sentry Error → Fully Automated Fix

**Use this when:** A production error fires in Sentry and you want it fixed without any manual steps.

```bash
# Terminal 1: Sentry daemon (polls Sentry, auto-creates Jira tickets)
cd ~/Documents/AI-Agent/Dr.-Nexus
node src/index.js sentry-daemon

# Terminal 2: NEXUS daemon (picks up Jira tickets, auto-creates ADO PRs)
cd ~/Documents/AI-Agent/Dr.-Nexus
node src/index.js daemon
```

Both daemons poll every 5 minutes. You get a Slack DM when the PR is ready.

---

## Scenario 0b — Sentry Error → Manual Ticket → Auto Fix

**Use this when:** You want to inspect the error before NEXUS runs.

```bash
# 1. Inspect the error
cd ~/Documents/AI-Agent/sentry-alert
node sentry-cli.mjs issues blitzkrieg
node sentry-cli.mjs event <issue-id>      # full stack trace

# 2. Create a Jira ticket
cd ~/Documents/AI-Agent/jira-creator
node jira-cli.mjs create --project JCP --type Bug \
  --summary "[Sentry] Error description" \
  --description "Sentry: https://sentry.tools.jiocommerce.io/issues/<id>/\n\n(paste stack trace)" \
  --jcp \
  --field 'fixVersions=[{"name":"Fynd Platform v1.10.7"}]' \
  --field 'customfield_10056=[{"value":"Blitzkrieg"}]'

# 3. Trigger NEXUS
node jira-cli.mjs label add JCP-XXXX nexus
cd ~/Documents/AI-Agent/Dr.-Nexus
node src/index.js single JCP-XXXX

# 4. After PR merges — resolve in Sentry
cd ~/Documents/AI-Agent/sentry-alert
node sentry-cli.mjs resolve <issue-id>
```

---

## Scenario 1 — Fully Automated (NEXUS handles everything)

**Use this when:** The ticket is clear enough that you could explain it to a junior dev in 2-3 sentences.

### Step 1 — Write a good Jira ticket

A good ticket has:
- **Summary:** one sentence, action + component (e.g. "Fix: delete page should remove from published_pages too")
- **Description:** what's broken, why, what files are likely involved
- **Affected Systems:** `blitzkrieg` or `skyfire` (NEXUS reads this to know which repo)
- **Fix Version:** e.g. `Fynd Platform v1.10.7`
- **Target Branch:** e.g. `version/1.10.6`

### Step 2 — Add the trigger label

In Jira → label the ticket: **`nexus`**

That's it. NEXUS will pick it up within 5 minutes (polls every 5 min).

### Step 3 — Watch it run (optional)

```bash
# Tail the live log to watch progress
tail -f ~/Documents/AI-Agent/Dr.-Nexus/logs/$(date +%Y-%m-%d)/*.log
```

### Step 4 — Check the PR

You'll get a **Slack DM** and a **Jira comment** with the PR link when it's done.
Open the PR, review the diff, approve or leave feedback.

---

## Scenario 2 — Run a specific ticket manually (no daemon)

Use this when you want to run one ticket right now without waiting for the daemon.

```bash
cd ~/Documents/AI-Agent/Dr.-Nexus
pnpm run single -- JCP-XXXXX
```

---

## Scenario 3 — Do it yourself (Claude Code assists you)

**Use this when:** Emergency fix, the ticket is ambiguous, or NEXUS failed.

```bash
# 1. Open the repo in Claude Code
cd ~/Documents/Cursor-Repo/blitzkrieg
claude

# 2. Tell Claude what to do (natural language)
# Example: "Fix the deleteAvailablePage handler to also delete from published_pages"

# 3. Create Jira ticket via CLI
cd ~/Documents/AI-Agent/jira-creator
node jira-cli.mjs create --project JCP --type Bug \
  --summary "your title here" \
  --description "your description" \
  --jcp

# 4. Commit with the ticket ID
git add <files>
git commit -m "ID:JCP-XXXXX; fix: your message here"
git push origin <your-branch>

# 5. Create ADO PR
source ~/.zshrc
AZURE_DEVOPS_EXT_PAT=$(_ado_token) az repos pr create \
  --repository blitzkrieg \
  --source-branch <your-branch> \
  --target-branch version/1.10.6 \
  --title "ID:JCP-XXXXX; fix: your message" \
  --description "your PR description"
```

---

## All Commands — Copy & Paste Reference

### NEXUS

```bash
cd ~/Documents/AI-Agent/Dr.-Nexus

# Run as daemon (continuous, polls every 5 min)
pnpm start

# Process ONE specific ticket right now
pnpm run single -- JCP-XXXXX

# Dry run — just parse the ticket, make no changes
pnpm run dry-run

# Resume a failed run from a specific step (1–8)
pnpm run resume -- JCP-XXXXX --from-step=5

# Watch live logs
tail -f ~/Documents/AI-Agent/Dr.-Nexus/logs/$(date +%Y-%m-%d)/*.log

# Clean up after a run (remove cloned repos + pipeline state)
./clean.sh             # cleans ALL tickets
./clean.sh JCP-XXXXX  # cleans only that ticket
```

### Pipeline Steps (for resume)

| Step # | Name | What it does |
|--------|------|-------------|
| 1 | FETCH_TICKET | Read Jira ticket details |
| 2 | VALIDATE_TICKET | Check all required fields are present |
| 3 | CLONE_REPO | Clone repo, create feature branch |
| 4 | BUILD_CHEATSHEET | AI council debates → produces plan |
| 5 | EXECUTE | AI writes the code following the plan |
| 6 | VALIDATE_EXECUTION | Check diff looks right |
| 7 | SHIP | Commit, push, create ADO PR |
| 8 | NOTIFY | Comment on Jira + Slack DM |

**Resume examples:**
```bash
# Code was written but PR wasn't created → resume from SHIP
pnpm run resume -- JCP-XXXXX --from-step=7

# Execution failed → resume from EXECUTE (reuses existing cheatsheet, skips council)
pnpm run resume -- JCP-XXXXX --from-step=5

# Everything failed → start fresh
./clean.sh JCP-XXXXX && pnpm run single -- JCP-XXXXX
```

---

### Sentry CLI

```bash
cd ~/Documents/AI-Agent/sentry-alert

# Verify auth
node sentry-cli.mjs whoami

# List errors per service
node sentry-cli.mjs issues blitzkrieg
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal" --environment production

# Search
node sentry-cli.mjs search blitzkrieg --query "TypeError: Cannot read"

# Stack trace
node sentry-cli.mjs event <issue-id>

# Resolve / ignore
node sentry-cli.mjs resolve <issue-id>
node sentry-cli.mjs ignore <issue-id>
node sentry-cli.mjs comment <issue-id> "Fixing in JCP-XXXX"
```

---

### Jira CLI

```bash
cd ~/Documents/AI-Agent/jira-creator

# Create a JCP ticket (interactive fields + --jcp fills required JCP fields)
node jira-cli.mjs create --project JCP --type Bug \
  --summary "fix: what is broken" \
  --description "## Problem\n\nwhat broke\n\n## Fix\n\nwhat I did" \
  --jcp \
  --field "customfield_10016=8"   # dev story points (hours)
  --field "customfield_10075=4"   # QA story points (hours)
  --field "customfield_10444=12"  # total (dev + QA)

# View a ticket
node jira-cli.mjs view JCP-XXXXX

# Add a comment
node jira-cli.mjs comment add JCP-XXXXX "my comment here"

# Transition status (move ticket forward)
node jira-cli.mjs transition JCP-XXXXX "Dev Started"
node jira-cli.mjs transition JCP-XXXXX "Dev Testing"

# List available transitions for a ticket
node jira-cli.mjs transition JCP-XXXXX --list

# Add/remove labels
node jira-cli.mjs label add JCP-XXXXX nexus
node jira-cli.mjs label remove JCP-XXXXX nexus

# Search tickets
node jira-cli.mjs search --jql "assignee = currentUser() AND status = 'In Progress'"
```

---

### Azure DevOps PRs

```bash
# Create a PR (always source ~/.zshrc first so _ado_token function is available)
source ~/.zshrc
AZURE_DEVOPS_EXT_PAT=$(_ado_token) az repos pr create \
  --repository blitzkrieg \
  --source-branch bug/my-branch \
  --target-branch version/1.10.6 \
  --title "ID:JCP-XXXXX; fix: short title" \
  --description "## Summary\n\nWhat changed and why"

# List active PRs
AZURE_DEVOPS_EXT_PAT=$(_ado_token) az repos pr list \
  --repository blitzkrieg --status active

# View a specific PR
AZURE_DEVOPS_EXT_PAT=$(_ado_token) az repos pr show --id 238089
```

---

### Git — Blitzkrieg commit format

```bash
# Commit message MUST have: ID:JCP-XXXXX; <description>
git commit -m "ID:JCP-XXXXX; fix: what changed and why"

# Push new branch
git push origin bug/my-branch-name

# Push existing branch
git push
```

---

## Decision Guide — Which Scenario to Use?

```
Is the ticket clear and well-described?
  ├── YES → Add label "nexus" → done (Scenario 1)
  └── NO  → Write a better description first, then add label

Did NEXUS fail?
  ├── PR not created (Step 6/7 failed)
  │     └── pnpm run resume -- JCP-XXXXX --from-step=7
  ├── Code wrong but PR was created
  │     └── Edit code yourself → push → PR updates automatically
  ├── Execution failed (Step 5)
  │     └── pnpm run resume -- JCP-XXXXX --from-step=5
  └── Rate limit hit (Claude exhausted)
        └── Wait until 11:30 PM IST (limit resets) → then resume

Is it an emergency fix (no time to wait)?
  └── Use Claude Code directly (Scenario 3)
```

---

## Token Saving Settings (already configured in config.json)

| Setting | Value | Why |
|---------|-------|-----|
| `council.model` | `haiku` | 20× cheaper than Sonnet for planning |
| `council.maxRounds` | `2` | Was 3; saves ~4 Claude calls per run |
| `execute.model` | `haiku` | Code writing is cheap |
| `execute.maxTurns` | `20` | Was 30; plenty for most bugs |
| `prReviewCouncil.maxRounds` | `1` | PR review only needs one round |

**Claude daily limit resets at:** `11:30 PM IST`

If you hit the limit mid-run → wait for reset → `pnpm run resume -- JCP-XXXXX --from-step=<last-failed-step>`

---

## Watching a Run in Real Time

```
Terminal 1 — run the agent
  cd ~/Documents/AI-Agent/Dr.-Nexus && pnpm run single -- JCP-XXXXX

Terminal 2 — watch the log
  tail -f ~/Documents/AI-Agent/Dr.-Nexus/logs/$(date +%Y-%m-%d)/*.log

Terminal 3 — watch the cheatsheet being built (Step 4)
  watch -n 2 cat ~/Documents/AI-Agent/Dr.-Nexus/.pipeline-state/JCP-XXXXX/council/status.md
```

---

## Inject Guidance Mid-Council (Human-in-the-Loop)

If the council is planning something wrong, you can steer it without restarting:

```bash
# Drop this file while Step 4 is running — agent reads it in next round
echo "Focus on app/models/published_pages.model.js. The deletePage method needs findOneAndDelete not remove()." \
  > ~/Documents/AI-Agent/Dr.-Nexus/.pipeline-state/JCP-XXXXX/council/human-feedback.md
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| PR not created | Step 6 blocked on critical issue | `pnpm run resume -- JCP-XXXXX --from-step=7` |
| "garbage=true" in logs | Claude returned non-JSON (hit limit or crashed) | Wait for rate limit reset, then resume |
| "No changes to commit" | Agent made no file changes | Check cheatsheet: `.pipeline-state/JCP-XXXXX/cheatsheet.md` — was the plan correct? |
| Ticket not picked up by daemon | Missing label or wrong affected system | Check label is `nexus` and affected system is `blitzkrieg` or `skyfire` |
| ADO token error | `_ado_token` not loaded | Run `source ~/.zshrc` first |
| Broken imports warning in PR | Validator found a suspect reference | Check `.pipeline-state/JCP-XXXXX/run.errors.log` |
