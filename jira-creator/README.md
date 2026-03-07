# Jira Creator - Claude Code Skill

A Claude Code custom skill (`/jira`) for creating and managing Jira tickets with pre-cached configuration, plus a general-purpose Jira CLI and a Playwright-based browser tool for transitions that require attachments or form submissions.

## What It Does

- **General-purpose Jira CLI** (`jira-cli.mjs`) — ticket CRUD, comments, transitions (API + browser fallback), and full JCP lifecycle automation, all from one command
- **Create Jira tickets** via REST API with all required fields pre-configured (no redundant API discovery calls)
- **Transition tickets** through workflows, using the API when possible and falling back to a headless browser (Playwright) for transitions blocked by validators or attachment requirements
- Works as a `/jira` slash command inside Claude Code

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- Node.js 18+
- A Jira Cloud instance with API access
- A Jira API token ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens))

## Setup

### 1. Clone and install

```bash
git clone <repo-url> ~/Desktop/jira-creator
cd ~/Desktop/jira-creator
npm install
```

This installs [Playwright](https://playwright.dev/) (used only for browser-based transitions). If you also need browser binaries:

```bash
npx playwright install chromium
```

### 2. Configure your Jira credentials

Create `jira-config.json` in the project root:

```json
{
  "cloudId": "YOUR_CLOUD_ID",
  "siteUrl": "https://yoursite.atlassian.net",
  "siteName": "yoursite",
  "user": {
    "accountId": "YOUR_ACCOUNT_ID",
    "email": "you@example.com",
    "name": "Your Name"
  },
  "apiToken": "YOUR_API_TOKEN",
  "commonIssueTypes": {
    "Task": "10002",
    "Story": "10001",
    "Bug": "10004",
    "Epic": "10000",
    "Sub-task": "10003"
  }
}
```

To find your `cloudId`, run:

```bash
curl -s -H "Authorization: Basic $(echo -n 'EMAIL:API_TOKEN' | base64)" \
  "https://yoursite.atlassian.net/_edge/tenant_info" | jq .cloudId
```

To find your `accountId`:

```bash
curl -s -H "Authorization: Basic $(echo -n 'EMAIL:API_TOKEN' | base64)" \
  "https://yoursite.atlassian.net/rest/api/3/myself" | jq .accountId
```

### 3. Cache project data

Fetch and save your accessible projects (avoids repeated API calls):

```bash
# Fetch all projects with issue types
curl -s -H "Authorization: Basic $(echo -n 'EMAIL:API_TOKEN' | base64)" \
  "https://yoursite.atlassian.net/rest/api/3/issue/createmeta?expand=projects.issuetypes" \
  -o projects.json

# Generate a simplified key-name lookup
cat projects.json | jq '[.projects[] | {key, name}]' > project-keys.json
```

If your project has custom required fields (like JCP does), create a `jcp-fields.json` or similar file documenting component IDs, custom field IDs, and allowed values. See the existing `jcp-fields.json` for the format.

### 4. Register the Claude Code skill

Create the slash command file at `~/.claude/commands/jira.md`:

```markdown
---
name: jira
description: Create and manage JIRA tickets with all required fields
---

You are helping create JIRA tickets.

## Instructions

Read the complete configuration from `<PATH_TO_REPO>/CLAUDE.md` for detailed instructions.

## Quick Reference

### Files to Read
- `<PATH_TO_REPO>/jira-config.json` - Credentials and user info
- `<PATH_TO_REPO>/projects.json` - All projects and issue types
- `<PATH_TO_REPO>/CLAUDE.md` - Full instructions

$ARGUMENTS
```

Replace `<PATH_TO_REPO>` with the absolute path to your clone (e.g. `/Users/you/Desktop/jira-creator`).

### 5. (Optional) Set up browser auth for transitions

If you need browser-based transitions (for screens requiring attachments or form validators):

```bash
node jira-transition.mjs --setup
```

This opens a Chromium window. Log into Jira manually. Once login is detected, session cookies are saved to `.auth-state.json` (gitignored).

## Usage

### Jira CLI (`jira-cli.mjs`)

The primary interface for all Jira operations:

```bash
# Help
node jira-cli.mjs help
node jira-cli.mjs help create

# Create tickets (any project)
node jira-cli.mjs create --project JCP --type Task --summary "Fix login bug" --description "Details" --jcp
node jira-cli.mjs create --project ACM --type Bug --summary "Title" --description "Desc" --field 'customfield_10030={"value":"Production"}'

# View tickets
node jira-cli.mjs view JCP-1234
node jira-cli.mjs view JCP-1234 --fields status,summary --json

# Update fields
node jira-cli.mjs update JCP-1234 --summary "New title" --field duedate=2026-03-01
node jira-cli.mjs update JCP-1234 --field story-points=8    # sets all 4 SP fields

# Transitions (API-first, auto browser fallback)
node jira-cli.mjs transition JCP-1234 --list
node jira-cli.mjs transition JCP-1234 "Dev Started"

# Comments
node jira-cli.mjs comment add JCP-1234 "Work started"
node jira-cli.mjs comment list JCP-1234
node jira-cli.mjs comment edit JCP-1234 <id> "Updated"
node jira-cli.mjs comment delete JCP-1234 <id>

# Full JCP lifecycle (To Do → Closed, 13 steps)
node jira-cli.mjs lifecycle --dry-run
node jira-cli.mjs lifecycle --ticket JCP-1234 --from-step 6

# Delete
node jira-cli.mjs delete JCP-1234 --yes
```

### Creating tickets (via `/jira` skill)

Inside Claude Code:

```
/jira Create a Task in PROJECT for "Fix login redirect bug"
```

Claude will read the cached config, populate all required fields, and create the ticket via the Jira REST API.

### Browser-based transitions (legacy)

For direct browser-only transitions (the CLI `transition` command handles this automatically):

```bash
# Perform a transition
node jira-transition.mjs JCP-1234 "Dev Testing"

# With a specific attachment
node jira-transition.mjs JCP-1234 "Dev Testing" --file ./screenshot.png

# Visible browser for debugging
node jira-transition.mjs JCP-1234 "Dev Testing" --visible --slowmo 500

# Inspect a ticket's DOM (selector discovery)
node jira-transition.mjs --inspect JCP-1234
```

## Project Structure

```
jira-creator/
├── CLAUDE.md              # Full instructions for Claude (field mappings, workflows, etc.)
├── jira-config.json       # Jira credentials and user info (DO NOT commit)
├── jcp-fields.json        # Custom field IDs and allowed values for JCP project
├── projects.json          # Cached project list with issue types
├── project-keys.json      # Simplified project key/name lookup
├── jira-cli.mjs           # General-purpose Jira CLI (create, view, update, delete, transition, lifecycle, comment)
├── jira-transition.mjs    # Legacy CLI for browser-based transitions only
├── jcp-lifecycle.mjs      # Legacy standalone JCP lifecycle runner
├── lib/
│   ├── api.mjs            # Shared Jira REST API helpers (jiraGet, jiraPost, jiraPut, jiraDelete)
│   ├── auth.mjs           # Browser login and session management
│   ├── transition.mjs     # Core transition logic (navigate, click, upload, submit)
│   ├── selectors.mjs      # Centralized Jira UI selector registry
│   └── attachment.mjs     # Attachment file resolution
└── package.json
```

## Customizing for Your Project

The `CLAUDE.md` file is where all the domain knowledge lives -- field mappings, required values, workflow steps, component assignments, etc. To adapt this for a different Jira project:

1. **Update `jira-config.json`** with your credentials
2. **Re-cache `projects.json`** for your accessible projects
3. **Edit `CLAUDE.md`** to document your project's:
   - Required custom fields and their IDs
   - Component/label mappings
   - Workflow transition IDs and steps
   - Default field values
   - Team member account IDs
4. **Update `~/.claude/commands/jira.md`** to reference your project-specific instructions

## Security Notes

- `jira-config.json` contains your API token -- keep it out of version control
- `.auth-state.json` contains browser session cookies -- already in `.gitignore`
- The API token has the same permissions as your Jira account
