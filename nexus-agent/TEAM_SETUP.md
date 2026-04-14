# Dr. Nexus — Team Setup Guide

> One-time setup per person. After this, you can run `node src/index.js sentry-select` and the agent handles everything.

---

## What This Agent Does for You

```
You run one command  →  See all Sentry errors  →  Pick which ones to fix
       ↓
Agent debates the fix (multi-model council)
       ↓
Agent writes the code in your repo
       ↓
Agent raises an Azure DevOps PR
       ↓
Agent updates Jira + pings you on Slack
```

No manual coding. No manual PR. You just pick the error and review the PR.

---

## Prerequisites — Install These First

Run each command to verify. If something is missing, install it before continuing.

```bash
node --version        # Need 18 or higher
pnpm --version        # Install: npm install -g pnpm
git --version         # Should already be installed
az --version          # Azure CLI: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
claude --version      # Claude Code CLI: https://docs.anthropic.com/en/docs/claude-code
```

> **aisum** (optional but recommended — makes PR titles and Slack messages cleaner):
> Ask your team lead for the install instructions for your internal `aisum` tool.

---

## Step 1 — Get the Code

```bash
cd ~/Documents
git clone <ASK_YOUR_TEAM_LEAD_FOR_THE_REPO_URL> AI-Agent
cd AI-Agent/Dr.-Nexus
```

> The repo URL will be shared by your team lead along with this guide.

---

## Step 2 — Install Dependencies

```bash
# From inside Dr.-Nexus/
pnpm install

# Also install jira-creator dependencies (Dr. Nexus uses this internally)
cd ../jira-creator
npm install
npx playwright install chromium
cd ../Dr.-Nexus
```

---

## Step 3 — Create Your Config File

```bash
cp config.example.json config.json
```

Now open `config.json` and fill in the values below. Each section is explained.

---

### 3a — Jira credentials

```json
"jira": {
  "baseUrl": "https://YOUR-ORG.atlassian.net",
  "email": "YOUR_EMAIL@your-org.com",
  "apiToken": "YOUR_JIRA_API_TOKEN",
  "label": "nexus",
  "labelProcessed": "nexus-done",
  ...
}
```

**How to get your Jira API token:**
1. Go to: https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Name it `dr-nexus` and copy the token

---

### 3b — Azure DevOps credentials

```json
"azureDevOps": {
  "org": "https://dev.azure.com/YOUR_ORG",
  "project": "YOUR_ADO_PROJECT",
  "repoBaseUrl": "git@ssh.dev.azure.com:v3/YOUR_ORG/YOUR_PROJECT",
  "pat": "YOUR_AZURE_DEVOPS_PAT"
}
```

**How to get your Azure DevOps PAT:**
1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Create a new token with **Code (Read & Write)** + **Pull Request (Read & Write)** permissions
3. Copy and paste into `config.json`

---

### 3c — Sentry credentials

```json
"sentry": {
  "authToken": "YOUR_SENTRY_AUTH_TOKEN",
  "baseUrl": "https://sentry.your-org.com",
  "orgSlug": "your-org",
  "services": {
    "blitzkrieg": {
      "projectSlug": "blitzkrieg",
      "jiraProject": "JCP",
      "environments": ["production"],
      "minLevel": "error",
      "issueStatus": "unresolved",
      "limit": 25
    }
  }
}
```

**How to get your Sentry auth token:**
1. Log into Sentry → Settings → Auth Tokens
2. Create a token with **event:read** + **project:read** + **org:read** scopes
3. Paste into `config.json`

> Ask your team lead which services/projects to add under `"services"`. Copy the exact `projectSlug` values from Sentry.

---

### 3d — Slack (for notifications)

```json
"slack": {
  "botToken": "xoxb-ASK-YOUR-TEAM-LEAD",
  "userId": "YOUR_SLACK_USER_ID"
}
```

**How to get your Slack User ID:**
1. Open Slack → click your name → View Profile
2. Click the **⋮** (three dots) → Copy member ID
3. Paste as `userId`

> The `botToken` is shared — ask your team lead for it.

---

### 3e — Services (which repos the agent can work on)

```json
"services": {
  "blitzkrieg": { "repo": "blitzkrieg" },
  "convex":     { "repo": "convex" },
  "jetfire":    { "repo": "jetfire" }
}
```

Add only the services your team is responsible for. The repo name must match the Azure DevOps repository name exactly.

---

## Step 4 — Set Up Jira Creator

The agent uses `jira-creator` internally to create tickets. You need to configure it separately.

```bash
cd ../jira-creator
cp jira-config.json.example jira-config.json   # if example exists
# OR ask your team lead for the base jira-config.json and fill in your email + apiToken
```

Edit `jira-config.json`:
```json
{
  "cloudId": "YOUR-JIRA-CLOUD-ID",
  "siteUrl": "https://YOUR-ORG.atlassian.net",
  "siteName": "your-org",
  "user": {
    "accountId": "YOUR_JIRA_ACCOUNT_ID",
    "email": "YOUR_EMAIL@your-org.com",
    "name": "Your Name"
  },
  "apiToken": "YOUR_JIRA_API_TOKEN"
}
```

**How to get your Jira Account ID:**
```bash
curl -s -H "Authorization: Basic $(echo -n 'YOUR_EMAIL:YOUR_API_TOKEN' | base64)" \
  "https://YOUR-ORG.atlassian.net/rest/api/3/myself" | grep accountId
```

---

## Step 5 — Authenticate Azure CLI

```bash
# Login to Azure
az login

# Login to Azure DevOps specifically
az devops login --organization https://dev.azure.com/YOUR_ORG
# (paste your PAT when prompted)

# Verify it works
az repos pr list \
  --organization https://dev.azure.com/YOUR_ORG \
  --project YOUR_ADO_PROJECT \
  --repository blitzkrieg \
  --top 1 \
  --output table
```

If the last command shows a PR (or "No items found"), auth is working.

---

## Step 6 — Authenticate Claude CLI

```bash
claude --version   # verify installed
claude login       # follow the browser login flow
claude -p "say hello" --output-format text   # verify it works
```

---

## Step 7 — Verify SSH Access to Azure DevOps Repos

```bash
ssh -T git@ssh.dev.azure.com
# Should say: remote: Shell access is not supported.
# That response means SSH is working correctly.
```

If it fails, add your SSH public key to Azure DevOps:
1. Azure DevOps → User Settings → SSH Public Keys → Add

---

## Step 8 — Smoke Test

Run this from inside `Dr.-Nexus/`:

```bash
cd ~/Documents/AI-Agent/Dr.-Nexus

# See what Sentry errors exist
node src/index.js sentry-poll

# See what Jira tickets would be picked up
node src/index.js dry-run
```

If `sentry-poll` prints a list of errors (even if zero), your Sentry config is correct.  
If `dry-run` shows tickets or "No tickets found", your Jira config is correct.

---

## You're Ready. Here Are All the Commands.

```bash
# Go to the agent folder first (always)
cd ~/Documents/AI-Agent/Dr.-Nexus

# === SENTRY WORKFLOW (most common) ===

# Interactive: see errors, pick ones to fix, agent does the rest
node src/index.js sentry-select

# Just see what errors exist (no Jira creation)
node src/index.js sentry-poll

# Create a Jira ticket for one specific Sentry error ID
node src/index.js sentry-jira 135345

# === JIRA WORKFLOW ===

# Run agent on all Jira tickets with the 'nexus' label
pnpm start

# Run agent on one specific Jira ticket
node src/index.js single JCP-1234

# Preview what tickets would be processed (no execution)
node src/index.js dry-run

# === RECOVERY ===

# Resume a failed run from step 5 (re-use saved plan, skip council)
node src/index.js resume JCP-1234 --from-step=5

# Retry only PR creation (when code is pushed but PR failed)
node src/index.js create-pr JCP-1234

# === CLEANUP ===

# Clean up temp files for one ticket
./clean.sh JCP-1234

# Clean everything
./clean.sh
```

---

## How the Agent Works (Quick Mental Model)

```
Step 1  FETCH_TICKET       Read the Jira ticket
Step 2  VALIDATE_TICKET    Check required fields are set
Step 3  CLONE_REPO         Clone the service repo, create feature branch
Step 4  BUILD_CHEATSHEET   Council: AI agents debate the solution plan
Step 5  EXECUTE            Cheap AI model writes the code
Step 6  VALIDATE           Check the diff + PR review council
Step 7  SHIP               Commit, push, open Azure DevOps PR
Step 8  NOTIFY             Update Jira + Slack DM to you
```

If any step fails, the agent saves a checkpoint. You can resume from the failed step without starting over.

---

## Watching a Run in Progress

```bash
# Watch the live log
tail -f logs/$(date +%Y-%m-%d)/*.log

# Watch council debate status
watch -n 2 cat .pipeline-state/JCP-1234/council/status.md

# Steer the council mid-run (inject guidance)
echo "Focus on the null check in the auth middleware" \
  > .pipeline-state/JCP-1234/council/human-feedback.md
```

---

## Common Problems & Fixes

| Problem | Fix |
|---|---|
| `sentry-poll` returns 0 issues | Check `sentry.authToken` and `sentry.orgSlug` in config.json |
| `sentry-jira` fails | Check jira-creator is configured — run `cd ../jira-creator && node jira-cli.mjs help` |
| `single JCP-1234` fails at step 3 | SSH key not added to Azure DevOps — see Step 7 |
| PR creation fails (step 7) | Re-run `az devops login` and retry with `create-pr` |
| `claude` not found | Install Claude Code CLI: https://docs.anthropic.com/en/docs/claude-code |
| Config not loading | Make sure you're running commands from `Dr.-Nexus/` directory |
| Resume starts from step 1 | Wrong directory — run from `Dr.-Nexus/`, not the parent |

---

## Need Help?

- Check `.pipeline-state/JCP-XXXX/` — all logs and artifacts for every run are there
- Check `logs/YYYY-MM-DD/` for full run output
- Ask your team lead — share the contents of `.pipeline-state/JCP-XXXX/run.errors.log`
