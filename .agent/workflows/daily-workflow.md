---
description: Daily workflow for using Dr. Asthana to auto-generate PRs from JIRA tickets
---

# Dr. Asthana — Daily Workflow

## Quick Start (3 commands)

// turbo-all

### 1. Create a JIRA ticket with jira-cli

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

> **IMPORTANT**: `customfield_10056` (Affected Systems) is case-sensitive.
> Valid values: `Blitzkrieg`, `convex`, `Highbrow`, `jetfire`, `Skyfire`, `Scattershot`

### 2. Add the trigger label

```bash
node jira-cli.mjs label add JCP-XXXX dr-asthana
```

Replace `JCP-XXXX` with the ticket key from step 1.

### 3. Run Dr. Asthana

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Asthana
node src/index.js single JCP-XXXX
```

Wait ~5-30 minutes. You'll get a Slack DM with the PR link when done.

---

## Alternative Run Modes

### Dry run (see what tickets will be picked up, no changes)
```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Asthana
node src/index.js dry-run
```

### Daemon mode (auto-polls every 5 minutes)
```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Asthana
node src/index.js daemon
```

### Resume a failed run
```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Asthana
node src/index.js resume JCP-XXXX --from-step=5
```

---

## Monitor a Running Job

### Watch live logs
```bash
tail -f /Users/amargupta/Documents/AI-Agent/Dr.-Asthana/logs/$(date +%Y-%m-%d)/*.log
```

### Inject feedback during council debate (Step 4)
```bash
echo "Focus on X, ignore Y" > /Users/amargupta/Documents/AI-Agent/Dr.-Asthana/.pipeline-state/JCP-XXXX/council/human-feedback.md
```

### View what happened after a run
```bash
ls /Users/amargupta/Documents/AI-Agent/Dr.-Asthana/.pipeline-state/JCP-XXXX/
# council/       ← debate rounds
# cheatsheet.md  ← implementation plan
# state.json     ← checkpoint data
# ai-calls/      ← AI session logs
```

---

## jira-cli Quick Reference

### View a ticket
```bash
cd /Users/amargupta/Documents/AI-Agent/jira-creator
node jira-cli.mjs view JCP-XXXX
```

### Search tickets
```bash
node jira-cli.mjs search --jql "project = JCP AND labels = dr-asthana"
```

### Add/remove labels
```bash
node jira-cli.mjs label add JCP-XXXX dr-asthana
node jira-cli.mjs label remove JCP-XXXX dr-asthana
```

### Transition a ticket
```bash
node jira-cli.mjs transition JCP-XXXX --list          # see available transitions
node jira-cli.mjs transition JCP-XXXX "Dev Started"    # apply transition
```

### Add a comment
```bash
node jira-cli.mjs comment add JCP-XXXX "Work started"
```

### Full JCP lifecycle (To Do → Closed)
```bash
node jira-cli.mjs lifecycle --ticket JCP-XXXX --from-step 0
node jira-cli.mjs lifecycle --dry-run   # preview only
```

---

## Cleanup

```bash
cd /Users/amargupta/Documents/AI-Agent/Dr.-Asthana
./clean.sh JCP-XXXX    # clean specific ticket
./clean.sh             # clean everything
```

---

## Required JIRA Ticket Fields

| Field | Required? | Example | Notes |
|---|---|---|---|
| Summary | ✅ Yes | "Fix login redirect" | Clear title |
| Description | ✅ Yes | Detailed explanation | Main AI input |
| Affected Systems | ✅ Yes | `Blitzkrieg` | Must match config `services` key (case-insensitive) |
| Fix Version | ✅ Yes | `Fynd Platform v1.10.6` | Maps to branch `version/1.10.6` |
| Label | ✅ Yes | `dr-asthana` | Trigger label |
| Multiple Affected Systems | ❌ No | — | Split into separate tickets |
| Multiple Fix Versions | ❌ No | — | Split into separate tickets |

## Available Affected Systems (case-sensitive in JIRA API)

| Value | Service |
|---|---|
| `Blitzkrieg` | blitzkrieg repo |
| `convex` | convex repo |
| `Highbrow` | Highbrow repo |
| `jetfire` | jetfire repo |
| `Skyfire` | Skyfire repo |
| `Scattershot` | Scattershot repo |

> To add more services, edit `/Users/amargupta/Documents/AI-Agent/Dr.-Asthana/config.json` → `services` section.
