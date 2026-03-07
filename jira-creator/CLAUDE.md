# Jira Ticket Creator - Configuration

This folder contains pre-cached Jira configuration to avoid repeated API calls when creating tickets.

## Development Workflow

**All changes to this repo MUST follow this workflow:**

1. **Always fork from `main`** — create a new feature branch from the `main` branch (`git checkout -b feature/xyz main`)
2. **Always raise a PR against `main`** — never push directly to `main`. Use `gh pr create --base main`
3. **After any change is merged**, update the global Jira CLI section in `~/.claude/CLAUDE.md` so the `/jira` skill and all Claude sessions stay in sync with the latest CLI capabilities

This ensures the project CLAUDE.md (checked into the repo) and the global CLAUDE.md (user-wide Claude instructions) never drift apart.

---

## Jira CLI (`jira-cli.mjs`)

**Preferred tool for all Jira operations.** A general-purpose CLI that handles ticket CRUD, comments, transitions, and the full JCP lifecycle.

```bash
node jira-cli.mjs <command> [options]
```

| Command | Description |
|---------|-------------|
| `create` | Create a new Jira ticket (any project) |
| `view` | View ticket details (formatted or `--json`) |
| `update` | Update ticket fields |
| `delete` | Delete a ticket |
| `transition` | Change ticket status (API-first, browser fallback) |
| `lifecycle` | Run full JCP lifecycle (To Do → Closed) |
| `comment` | Manage comments (add, list, edit, delete) |
| `search` | Search issues via JQL |
| `label` | Manage labels (add, remove, list) |
| `help` | Show help for a command |

### Quick Examples

```bash
# Create a JCP ticket with defaults
node jira-cli.mjs create --project JCP --type Task --summary "Fix login bug" --description "Details" --jcp

# Create a non-JCP ticket with custom fields
node jira-cli.mjs create --project ACM --type Bug --summary "Title" --description "Desc" --field 'customfield_10030={"value":"Production"}'

# View a ticket
node jira-cli.mjs view JCP-1234
node jira-cli.mjs view JCP-1234 --fields status,summary,assignee --json

# Update fields (--field is repeatable, supports JSON values)
node jira-cli.mjs update JCP-1234 --summary "New title" --priority Medium --field duedate=2026-03-01
node jira-cli.mjs update JCP-1234 --field story-points=8    # sets all 4 SP fields

# Transitions (API-first with automatic browser fallback)
node jira-cli.mjs transition JCP-1234 --list                # list available transitions
node jira-cli.mjs transition JCP-1234 "Dev Started" --field 'customfield_10055={"accountId":"..."}'

# Comments
node jira-cli.mjs comment add JCP-1234 "Work started"
node jira-cli.mjs comment list JCP-1234
node jira-cli.mjs comment edit JCP-1234 <comment-id> "Updated text"
node jira-cli.mjs comment delete JCP-1234 <comment-id>

# Full JCP lifecycle (13 steps: To Do → Closed)
node jira-cli.mjs lifecycle --dry-run                        # preview plan
node jira-cli.mjs lifecycle --ticket JCP-1234 --from-step 6  # resume from step
node jira-cli.mjs lifecycle --visible --slowmo 300           # debug browser steps

# Search issues via JQL
node jira-cli.mjs search --jql "project = JCP" --max-results 10
node jira-cli.mjs search "labels = auto-dev" --json
node jira-cli.mjs search --jql "assignee = currentUser()" --fields summary,status

# Labels (atomic add/remove, not replace)
node jira-cli.mjs label list JCP-1234
node jira-cli.mjs label list JCP-1234 --json
node jira-cli.mjs label add JCP-1234 auto-dev sprint-42
node jira-cli.mjs label remove JCP-1234 auto-dev

# Delete
node jira-cli.mjs delete JCP-1234 --yes
```

### `--field` Short Aliases

| Alias | Expands To |
|-------|-----------|
| `story-points=N` | Sets `customfield_10016=N`, `customfield_10026=N`, `customfield_10075=N`, `customfield_10444=N*2` |
| `duedate=YYYY-MM-DD` | Sets due date directly |
| Any `customfield_XXXXX=value` | Passes through directly (JSON values auto-parsed) |

### Transition Logic

1. Fetches available transitions via REST API
2. If the named transition exists, tries the API (`POST /rest/api/3/issue/{key}/transitions`)
3. If the API call fails (e.g., `hasScreen` with required attachments/validators), falls back to headless browser via `performTransition()` from `lib/transition.mjs`
4. If the transition name doesn't exist, exits with an error listing available transitions

### Architecture

- `jira-cli.mjs` — Main CLI entry point with all subcommand handlers
- `lib/api.mjs` — Shared REST helpers (`jiraGet`, `jiraPost`, `jiraPut`, `jiraDelete`), config loading
- `lib/markdown.mjs` — Markdown ↔ ADF conversion (see "Markdown Support" below)
- `lib/transition.mjs` — Browser-based transition logic (Playwright)
- `lib/auth.mjs` — Browser session management
- `lib/selectors.mjs` — Jira UI selector registry
- `lib/attachment.mjs` — Attachment file resolution

### Markdown Support (Descriptions & Comments)

All description and comment inputs now accept **Markdown** and convert to Jira's Atlassian Document Format (ADF). All ADF content from Jira is rendered back as Markdown when viewing.

**Input (Markdown → ADF):**

```bash
# Inline markdown in --description
node jira-cli.mjs create --project JCP --summary "Title" \
  --description "## Overview\n\n**Bold** and \`code\`" --jcp

# Read from a .md file (recommended for complex content)
node jira-cli.mjs create --project JCP --summary "Title" \
  --description-file ./ticket-description.md --jcp

# Update description from file
node jira-cli.mjs update JCP-1234 --description-file ./updated-desc.md

# Comments from file
node jira-cli.mjs comment add JCP-1234 --file ./analysis.md
node jira-cli.mjs comment edit JCP-1234 <id> --file ./updated.md

# Inline markdown in comments
node jira-cli.mjs comment add JCP-1234 "## Status\n\n- [x] Done\n- [ ] Pending"
```

**Output (ADF → Markdown):**

`view` and `comment list` now render rich ADF as readable Markdown in the terminal, preserving headings, tables, code blocks, lists, panels, etc.

**Supported Markdown features (input):**

| Feature | Syntax | ADF Node |
|---------|--------|----------|
| Headings | `## Heading` | `heading` (h1–h6) |
| Bold | `**text**` | mark: `strong` |
| Italic | `*text*` | mark: `em` |
| Strikethrough | `~~text~~` | mark: `strike` |
| Inline code | `` `code` `` | mark: `code` |
| Code blocks | ` ```lang ``` ` | `codeBlock` with language |
| Tables | `\| a \| b \|` | `table` / `tableHeader` / `tableCell` |
| Ordered lists | `1. item` | `orderedList` |
| Bullet lists | `- item` | `bulletList` |
| Nested lists | Indent with 2 spaces | Nested `listItem` |
| Horizontal rule | `---` | `rule` |
| Blockquote | `> text` | `blockquote` |
| Links | `[text](url)` | mark: `link` |
| Jira links | `[JCP-1234](https://...atlassian.net/browse/JCP-1234)` | `inlineCard` |
| Panels | `:::success` / `:::warning` / `:::info` blocks | `panel` |

**Panel syntax:**

```markdown
:::success
All tests passed!
:::

:::warning
Check the migration guide before upgrading.
:::
```

**Supported ADF features (output/view):**

All ADF node types used in real JCP tickets are rendered: `heading`, `paragraph`, `bulletList`, `orderedList`, `table`, `panel`, `codeBlock`, `rule`, `blockquote`, `inlineCard`, `emoji`, `expand`, `mediaSingle`, and all inline marks (`strong`, `em`, `code`, `strike`, `link`, `textColor`).

---

## Creating Tickets via REST API

Use curl with the API token stored in jira-config.json:

```bash
curl -s -X POST "https://gofynd.atlassian.net/rest/api/3/issue" \
  -H "Authorization: Basic $(echo -n 'EMAIL:API_TOKEN' | base64)" \
  -H "Content-Type: application/json" \
  -d '{ "fields": { ... } }'
```

The email and apiToken are stored in jira-config.json.

## IMPORTANT: When creating Jira tickets, DO NOT call these APIs:
- `getAccessibleAtlassianResources` - use cloudId from jira-config.json
- `getVisibleJiraProjects` - use projects.json or project-keys.json
- `getJiraProjectIssueTypesMetadata` - use projects.json (contains issue types per project)
- `atlassianUserInfo` - use user info from jira-config.json

## Files in this folder:

### jira-config.json
Contains:
- `cloudId`: "33aebbc3-0f9b-4e23-b19a-41a2ab7a2ecb" (use this for ALL Jira API calls)
- `siteUrl`: "https://gofynd.atlassian.net"
- `user.accountId`: For assigning tickets to self
- `commonIssueTypes`: Standard issue type IDs (Task, Story, Bug, Epic, Sub-task)

### projects.json
Full list of all accessible projects with their issue types. Each project has:
- `id`: Project ID
- `key`: Project key (e.g., "PLAT", "ACM")
- `name`: Project name
- `issueTypes`: Array of available issue types for that project

### project-keys.json
Simplified lookup: just project keys and names for quick reference.

## How to create a ticket:

1. Read jira-config.json for cloudId
2. If user specifies project key, look up issue types from projects.json
3. Call `createJiraIssue` directly with:
   - cloudId from jira-config.json
   - projectKey from user or projects.json
   - issueTypeName (Task, Story, Bug, etc.)
   - summary (title)
   - description (optional)
   - assignee_account_id from jira-config.json (if assigning to self)

## Example - Creating a Task:
```
cloudId: "33aebbc3-0f9b-4e23-b19a-41a2ab7a2ecb"
projectKey: "PLAT" (or whatever user specifies)
issueTypeName: "Task"
summary: "Your ticket title"
description: "Your description"
```

NO NEED to call discovery APIs - all info is cached here!

---

## JCP Project - Special Configuration

The JCP project has additional required fields. Use `jcp-fields.json` for all JCP ticket creation.

### Required Fields for JCP:
1. **components** - Use `components` array with `{"id": "..."}` format
2. **Environment** (customfield_12691) - Use `{"id": "..."}` format
3. **JCP Cluster** (customfield_11371) - Use `{"id": "..."}` format
4. **JCP Channel** (customfield_10455) - Use `{"id": "..."}` format

### Default Values (for code sync/merge tasks):
- Component: "JCP Merge Conflicts" (id: 12632)
- Environment: "Prod" (id: 18668)
- JCP Cluster: "All JCP Clusters" (id: 15761)
- JCP Channel: "All JCP Channels" (id: 18005)
- **Product Manager: Mahima Ramprasad** (accountId: 62b1a5dedcafd965c5ddca80) - ALWAYS use this

### Component Assignment (based on services):
| Services | Component | Component ID |
|----------|-----------|--------------|
| Convex | **CMS & TMS** | `12368` |
| Default (others) | JCP Merge Conflicts | `12632` |

### Engineering Lead Assignment (based on services):
| Services | Engineering Lead | Account ID |
|----------|-----------------|------------|
| Blitzkrieg, Skyfire, Jetfire, Scattershot (Themes) | **Harpreet Chawla** | `62b2c23a673f2103622e6675` |
| Convex, Highbrow | **Bipin Singh** | `62b1b064cebad33432f6d729` |

### Story Points Fields (ALWAYS fill all 4):
**Story points represent HOURS, not days.** 1 working day = 8 hours.

When creating JCP tickets, **ALWAYS** set all 4 story points fields together:
- `customfield_10016` - Story Points (Dev hours) - value varies based on effort
- `customfield_10026` - Alternate Story Points (MUST match customfield_10016)
- `customfield_10075` - QA Story Points (QA hours)
- `customfield_10444` - Total Story Points (sum of Dev + QA hours)

Pass all as numbers in `additional_fields`.

**Ask the user for story point values** — effort varies per task, do NOT assume defaults.

### Date Calculation Rules:
When calculating dates (due date, SIT date, QA dates, etc.) from story points:
- **1 story point = 1 hour of effort**
- **1 working day = 8 hours**
- **Working days = Monday to Friday only** (skip Saturday & Sunday)
- To convert story points to working days: `ceil(story_points / 8)`
- Then add that many **business days** from the start date, skipping weekends
- Example: 20 story points = ceil(20/8) = 3 working days. If start is Friday 2026-02-13, due date = Wednesday 2026-02-18 (skip Sat/Sun)

### All JCP Field IDs:

| Field | Field ID | Type | Notes |
|-------|----------|------|-------|
| Components | `components` | array | `[{"id": "..."}]` |
| Environment | `customfield_12691` | object | `{"id": "..."}` |
| JCP Cluster | `customfield_11371` | object | `{"id": "..."}` |
| JCP Channel | `customfield_10455` | object | `{"id": "..."}` |
| Affected Systems | `customfield_10056` | array | `[{"id": "..."}]` |
| Fix Versions | `fixVersions` | array | `[{"id": "..."}]` |
| Product Manager | `customfield_10261` | user | `{"accountId": "..."}` |
| Engineering Lead | `customfield_10055` | user | `{"accountId": "..."}` |
| Assigned Developer | `customfield_10091` | user | `{"accountId": "..."}` |
| Assigned QA | `customfield_10054` | user | `{"accountId": "..."}` |
| Start Date | `customfield_10015` | date | `"YYYY-MM-DD"` |
| QA Start Date | `customfield_10416` | date | `"YYYY-MM-DD"` |
| SIT Due Date | `customfield_12790` | date | `"YYYY-MM-DD"` |
| QA SIT Date | `customfield_12856` | date | `"YYYY-MM-DD"` |
| Story Points | `customfield_10016` | number | **ALWAYS set all 4 together** |
| Alternate Story Points | `customfield_10026` | number | **ALWAYS set all 4 together** |
| QA Story Points | `customfield_10075` | number | **ALWAYS set all 4 together** |
| Total Story Points | `customfield_10444` | number | **ALWAYS set all 4 together** (sum of dev + QA) |
| Due Date | `duedate` | date | `"YYYY-MM-DD"` |

### Common Affected Systems IDs:
- Blitzkrieg: `10262`
- convex: `10143`
- Highbrow: `10291`
- jetfire: `10083`
- Skyfire: `11125`
- Scattershot: `10315`

### Example - Creating a fully populated JCP Task:
```json
{
  "cloudId": "33aebbc3-0f9b-4e23-b19a-41a2ab7a2ecb",
  "projectKey": "JCP",
  "issueTypeName": "Task",
  "summary": "Your ticket title",
  "description": "Your description",
  "assignee_account_id": "6230430575f257006a997eca",
  "additional_fields": {
    "duedate": "2026-01-16",
    "components": [{"id": "12632"}],
    "customfield_12691": {"id": "18668"},
    "customfield_11371": {"id": "15761"},
    "customfield_10455": {"id": "18005"},
    "fixVersions": [{"id": "23623"}],
    "customfield_10056": [{"id": "10262"}, {"id": "10143"}],
    "customfield_10261": {"accountId": "6230430575f257006a997eca"},
    "customfield_10055": {"accountId": "6230430575f257006a997eca"},
    "customfield_10091": {"accountId": "6230430575f257006a997eca"},
    "customfield_10054": {"accountId": "6230430575f257006a997eca"},
    "customfield_10015": "2026-01-16",
    "customfield_10416": "2026-01-16",
    "customfield_12790": "2026-01-16",
    "customfield_12856": "2026-01-16",
    "customfield_10016": 3,
    "customfield_10026": 3,
    "customfield_10075": 3,
    "customfield_10444": 6
  }
}
```

See `jcp-fields.json` for all available component, environment, cluster, channel, and affected systems options.

---

## JCP Ticket Closing Workflow (Standard Journey)

This is the **standard 12-step workflow** used ~95% of the time to move a JCP ticket from **In-Progress** to **Closed**.

### Strategy: API First, Browser Fallback

- **Always try the REST API first** (`POST /rest/api/3/issue/{key}/transitions`)
- **Fall back to headless browser** (Playwright) only when the API is blocked (transitions with `hasScreen: true` requiring attachments or the "QC Report" validator)
- **Preferred:** Use `node jira-cli.mjs transition JCP-XXXX "Name"` — it handles API-first + browser fallback automatically
- Legacy: `node jira-transition.mjs` for direct browser-based transitions only

### The 12-Step Journey

| # | From Status | To Status | Transition Name | ID | Method | Required Fields / Notes |
|---|------------|-----------|----------------|----|--------|------------------------|
| 1 | In-Progress | Dev Verification | Dev Testing | 321 | **Browser** | Attachment required (random image from `~/Downloads/JIRA - SS/`) |
| 2 | Dev Verification | LEAD REVIEW | EM Review | 331 | API | None |
| 3 | LEAD REVIEW | SIT Deployment | Ready For SIT | 261 | API | None |
| 4 | SIT Deployment | SIT Verification To Do | Ready For SIT Testing | 3 | API | None |
| 5 | SIT Verification To Do | SIT Verification | SIT Testing In-Progress | 6 | API | `customfield_10417` (QA Due Date), `customfield_10054` (Assigned QA) |
| 6 | SIT Verification | UAT Deployment | Ready For UAT | 101 | **Browser** | "QC Report" validator - fill ADO Link + Comment |
| 7 | UAT Deployment | UAT Verification To Do | Ready For UAT Testing | 4 | API | None |
| 8 | UAT Verification To Do | UAT Verification | UAT Testing In-Progress | 7 | API | None |
| 9 | UAT Verification | Prod Deployment | Ready For Prod | 121 | **Browser** | "QC Report" validator - fill ADO Link + Comment |
| 10 | Prod Deployment | PROD Verification To Do | Ready For Prod Testing | 5 | API | None |
| 11 | PROD Verification To Do | Prod Verification | Prod Testing In-Progress | 8 | API | None |
| 12 | Prod Verification | Closed | Done | 141 | API | None |

### API Transition Example

```bash
# Read credentials from jira-config.json
EMAIL="email from jira-config.json"
API_TOKEN="apiToken from jira-config.json"
AUTH=$(echo -n "$EMAIL:$API_TOKEN" | base64)

# Simple transition (no fields required)
curl -s -X POST "https://gofynd.atlassian.net/rest/api/3/issue/JCP-XXXX/transitions" \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '{"transition": {"id": "331"}}'

# Transition with required fields (e.g., SIT Testing In-Progress)
curl -s -X POST "https://gofynd.atlassian.net/rest/api/3/issue/JCP-XXXX/transitions" \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "transition": {"id": "6"},
    "fields": {
      "customfield_10417": "2026-02-20",
      "customfield_10054": {"accountId": "ASSIGNED_QA_ACCOUNT_ID"}
    }
  }'
```

### Browser Transition Details

Three transitions require the headless browser:

1. **Dev Testing (id: 321)** - Transition screen requires an **attachment upload**
   - The browser clicks status button, selects "Dev Testing", uploads a random image from `~/Downloads/JIRA - SS/` via filechooser, and submits
   - Command: `node jira-transition.mjs JCP-XXXX "Dev Testing"`

2. **Ready For UAT (id: 101)** - "QC Report" validator blocks API
   - The browser fills two fields in the transition modal:
     - **ADO Link** (`#customfield_10361`): `https://gofynd.com/`
     - **Comment** (`#comment`): Any statement (e.g., "All verifications completed successfully. Proceeding to next stage.")
   - Then clicks submit
   - Command: `node jira-transition.mjs JCP-XXXX "Ready For UAT"`

3. **Ready For Prod (id: 121)** - Same "QC Report" validator as Ready For UAT
   - Same fields: ADO Link + Comment
   - Command: `node jira-transition.mjs JCP-XXXX "Ready For Prod"`

### Browser Tool Setup

```bash
# First-time setup: save login session (opens visible browser)
node jira-transition.mjs --setup

# Auth state is saved to .auth-state.json (gitignored)

# Inspect a ticket's DOM (for debugging selectors)
node jira-transition.mjs --inspect JCP-XXXX

# Run transition (headless by default)
node jira-transition.mjs JCP-XXXX "Dev Testing"
node jira-transition.mjs JCP-XXXX "Dev Testing" --visible --slowmo 500
```

### Key Gotchas

- **Dropdown timing**: The status dropdown sometimes doesn't open on first click in headless mode. The tool retries automatically.
- **Transition option text is multi-line**: Options appear as "Dev Testing\nDEV VERIFICATION". The tool matches by first line.
- **File upload uses filechooser**: Direct `setInputFiles()` on hidden inputs causes "missing token" errors. The tool clicks the "browse" link and intercepts the filechooser event instead.
- **Submit button is named after the transition**: The modal submit button says "Dev Testing" not "Submit". The tool uses `getByRole('button', { name: transitionName })`.
- **"QC Report" is actually Comment field**: The validator named "Please add QC Report" just checks that the Comment field is filled. No actual QC report document is needed.
- **Random images for attachments**: When no `--file` is provided, a random image from `/Users/vaibhavpratihar/Downloads/JIRA - SS/` is used.
