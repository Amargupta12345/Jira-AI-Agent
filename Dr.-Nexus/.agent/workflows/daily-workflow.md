# NEXUS — Daily Workflow

> **AI CONTEXT (read this first):** This document describes the full automated engineering pipeline at Fynd/JioCommerce. Three systems work together:
>
> 1. **Sentry** (`sentry-alert/`) — monitors production errors across services
> 2. **Jira** (`jira-creator/`) — tracks tickets that trigger the agent
> 3. **NEXUS** (`Dr.-Nexus/`) — reads Jira tickets → writes code → ships ADO PRs automatically
>
> The Sentry → Jira → NEXUS → ADO PR chain can run **fully automatically** (via daemons) or **manually** step by step. This document covers both paths.

---

## System Map

```
Production Error
      │
      ▼
  [ Sentry ]  ──────────────────────────────────────────────┐
  sentry-alert/                                             │
  sentry-cli.mjs          ← inspect errors manually        │ sentry-daemon
  mcp-server.mjs          ← Cursor AI can query Sentry      │ auto-creates Jira tickets
      │                                                     │
      ▼                                                     │
  [ Jira ]  ◄────────────────────────────────────────────── ┘
  jira-creator/
  jira-cli.mjs            ← create / label / transition tickets
      │
      │  label: nexus  (this is the trigger)
      ▼
  [ NEXUS ]
  Dr.-Nexus/
  src/index.js            ← polls Jira every 5 min, picks up labelled tickets
      │
      ├── Step 1-2: Fetch + validate ticket
      ├── Step 3:   Clone repo, create feature branch
      ├── Step 4:   AI Council debates → produces cheatsheet
      ├── Step 5:   AI executes cheatsheet (writes code)
      ├── Step 6:   Validate diff + PR review council
      ├── Step 7:   Commit, push, create ADO PR
      └── Step 8:   Jira comment + Slack DM with PR link
            │
            ▼
        [ ADO PR ]  →  you review and merge
```

---

## Path A — Sentry Alert → Auto Fix (fully automated)

> Use when: you want zero manual steps. Both daemons run continuously.

### Start the Sentry daemon (creates Jira tickets from new errors)
```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js sentry-daemon
```
This polls Sentry every 5 minutes across all configured services (blitzkrieg, skyfire, scattershot, mirage, jetfire). When a new unresolved error appears, it automatically creates a JCP Bug ticket labelled `nexus`.

### Start the NEXUS daemon (processes labelled tickets)
```bash
# In a separate terminal
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js daemon
```
NEXUS polls Jira every 5 minutes. When it sees a ticket with label `nexus`, it runs the full pipeline and creates an ADO PR.

### Result
- You get a **Slack DM** and a **Jira comment** with the PR link.
- The Sentry issue is linked in the Jira ticket description.
- Review the PR, approve, and merge.

---

## Path B — Sentry Alert → Manual Investigation → NEXUS Fix

> Use when: you want to inspect the error before creating a ticket.

### Step 1 — Investigate the Sentry error

```bash
cd /Users/amargupta/Documents/AI-Agent/sentry-alert

# List unresolved errors for blitzkrieg
node sentry-cli.mjs issues blitzkrieg

# List errors for other services
node sentry-cli.mjs issues skyfire
node sentry-cli.mjs issues jetfire

# Filter by severity
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal"
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved" --environment production

# Search for a specific error type
node sentry-cli.mjs search blitzkrieg --query "TypeError: Cannot read"

# View full details of a specific issue
node sentry-cli.mjs view <issue-id>

# Get the full stack trace for an issue
node sentry-cli.mjs event <issue-id>
```

### Step 2 — Create a JCP Jira ticket from the error

```bash
cd /Users/amargupta/Documents/AI-Agent/jira-creator

node jira-cli.mjs create \
  --project JCP \
  --type Bug \
  --summary "[Sentry] TypeError in blitzkrieg: Cannot read property 'x' of undefined" \
  --description "## Error\n\nSentry issue: https://sentry.tools.jiocommerce.io/issues/<id>/\n\n## Stack Trace\n\n(paste from sentry-cli.mjs event output)\n\n## Fix\n\nDescribe the expected fix here." \
  --jcp \
  --field 'fixVersions=[{"name":"Fynd Platform v1.10.7"}]' \
  --field 'customfield_10056=[{"value":"Blitzkrieg"}]'
```

### Step 3 — Add the trigger label

```bash
node jira-cli.mjs label add JCP-XXXX nexus
```

### Step 4 — Run NEXUS

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js single JCP-XXXX
```

Wait ~5–30 minutes. You'll get a Slack DM with the PR link.

### Step 5 — Mark Sentry issue resolved (after PR merges)

```bash
cd /Users/amargupta/Documents/AI-Agent/sentry-alert
node sentry-cli.mjs resolve <issue-id>
```

---

## Path C — Regular Jira Ticket → NEXUS Fix

> Use when: task comes from a Jira ticket (not Sentry). Same as before.

### Step 1 — Create the ticket
```bash
cd /Users/amargupta/Documents/AI-Agent/jira-creator

node jira-cli.mjs create \
  --project JCP \
  --type Task \
  --summary "Your task description here" \
  --description "Detailed description of what to implement" \
  --jcp \
  --field 'fixVersions=[{"name":"Fynd Platform v1.10.6"}]' \
  --field 'customfield_10056=[{"value":"Blitzkrieg"}]'
```

> **Affected Systems values (case-sensitive in API):** `Blitzkrieg`, `convex`, `Highbrow`, `jetfire`, `Skyfire`, `Scattershot`

### Step 2 — Add trigger label
```bash
node jira-cli.mjs label add JCP-XXXX nexus
```

### Step 3 — Run NEXUS
```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus
node src/index.js single JCP-XXXX
```

---

## NEXUS Run Modes

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus

# Process ONE ticket right now
node src/index.js single JCP-XXXX

# Daemon mode — polls Jira every 5 min automatically
node src/index.js daemon

# Poll Sentry once, create Jira tickets for new errors, then exit
node src/index.js sentry-poll

# Sentry daemon — continuously poll Sentry + create Jira tickets
node src/index.js sentry-daemon

# Dry run — parse tickets, print details, make zero changes
node src/index.js dry-run

# Resume a failed run from a specific step
node src/index.js resume JCP-XXXX --from-step=5
```

---

## Pipeline Steps Reference

| Step | Name | What happens | Resume if… |
|------|------|-------------|------------|
| 1 | FETCH_TICKET | Read Jira ticket + all comments | — |
| 2 | VALIDATE_TICKET | Check required fields (affectedSystems, fixVersion) | — |
| 2.5 | IN_PROGRESS | Transition Jira to In-Progress (non-blocking) | — |
| 3 | CLONE_REPO | Clone repo, create `feature/JCP-XXXX-…` branch | — |
| 4 | BUILD_CHEATSHEET | AI council debates strategy → produces plan | Plan was good but exec failed |
| 5 | EXECUTE | Cheap AI follows cheatsheet exactly, writes code | Code needs retry |
| 6 | VALIDATE | Diff check + PR review council | Validation blocked PR |
| 7 | SHIP | Commit, push, create ADO PR | PR wasn't created |
| 8 | NOTIFY | Jira comment + Slack DM + upload run artifact | — |

---

## Monitor a Running Job

```bash
# Watch live logs
tail -f /Users/amargupta/Documents/AI-Agent/Dr.-Nexus/logs/$(date +%Y-%m-%d)/*.log

# Watch the council status in real time (Step 4)
watch -n 2 cat /Users/amargupta/Documents/AI-Agent/Dr.-Nexus/.pipeline-state/JCP-XXXX/council/status.md

# Inject guidance mid-council (while Step 4 is running)
echo "Focus on app/models/page.model.js. The issue is in the deleteAvailablePage handler." \
  > /Users/amargupta/Documents/AI-Agent/Dr.-Nexus/.pipeline-state/JCP-XXXX/council/human-feedback.md

# Inspect artifacts after a run
ls /Users/amargupta/Documents/AI-Agent/Dr.-Nexus/.pipeline-state/JCP-XXXX/
# council/         ← debate rounds (proposal, critique, agreement)
# cheatsheet.md   ← implementation plan (edit this before resuming if needed)
# state.json      ← checkpoint (which steps completed)
# ai-calls/       ← full AI session logs with prompts
```

---

## Sentry CLI Quick Reference

```bash
cd /Users/amargupta/Documents/AI-Agent/sentry-alert

# Verify your auth token works
node sentry-cli.mjs whoami

# List all configured projects
node sentry-cli.mjs projects

# Unresolved issues (all services)
node sentry-cli.mjs issues blitzkrieg
node sentry-cli.mjs issues skyfire
node sentry-cli.mjs issues jetfire
node sentry-cli.mjs issues scattershot
node sentry-cli.mjs issues mirage

# Filter by level / environment
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal"
node sentry-cli.mjs issues blitzkrieg --environment production --limit 10

# Search with Sentry query syntax
node sentry-cli.mjs search blitzkrieg --query "TypeError"
node sentry-cli.mjs search blitzkrieg --query "is:unresolved !has:assignee"
node sentry-cli.mjs search blitzkrieg --query "release:1.2.3"

# Inspect an issue
node sentry-cli.mjs view <issue-id>           # summary + metadata
node sentry-cli.mjs event <issue-id>          # latest event + full stack trace
node sentry-cli.mjs events <issue-id>         # list all recent events

# Update an issue
node sentry-cli.mjs resolve <issue-id>        # mark resolved
node sentry-cli.mjs ignore <issue-id>         # mark ignored
node sentry-cli.mjs unresolve <issue-id>      # reopen
node sentry-cli.mjs comment <issue-id> "Investigating — related to JCP-XXXX"

# Raw JSON output (for scripting or AI)
node sentry-cli.mjs issues blitzkrieg --json
node sentry-cli.mjs event <issue-id> --json
```

---

## Jira CLI Quick Reference

```bash
cd /Users/amargupta/Documents/AI-Agent/jira-creator

# Create a JCP ticket (--jcp fills all required JCP fields automatically)
node jira-cli.mjs create \
  --project JCP --type Bug \
  --summary "fix: what is broken" \
  --description "## Problem\n\nwhat broke\n\n## Fix\n\nwhat to do" \
  --jcp \
  --field 'fixVersions=[{"name":"Fynd Platform v1.10.7"}]' \
  --field 'customfield_10056=[{"value":"Blitzkrieg"}]'

# View / search
node jira-cli.mjs view JCP-XXXX
node jira-cli.mjs search --jql "project = JCP AND labels = nexus"
node jira-cli.mjs search --jql "assignee = currentUser() AND status = 'In Progress'"

# Labels (trigger label is "nexus")
node jira-cli.mjs label add JCP-XXXX nexus
node jira-cli.mjs label remove JCP-XXXX nexus

# Transitions
node jira-cli.mjs transition JCP-XXXX --list            # see available transitions
node jira-cli.mjs transition JCP-XXXX "Dev Started"
node jira-cli.mjs transition JCP-XXXX "Dev Testing"

# Comments
node jira-cli.mjs comment add JCP-XXXX "Investigating"
node jira-cli.mjs comment list JCP-XXXX

# Full lifecycle (To Do → Closed, 12 steps)
node jira-cli.mjs lifecycle --ticket JCP-XXXX --from-step 0
node jira-cli.mjs lifecycle --dry-run
```

---

## Required Jira Ticket Fields

| Field | Required | Example | Notes |
|-------|----------|---------|-------|
| Summary | ✅ | "Fix: delete page should remove from published_pages" | One line, action + component |
| Description | ✅ | Detailed explanation | Main AI input — be specific |
| Affected Systems | ✅ | `Blitzkrieg` | Maps to repo in `config.json → services` |
| Fix Version | ✅ | `Fynd Platform v1.10.6` | Maps to branch `version/1.10.6` |
| Label | ✅ | `nexus` | This is the trigger — add last |
| Multiple Affected Systems | ❌ | — | Split into separate tickets |
| Multiple Fix Versions | ❌ | — | Split into separate tickets |

**Affected Systems values (case-sensitive in Jira API):**
`Blitzkrieg` · `convex` · `Highbrow` · `jetfire` · `Skyfire` · `Scattershot`

---

## Cleanup

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Nexus

./clean.sh JCP-XXXX    # remove cloned repo + pipeline state for one ticket
./clean.sh             # remove everything
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| PR not created | Step 6/7 failed | `node src/index.js resume JCP-XXXX --from-step=7` |
| Code wrong, PR exists | AI misunderstood plan | Edit files → push → PR auto-updates |
| Execution failed (Step 5) | AI hit a wall | `node src/index.js resume JCP-XXXX --from-step=5` |
| "No changes to commit" | AI wrote nothing | Check `cheatsheet.md` → was the plan correct? Edit it, then resume from step 5 |
| Ticket not picked up | Wrong label / missing fields | Label must be `nexus`; affectedSystems + fixVersion required |
| Rate limit hit | Claude daily quota | Wait until 11:30 PM IST → resume |
| ADO token error | `_ado_token` not loaded | `source ~/.zshrc` |
| Sentry "No issues found" | Wrong project slug | Run `node sentry-cli.mjs projects` to get exact slugs |
| Sentry 401 error | Bad auth token | Check `sentry-alert/sentry-config.json → authToken` |
| Sentry duplicate tickets | Same error re-processed | State file at `Dr.-Nexus/.sentry-state/processed.json` |

---

## Claude Context — How This System Works

> This section is written for Claude (and any AI reading this file) to deeply understand the system before making changes or answering questions.

### What each tool does

**`sentry-alert/sentry-cli.mjs`**
A CLI tool that wraps the Sentry REST API. Credentials live in `sentry-alert/sentry-config.json`. Commands: `issues`, `search`, `view`, `event`, `events`, `resolve`, `ignore`, `comment`, `projects`, `teams`, `whoami`. The `event` command returns a full stack trace with in-app frames highlighted. Use `--json` for machine-readable output.

**`sentry-alert/mcp-server.mjs`**
An MCP server (stdio transport) that exposes the same Sentry operations as tools Cursor AI can call directly. Registered in `~/.cursor/mcp.json`. Tools: `sentry_list_issues`, `sentry_get_latest_event`, `sentry_search_issues`, etc.

**`jira-creator/jira-cli.mjs`**
A CLI that wraps the Jira REST API. Credentials in `jira-creator/jira-config.json`. The key command for this workflow is `create --jcp` which automatically fills all JCP-required fields. The trigger that starts NEXUS is adding the label `nexus` to a ticket.

**`Dr.-Nexus/src/index.js`**
The main agent. Run modes: `daemon` (polls Jira), `single <KEY>` (one ticket), `sentry-daemon` (polls Sentry, creates Jira tickets), `sentry-poll` (one-shot Sentry check), `dry-run`, `resume <KEY> --from-step=N`.

### How NEXUS processes a ticket
1. Reads the Jira ticket (summary, description, all comments, affected systems, fix version)
2. Validates required fields — missing fields = skip
3. Clones the service repo (e.g. `blitzkrieg`), creates `feature/JCP-XXXX-…` branch
4. Runs an AI council: proposer drafts a plan, critics attack it, proposer responds AGREED/DISAGREE, evaluator scores it. Output = `cheatsheet.md`
5. A cheap AI (haiku) executes the cheatsheet exactly — no planning, just follow steps
6. Validates the diff: empty diff = critical failure; PR review council checks quality
7. Commits, pushes, creates ADO PR with cheatsheet summary in description
8. Posts Jira comment + Slack DM with PR URL

### How Sentry integrates
- `Dr.-Nexus/src/sentry/` polls Sentry REST API for unresolved issues per service
- Credentials: `sentry-alert/sentry-config.json` (shared by both CLI and Dr.-Nexus daemon)
- State: `Dr.-Nexus/.sentry-state/processed.json` — tracks which Sentry issue IDs have already been turned into Jira tickets (prevents duplicates across restarts)
- Each Sentry issue becomes a JCP Bug ticket with: full stack trace in description, steps to reproduce, label `sentry-alert`, `--jcp` defaults
- The ticket then has label `nexus` added so NEXUS picks it up

### Config files
| File | Purpose |
|------|---------|
| `Dr.-Nexus/config.json` | NEXUS runtime config (Jira, ADO, services, AI, Sentry) |
| `jira-creator/jira-config.json` | Jira credentials + user account ID |
| `jira-creator/jcp-fields.json` | JCP-specific field IDs + default values |
| `sentry-alert/sentry-config.json` | Sentry auth token + org slug + default project |

### Service → repo mapping
All live in `Dr.-Nexus/config.json → services`:
| Jira "Affected Systems" | Config key | Repo cloned |
|------------------------|------------|-------------|
| `Blitzkrieg` | `blitzkrieg` | `blitzkrieg` |
| `Skyfire` | `skyfire` | `skyfire` |
| `Scattershot` | `scattershot` | `scattershot` |
| `jetfire` | `jetfire` | `jetfire` |
| `mirage` | `mirage` | `mirage` |

### When asked to investigate a Sentry error, Claude should:
1. Call `sentry_list_issues` with the relevant project slug
2. Call `sentry_get_latest_event` on the most relevant issue to get the stack trace
3. Identify the failing file + line from in-app frames (marked `●`)
4. Summarise the root cause in plain English
5. Suggest the fix
6. Offer to create a JCP Jira ticket using `jira-cli.mjs create --jcp`
7. Offer to add label `nexus` so NEXUS auto-fixes it

### When asked to create a Jira ticket for a Sentry error, Claude should:
- Use `jira-cli.mjs create --project JCP --type Bug --jcp`
- Set `--field 'customfield_10056=[{"value":"<AffectedSystem>"}]'`
- Set `--field 'fixVersions=[{"name":"Fynd Platform v1.10.X"}]'`
- Include the Sentry URL, error title, and key stack frames in `--description`
- Pass `--field customfield_10034=<adf_json>` for Steps to Reproduce (required by JCP)
- After creation, add label `nexus`: `jira-cli.mjs label add JCP-XXXX nexus`
