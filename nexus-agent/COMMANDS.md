# Dr. Nexus — Quick Command Reference

> Always run from inside `Dr.-Nexus/` directory.

---

## Sentry Workflow (Most Common)

| Command | What it does |
|---|---|
| `node src/index.js sentry-select` | **Main command** — Poll Sentry, pick errors interactively, agent fixes them |
| `node src/index.js sentry-poll` | List all Sentry errors (no Jira, no fixing) |
| `node src/index.js sentry-jira 135345` | Create a Jira ticket for one specific Sentry issue ID |
| `node src/index.js sentry-daemon` | Continuously poll Sentry and print new errors (monitoring mode) |

---

## Multi-PR (Most Useful for Manual Work)

| Command | What it does |
|---|---|
| `node src/index.js multi-pr JCP-10669` | Read all fix versions from ticket → pick which → create PRs |
| `node src/index.js multi-pr JCP-10669 --branch feature/my-fix` | Specify source branch explicitly |
| `node src/index.js multi-pr JCP-10669 --repo blitzkrieg` | Specify repo name explicitly |

> Run from inside the service repo so the tool auto-detects your branch and repo name.

---

## Jira Workflow

| Command | What it does |
|---|---|
| `pnpm start` | Run daemon — picks up all Jira tickets labeled `nexus` |
| `node src/index.js single JCP-1234` | Process one specific Jira ticket end-to-end |
| `node src/index.js dry-run` | Preview what tickets would be processed (no changes made) |

---

## Recovery

| Command | What it does |
|---|---|
| `node src/index.js resume JCP-1234 --from-step=5` | Resume from execution step (reuses saved council plan) |
| `node src/index.js resume JCP-1234 --from-step=7` | Resume from ship step only (code already written) |
| `node src/index.js create-pr JCP-1234` | Retry PR creation only (code already pushed) |

---

## Monitoring a Live Run

```bash
# Watch logs live
tail -f logs/$(date +%Y-%m-%d)/*.log

# Watch council debate status
watch -n 2 cat .pipeline-state/JCP-1234/council/status.md

# Inject guidance mid-council
echo "Your feedback here" > .pipeline-state/JCP-1234/council/human-feedback.md
```

---

## Cleanup

```bash
./clean.sh JCP-1234   # clean one ticket's temp files
./clean.sh            # clean everything
```

---

## Step Numbers (for --from-step)

| Step | Name | Use resume here when... |
|---|---|---|
| 1 | FETCH_TICKET | Jira fetch failed |
| 2 | VALIDATE_TICKET | Ticket validation failed |
| 3 | CLONE_REPO | Clone / SSH failed |
| 4 | BUILD_CHEATSHEET | Council failed to converge |
| 5 | EXECUTE | Code execution failed (reuses saved plan) |
| 6 | VALIDATE_EXECUTION | Validation or PR review failed |
| 7 | SHIP | PR creation failed |
| 8 | NOTIFY | Jira/Slack notification failed |
