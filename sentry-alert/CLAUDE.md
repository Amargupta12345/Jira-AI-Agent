# sentry-alert — Context for AI Agents

This package is a **Sentry CLI + local MCP server** for the JCP organisation on a self-hosted Sentry instance.
It gives every AI session (Cursor, Claude Code, etc.) direct access to Sentry issues, events, and stack traces — either through the command line or through MCP tool calls injected automatically into the model context.

---

## Directory Structure

```
sentry-alert/
├── sentry-cli.mjs        → CLI entry point — all commands (projects, issues, view, event, jira …)
├── mcp-server.mjs        → Local MCP server (stdio transport, registered in ~/.cursor/mcp.json)
├── sentry-config.json    → Credentials + org config (authToken, baseUrl, orgSlug, defaultProject)
└── lib/
    ├── api.mjs           → Sentry REST helpers (sentryGet, sentryGetList, sentryPost, sentryPut, sentryDelete)
    └── format.mjs        → Human-readable output formatters (tables, stack traces, issue blocks)
```

---

## Configuration (`sentry-config.json`)

```json
{
  "authToken": "sntryu_...",
  "baseUrl":   "https://sentry.tools.jiocommerce.io",
  "orgSlug":   "jcp",
  "defaultProject": "blitzkrieg"
}
```

- **`authToken`** — Bearer token for all API calls (`Authorization: Bearer <token>`).
- **`baseUrl`** — Self-hosted Sentry instance. TLS verification is deliberately disabled (`NODE_TLS_REJECT_UNAUTHORIZED=0`) because this instance uses an internal corporate certificate.
- **`orgSlug`** — Organisation slug used in every API path (`/organizations/jcp/…`).
- **`defaultProject`** — Used when no `--project` / `projectSlug` argument is given.

---

## CLI (`sentry-cli.mjs`)

Run from the package root:

```bash
node sentry-cli.mjs <command> [options]
```

### Command Reference

| Command | Signature | Description |
|---------|-----------|-------------|
| `projects` | `projects [--json]` | List all projects in the org |
| `issues` / `ls` | `issues <project> [--query "…"] [--environment prod] [--limit N] [--all] [--json]` | List issues (default: `is:unresolved`, sorted by date) |
| `view` | `view <issue-id> [--json]` | Full issue details + live tags from latest event |
| `events` | `events <issue-id> [--limit N] [--json]` | List all events for an issue |
| `event` / `latest-event` | `event <issue-id> [--json]` | Latest event with full stack trace + breadcrumbs |
| `resolve` | `resolve <issue-id>` | Mark issue as resolved |
| `unresolve` | `unresolve <issue-id>` | Mark issue as unresolved |
| `ignore` | `ignore <issue-id>` | Mark issue as ignored |
| `comment` | `comment <issue-id> "text"` or `--text "…"` | Add a comment/note to an issue |
| `search` | `search <project> --query "…" [--environment prod] [--limit N] [--json]` | Search with Sentry query syntax |
| `jira` | `jira <issue-id> [--project JCP] [--type Bug] [--affected-system-id id] [--fix-version-id id]` | Create a Jira ticket from a Sentry issue |
| `teams` | `teams [--json]` | List all teams in the org |
| `whoami` / `auth` | `whoami` | Verify auth token, show user + org info |
| `help` | `help [command]` | Show help (issues, search, event have detailed help) |

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--json` | boolean | Output raw JSON instead of formatted text |
| `--query "…"` | string | Sentry search query (default: `is:unresolved`) |
| `--environment "…"` | string | Filter by environment (e.g. `production`, `staging`) |
| `--limit N` | number | Maximum results (default: 25) |
| `--all` | boolean | Include all statuses, not just unresolved |
| `--project KEY` | string | Explicit project slug (overrides positional arg) |
| `--text "…"` | string | Comment text (alternative to positional arg for `comment`) |
| `--type BugType` | string | Jira issue type (default: `Bug`) |
| `--affected-system-id ID` | string | Override auto-detected Jira Affected Systems field ID |
| `--fix-version-id ID` | string | Override auto-detected Jira fix version ID |

### Sentry Search Query Syntax

```
is:unresolved                          Unresolved issues only
is:unresolved level:fatal              Fatal errors only
is:unresolved !has:assignee            Unassigned issues
release:1.2.3                          Issues in a specific release
transaction:/api/v1/users              Issues in a specific transaction
user.email:user@example.com            Issues affecting a specific user
assigned:me                            Issues assigned to me
firstSeen:>2026-01-01                  First seen after a date
```

### Quick Examples

```bash
# Browse
node sentry-cli.mjs projects
node sentry-cli.mjs issues blitzkrieg
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal" --limit 10
node sentry-cli.mjs issues blitzkrieg --environment production

# Inspect
node sentry-cli.mjs view 123456789
node sentry-cli.mjs event 123456789          # full stack trace + breadcrumbs
node sentry-cli.mjs events 123456789 --limit 5

# Search
node sentry-cli.mjs search blitzkrieg --query "TypeError" --environment production
node sentry-cli.mjs search blitzkrieg --query "is:unresolved level:error release:v1.2.3"

# Take action
node sentry-cli.mjs resolve 123456789
node sentry-cli.mjs ignore 123456789
node sentry-cli.mjs comment 123456789 "Investigating — related to deploy v1.2.3"

# Create a Jira ticket from a Sentry issue
node sentry-cli.mjs jira 123456789
node sentry-cli.mjs jira 123456789 --project JCP --type Bug

# Auth check
node sentry-cli.mjs whoami
```

---

## MCP Server (`mcp-server.mjs`)

A local MCP server using **stdin/stdout (stdio) transport**. Cursor AI calls these tools automatically when they are relevant — no manual CLI invocations needed.

### Registration in `~/.cursor/mcp.json`

```json
{
  "sentry": {
    "command": "node",
    "args": ["/Users/amargupta/Documents/AI-Agent/sentry-alert/mcp-server.mjs"]
  }
}
```

### MCP Tools

| Tool | Required Args | Optional Args | Description |
|------|--------------|---------------|-------------|
| `sentry_list_projects` | — | `json` | List all projects in the org |
| `sentry_list_issues` | — | `projectSlug`, `query`, `environment`, `limit`, `json` | List unresolved issues |
| `sentry_search_issues` | `query` | `projectSlug`, `environment`, `limit`, `json` | Search with Sentry query syntax |
| `sentry_get_issue` | `issueId` | `json` | Full issue details |
| `sentry_get_latest_event` | `issueId` | `json` | Latest event + stack trace + breadcrumbs |
| `sentry_list_events` | `issueId` | `limit`, `json` | List events for an issue |
| `sentry_resolve_issue` | `issueId` | — | Mark issue resolved |
| `sentry_ignore_issue` | `issueId` | — | Mark issue ignored |
| `sentry_unresolve_issue` | `issueId` | — | Mark issue unresolved |
| `sentry_add_comment` | `issueId`, `text` | — | Add a comment to an issue |
| `sentry_list_teams` | — | `json` | List all teams in org |

### Protocol

- JSON-RPC 2.0 over stdio.
- Implements: `initialize`, `tools/list`, `tools/call`, `ping`.
- Tool errors are returned as `content` text (not protocol errors) so Cursor displays them inline.
- Notifications (no `id`) are silently ignored.
- Server info: `{ name: "sentry-alert", version: "1.0.0" }`.

---

## API Library (`lib/api.mjs`)

All Sentry REST calls go through these helpers. They all throw on non-OK responses.

| Export | Signature | Description |
|--------|-----------|-------------|
| `config` | object | Parsed `sentry-config.json` |
| `ORG_SLUG` | string | `config.orgSlug` |
| `DEFAULT_PROJECT` | string\|null | `config.defaultProject` |
| `SENTRY_BASE` | string | Base URL without trailing slash |
| `AUTH_HEADER` | string | `"Bearer <authToken>"` |
| `sentryGet(path, params?)` | async | GET `/api/0<path>` — returns parsed JSON |
| `sentryGetList(path, params?)` | async | Like `sentryGet` but always returns an array; handles bare arrays, `{ data }`, `{ issues }`, `{ results }` shapes from different Sentry versions |
| `sentryPost(path, body?)` | async | POST with JSON body |
| `sentryPut(path, body?)` | async | PUT with JSON body |
| `sentryDelete(path)` | async | DELETE |

All paths are relative to `/api/0` — for example `/issues/123456789/` or `/organizations/jcp/projects/`.

---

## Format Library (`lib/format.mjs`)

Pure formatting functions — no API calls.

| Export | Input | Output |
|--------|-------|--------|
| `formatIssue(issue)` | Sentry issue object | Detailed single-issue block (status, level, culprit, tags, URL) |
| `formatIssueTable(issues[])` | Array of issues | Compact table: ID, level, status, last seen, count, title |
| `formatProjectTable(projects[])` | Array of projects | Table: slug, name, platform |
| `formatEventTable(events[])` | Array of events | Table: event ID, date, message |
| `formatStackTrace(event)` | Sentry event object | Full stack trace — exception type/value, frames with `●`/`○` in-app markers, context lines, last 10 breadcrumbs |
| `formatTeamTable(teams[])` | Array of teams | Table: slug, name |

---

## Jira Integration (`jira` command / `handleJira`)

The `jira <issue-id>` command creates a fully populated JCP Jira Bug ticket from a Sentry issue. Here is the full flow:

### Step 1 — Fetch Sentry data
- Calls `GET /issues/<id>/` for issue metadata.
- Calls `GET /issues/<id>/events/latest/` for the full event with stack trace and tags.

### Step 2 — Auto-detect Affected Systems
Maps the Sentry project slug to a Jira `customfield_10056` ID:

| Sentry Project | Jira Affected System | ID |
|---------------|----------------------|----|
| `blitzkrieg` | Blitzkrieg | `10262` |
| `convex` | convex | `10143` |
| `highbrow` | Highbrow | `10291` |
| `jetfire` | jetfire | `10083` |
| `skyfire` | Skyfire | `11125` |
| `scattershot` | Scattershot | `10315` |

Override with `--affected-system-id <id>` if the project is not in the map.

### Step 3 — Auto-select Fix Version
- Reads `jira-config.json` from `JIRA_CLI_DIR` (default: `../jira-creator`).
- Fetches unreleased fix versions for the Jira project via `GET /rest/api/3/project/<project>/versions?status=unreleased`.
- Picks the best version by matching the Sentry `platform_version` tag (e.g. `v1.10.6-RC228`) against available versions: tries next patch → next minor → falls back to the newest unreleased version.
- Override with `--fix-version-id <id>`.

### Step 4 — Build Jira description (Markdown)
The description is a Markdown document containing:
- A summary table (service, project, environment, level, first/last seen, times seen, Sentry URL).
- Error details (title, culprit, release, platform version).
- Stack trace from the latest event (last 2 exceptions, innermost 15 frames each).
- Resolution notes with the environment name embedded.

### Step 5 — Create ticket via `jira-cli.mjs`
Spawns `node jira-cli.mjs create …` inside `JIRA_CLI_DIR`. Arguments built:
- `--project JCP --type Bug`
- `--summary "[Sentry][<service>] <issue title>"` (capped at 200 chars)
- `--description-file <tmp.md>` (temp file cleaned up after)
- `--labels sentry-alert`
- `--jcp` (adds JCP-specific fields)
- `--field customfield_10034=<steps-to-reproduce ADF JSON>`
- `--field customfield_10056=[{"id":"<affectedSystemId>"}]` (if resolved)
- `--field fixVersions=[{"id":"<fixVersionId>"}]` (if resolved)

The temp description file is always deleted in a `finally` block.

---

## Known Projects

The default project is `blitzkrieg`. Other known projects in the org:

- `blitzkrieg`
- `convex`
- `highbrow`
- `jetfire`
- `skyfire`
- `scattershot`

Run `node sentry-cli.mjs projects` to get the current full list.

---

## Common Workflows

### Investigate a fatal alert

```bash
# 1. Find the latest fatal issues
node sentry-cli.mjs issues blitzkrieg --query "is:unresolved level:fatal" --limit 5

# 2. Get full stack trace for the top issue
node sentry-cli.mjs event <issue-id>

# 3. See all recent occurrences
node sentry-cli.mjs events <issue-id> --limit 10
```

### Triage and ticket creation

```bash
# 1. View issue details
node sentry-cli.mjs view <issue-id>

# 2. Create a Jira ticket
node sentry-cli.mjs jira <issue-id>

# 3. Comment on the Sentry issue
node sentry-cli.mjs comment <issue-id> "JCP-1234 created — investigation in progress"
```

### Resolve after fix

```bash
node sentry-cli.mjs resolve <issue-id>
node sentry-cli.mjs comment <issue-id> "Fixed in v1.2.4 — deployed to production"
```

---

## Adding a New Command

1. Add a handler function `handleMyCommand({ flags, positional })` in `sentry-cli.mjs`.
2. Add a `case 'my-command':` branch in the `main()` switch.
3. Add an entry to the general help block inside `showHelp()`.
4. If it should also be available via MCP, add a tool descriptor to the `TOOLS` array in `mcp-server.mjs` and a `case 'sentry_my_command':` branch in `callTool()`.

---

## Adding a New Project → Affected Systems Mapping

Edit the `AFFECTED_SYSTEMS_MAP` object in `sentry-cli.mjs`:

```js
const AFFECTED_SYSTEMS_MAP = {
  // existing entries …
  'new-project-slug': { id: '<jira-customfield-id>', name: 'Display Name' },
};
```

The Jira Affected Systems option IDs can be found in `jira-creator/jcp-fields.json`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JIRA_CLI_DIR` | `../jira-creator` (relative to `sentry-alert/`) | Path to the `jira-creator` directory for Jira integration |

---

## Dependencies

No `node_modules` — the package uses only Node.js built-ins:
- `node:fs/promises`, `node:fs` — file I/O
- `node:os` — `tmpdir()` for temp files during `jira` command
- `node:path`, `node:url` — path resolution
- `node:child_process` — `spawn` for `jira-cli.mjs`
- `node:readline` — MCP stdio loop

Node.js built-in `fetch` (Node ≥ 18) is used for all HTTP calls. No `axios`, no `node-fetch`.

---

## Rules

1. **No `node_modules`** — keep the package dependency-free. Use only Node.js built-ins and native `fetch`.
2. **`sentry-config.json` is the single source of truth** — never hard-code credentials or org slugs in source files.
3. **All Sentry API calls must go through `lib/api.mjs`** — do not call `fetch` directly in `sentry-cli.mjs` or `mcp-server.mjs`.
4. **MCP tools must mirror CLI commands** — every action available in the CLI should eventually be available as an MCP tool (and vice versa).
5. **Format functions are pure** — `lib/format.mjs` must never import from `lib/api.mjs`.
6. **TLS is intentionally disabled** — `NODE_TLS_REJECT_UNAUTHORIZED=0` is set in `lib/api.mjs` for the self-hosted Sentry instance. Do not remove it.
7. **Temp files for Jira descriptions** are always cleaned up in a `finally` block — never leave them behind.
