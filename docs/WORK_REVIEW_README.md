# Work & review log — how to capture what you actually shipped

This file is a **living workbook**: use it before annual or mid-year reviews so you are not rebuilding a year from memory. Pair it with **Jira** (export) and honest notes on **impact** and **AI judgment** — not just ticket volume.

---

## Why this exists

- Reviews reward **clarity**: themes, outcomes, and tradeoffs — not a raw dump of keys.
- **Jira is incomplete**: it rarely shows mentoring, design reviews, incidents you owned off-ticket, or judgment calls. This doc captures what Jira misses.
- **AI-native competency** is about **when** to use tools, **how** to verify output, and **what** you learned when something failed.

---

## 1. Pull your work from Jira (facts layer)

Use the same stack as this repo: **`jira-creator/jira-cli.mjs`** with your `jira-config.json` (see `jira-creator/README.md`).

From the `jira-creator` directory:

```bash
mkdir -p review-data
cd jira-creator

# Issues assigned to you, touched in the last year (adjust project key). Redirect stderr so JSON stays valid.
node jira-cli.mjs search --jql \
  'project = JCP AND assignee = currentUser() AND updated >= -365d ORDER BY updated DESC' \
  --max-results 500 --fields summary,status,assignee,labels,priority,issuetype,project,components \
  --json 2>/dev/null > ../review-data/my-tickets-updated.json

# Resolved in a date range (Jira Cloud: use resolutiondate, unquoted dates often work best)
node jira-cli.mjs search --jql \
  'project = JCP AND assignee = currentUser() AND resolution != Unresolved AND resolutiondate >= 2025-03-29 ORDER BY resolutiondate DESC' \
  --max-results 500 --fields summary,status,assignee,labels,priority,issuetype,project,components \
  --json 2>/dev/null > ../review-data/my-tickets-resolved.json

# Tickets you filed or drove (fills gaps where you were not assignee)
node jira-cli.mjs search --jql \
  'project = JCP AND reporter = currentUser() AND created >= -365d ORDER BY created DESC' \
  --max-results 500 --fields summary,status,assignee,labels,priority,issuetype,project,components \
  --json 2>/dev/null > ../review-data/my-reported.json
```

### One command: full export + pie / bar charts + diagram

From the **repo root** (uses `jira-creator` credentials, **fetches all pages** of the “updated last 365d” query — not only the first 100):

```bash
node scripts/jira-review-dashboard.mjs
```

Outputs:

| Output | Purpose |
|--------|---------|
| `review-data/my-tickets-updated-full.json` | All matching issues merged (for your own analysis) |
| `review-data/jira-work-dashboard.html` | Open in a browser: doughnut charts by **issue type**, **status category**, **priority**, **component** (top 12), horizontal bar by **workflow status** (top 15), plus a **Mermaid** flow from total → status categories |

After you have `my-tickets-updated-full.json`, generate a **shareable evidence page** (charts + Mermaid pie + tables with **clickable Jira links**):

```bash
node scripts/jira-evidence-portfolio.mjs
```

| Output | Purpose |
|--------|---------|
| `review-data/work-evidence-portfolio.html` | **Modern interactive page** (Tailwind): sticky nav, animated stats, **AI-native** pillar cards, Chart.js doughnuts, collapsible Mermaid, **highlight cards** (Epics + Stories + Blockers), searchable table, **Save as PDF** (print stylesheet). Each key links to Jira. |

**Customize the AI-native section without editing code**

1. Copy `scripts/evidence-custom.example.json` → `review-data/evidence-custom.json`
2. Edit `headline`, `lede`, `pillars[]`, and optional `pinnedTickets` (e.g. `["JCP-663","JCP-9218"]`) so those keys appear first under Highlights
3. Run `node scripts/jira-evidence-portfolio.mjs` again

### Get a URL reviewers can open

The HTML is self-contained (CDN for Chart.js/Mermaid). `review-data/` stays gitignored, so you **upload the file** yourself:

1. **Confluence / Notion** — Attach `work-evidence-portfolio.html` or export a PDF from the browser (Print → Save as PDF) and attach (PDF is easiest for managers who block HTML).
2. **Google Drive** — Upload the HTML file; “Anyone with link” can open it, but **Chart/Mermaid may need “Open with browser”** — PDF is more reliable.
3. **Netlify Drop** — Go to [https://app.netlify.com/drop](https://app.netlify.com/drop), drag the **folder** that contains `work-evidence-portfolio.html` (rename to `index.html` if you want a clean path), get an instant `https://….netlify.app` link.
4. **tiiny.host** — Drag-and-drop single HTML; you get a short URL (good for pasting in review forms).

**Note:** Jira ticket links only work for people who can log in to your Atlassian site. The charts are evidence of **volume and mix**, not proof of business impact — pair with your written outcomes.

**Tips**

- Replace `JCP` with your real project key(s); use `project in (JCP, OTHER)` if needed.
- If `resolutiondate` returns no rows, your resolved work may fall outside the chosen window — widen the date or rely on the “updated” export + dashboard for “what I touched this year.”
- `review-data/` is gitignored by default so ticket titles stay off the remote.

---

## 2. Turn tickets into review language (one pass)

For each **candidate** ticket (not every ticket — prioritize below), add one short row:

| Ticket | One-line outcome | Business or user impact (even rough) | Your role (owner / pair / unblocker) |
|--------|------------------|--------------------------------------|--------------------------------------|
| EXAMPLE-123 | … | … | … |

**Prioritize**

1. Production reliability, incidents, SLOs, security, or compliance.
2. Cross-team or ambiguous work (coordination cost is real work).
3. Features or refactors tied to revenue, cost, or measurable latency.
4. Tooling, docs, or playbooks that **multiplied** the team (include names if comfortable).
5. Everything else — only if it shows breadth or growth.

---

## 3. Fill in — themes (what the year was *about*)

Write **3–5 themes** (not 20). Each theme gets evidence: tickets, docs, talks, or incidents.

| Theme (e.g. “Reliability for checkout”) | Why it mattered | Top 3–5 artifacts (Jira keys, doc links, PRs) |
|-------------------------------------------|-----------------|------------------------------------------------|
| | | |

---

## 4. Fill in — depth and judgment (staff+ signal)

Pick **2–4 situations** where the right answer was not obvious: constraints, tradeoffs, rollback plan, or pushback.

| Situation | Constraints | Decision | Outcome / learning |
|-----------|-------------|----------|----------------------|
| | | | |

---

## 5. AI-native competency (judgment, not buzzwords)

Document **specific** instances — your org cares that you can **evaluate** output, not that you used a tool.

| Where AI helped | Tool / workflow | What improved (speed, quality, exploration) | How you validated (tests, review, prod metrics) |
|-----------------|-----------------|---------------------------------------------|------------------------------------------------|
| | | | |

| What did **not** work or you avoided | What you learned | What you’d do next time |
|--------------------------------------|------------------|-------------------------|
| | | |

**Ideas that count here**

- Prompts, playbooks, or workflows you **shared** (e.g. team runbooks, `PLAYBOOK.md`, Dr.-Nexus / automation patterns).
- When you **stopped** using AI because context or risk was wrong.
- When model output was wrong and how you caught it before merge.

---

## 6. Collaboration and influence

Jira alone under-reports this. List bullets you can stand behind:

- Mentoring, pairing, or onboarding.
- Reviews that changed direction or caught serious issues.
- Alignment with PM, design, or stakeholders (meetings count when they unblock delivery).

| Who / area | What you did | Rough timeframe |
|------------|--------------|-----------------|
| | | |

---

## 7. Self-critical (required for growth narrative)

Honest gaps read stronger than an undefeated story.

| Miss | Root cause (no blame — systems, context, skill) | What changed or will change |
|------|-----------------------------------------------|-----------------------------|
| | | |

---

## 8. External evidence (optional but strong)

Check off what applies and add notes:

- [ ] CFR / quarterly notes / upward feedback themes
- [ ] Design docs or RFCs you authored or significantly shaped
- [ ] Org awards (e.g. Fynd Stars, annual award)
- [ ] Customer or internal shout-outs (Slack, email — summarize, don’t paste confidential text)

---

## 9. One-page summary for the form (paste last)

**Elevator (5–7 sentences):** themes, biggest impact, how you use AI responsibly, one growth area.

**Bullets for “key accomplishments” (5–8):** outcome-first, not task-first.

1.
2.
3.

**Looking ahead (2–4 sentences):** focus areas and how they help the team or product.

---

## Repo pointers

| Resource | Location |
|----------|----------|
| **Initiative + AI-native (fill-in for reviews)** | `INITIATIVE_AI_NATIVE.md` |
| Review workbook + Jira charts / portfolio | `WORK_REVIEW_README.md` |
| Daily automation & commands | `PLAYBOOK.md` |
| Jira CLI setup | `jira-creator/README.md` |
| NEXUS (Jira → agent → PR) | `Dr.-Nexus/README.md` |

---

*Update this file quarterly so review season is collation, not archaeology.*
