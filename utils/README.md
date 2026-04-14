# AI Metrics

Scans your Azure DevOps repos and produces a report of all AI-assisted work:
- Commits tagged with `made-with: cursor`
- Merged PRs authored by Claude, Codex, or Cursor (detected from PR description)

Output is a JSON file you can use as evidence for portfolio / leadership reviews.

---

## Prerequisites

- Node.js 18+
- An Azure DevOps Personal Access Token (PAT) with **Code (Read)** scope
  - Go to: `dev.azure.com → User Settings → Personal Access Tokens → New Token`
  - Scope: `Code → Read`

---

## Quick Start

### Scan one repo

```bash
AZURE_TOKEN=<your-PAT> AZURE_REPO=blitzkrieg node utils/ai-metrics.js
```

### Scan all repos from Dr.-Nexus config

```bash
AZURE_TOKEN=<your-PAT> node utils/ai-metrics.js
```

### Scan specific repos

```bash
AZURE_TOKEN=<your-PAT> SERVICES=blitzkrieg,skyfire node utils/ai-metrics.js
```

### Custom date range

```bash
AZURE_TOKEN=<your-PAT> \
  FROM_DATE=2025-01-01T00:00:00Z \
  TO_DATE=2026-03-31T00:00:00Z \
  node utils/ai-metrics.js
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AZURE_TOKEN` | ✅ Yes | — | Azure DevOps PAT (Code Read scope) |
| `AZURE_ORG` | No | `GoFynd` | Azure DevOps organisation name |
| `AZURE_PROJECT` | No | `FyndPlatformCore` | Azure DevOps project name |
| `AZURE_REPO` | No | — | Single repo to scan (e.g. `blitzkrieg`). If not set, reads from Dr.-Nexus config |
| `SERVICES` | No | `all` | Comma-separated service keys from Dr.-Nexus config (e.g. `blitzkrieg,skyfire`), or `all` |
| `FROM_DATE` | No | `2025-01-01T00:00:00Z` | Start of date range (ISO 8601) |
| `TO_DATE` | No | today | End of date range (ISO 8601) |
| `OUT_JSON` | No | `review-data/ai-metrics.json` | Output path for single-repo JSON |
| `OUT_JSON_ALL` | No | `review-data/ai-metrics-all.json` | Output path for combined JSON (all repos) |
| `SERVICES_CONFIG` | No | `Dr.-Nexus/config.json` | Path to Dr.-Nexus config to read repo list |

---

## Output

The script prints a summary table and writes two JSON files:

```
╔══════════════════════════════════════╗
║          AI METRICS SUMMARY          ║
╠══════════════════════════════════════╣
║  Commits via Cursor    :   47        ║
║  Merged PRs with AI    :  112        ║
╚══════════════════════════════════════╝

🧾 Wrote JSON evidence: review-data/ai-metrics.json
🧾 Wrote combined JSON evidence: review-data/ai-metrics-all.json
```

### JSON structure (`ai-metrics-all.json`)

```json
{
  "meta": { "org", "project", "fromDate", "toDate", "generatedAt", "repos" },
  "summary": {
    "cursorCommits": 47,
    "mergedAiPrs": 112
  },
  "repos": [
    {
      "meta": { "repo": "blitzkrieg", ... },
      "summary": { "cursorCommits": 23, "mergedAiPrs": 61 },
      "breakdown": {
        "byAuthor": { "Amar Gupta": 23 },
        "byTool":   { "Claude": 45, "Cursor": 16, "Codex": 0 }
      },
      "samples": {
        "cursorCommits": [ { "commitId", "author", "date", "message" }, ... ],
        "mergedAiPrs":   [ { "prId", "title", "author", "mergedOn", "aiTool" }, ... ]
      }
    }
  ]
}
```

---

## How AI Detection Works

**Cursor commits** — the script looks for the string `made-with: cursor` (case-insensitive) in the full commit message body.

**AI-assisted PRs** — the PR description or merge commit message must contain one of:

| Pattern | Detected as |
|---|---|
| `made-with: cursor` | Cursor |
| `Co-Authored-By: ... cursor` | Cursor |
| `Generated with [Claude` | Claude |
| `Co-Authored-By: ... Claude` | Claude |
| `codex`, `openai`, `gpt-4`, `o3`, `o4` | Codex |

Claude Code automatically adds `Co-Authored-By: Claude ...` to PRs it creates, so all Nexus-generated PRs are detected automatically.

---

## Example: Scan all repos for Q1 2026

```bash
cd ~/Documents/AI-Agent

AZURE_TOKEN=<your-PAT> \
  FROM_DATE=2026-01-01T00:00:00Z \
  TO_DATE=2026-03-31T23:59:59Z \
  node utils/ai-metrics.js
```

Results will be in `review-data/ai-metrics-all.json`.

---

## ai-impact.example.json

`scripts/ai-impact.example.json` is a separate template for manually recording before/after impact metrics (resolution time, delivery cycle, PR rework rounds, regression rate). Fill it in with your real numbers and use it alongside the automated scan output for a complete AI impact portfolio.
