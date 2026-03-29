# Initiative & AI-native impact — fill-in (this repo)

Use this document for **performance review “Initiative”** and **AI-native competency** write-ups. It maps **what exists in this codebase** to language you can paste and personalize.

---

## 1. What this project already is (facts you can claim if you built or own it)

These are the **automation pillars** documented in-repo. Replace with your real contribution (built, extended, operated, or documented).

| Area | What it does | Where it lives |
|------|----------------|----------------|
| **NEXUS (Dr.-Nexus)** | Jira-labeled work → multi-agent **council** (plan) → executor → **validation + PR review council** → **Azure DevOps PR** → Jira + Slack — end-to-end autonomous dev loop | `Dr.-Nexus/` |
| **Sentry → Jira → agent** | Production issues can be listed, turned into JCP tickets, then picked up by NEXUS with service mapping | `Dr.-Nexus/src/sentry/`, runbook in `Dr.-Nexus/AUTOMATION_RUNBOOK.md` |
| **Jira CLI** | Ticket creation, transitions, comments, search/JQL — reduces manual Jira UI work | `jira-creator/jira-cli.mjs` |
| **Sentry tooling** | CLI + MCP-style workflows for issues/events | `sentry-alert/` |
| **Playbook** | Single reference for daily automation: flows, commands, when to use what | `PLAYBOOK.md` |
| **Agent workflows** | Daily workflow docs for agents | `.agent/workflows/`, `Dr.-Nexus/.agent/workflows/` |
| **Review evidence** | Jira export → charts + **interactive HTML portfolio** + optional PDF for reviews | `scripts/jira-review-dashboard.mjs`, `scripts/jira-evidence-portfolio.mjs`, `WORK_REVIEW_README.md` |

**One-line pipeline story (accurate to this repo):**

> Sentry → (optional) Jira ticket → **NEXUS** polls Jira → **council** produces a cheatsheet → executor implements → **PR review council** + checks → **ADO PR** → human review + Jira/Slack updates.

---

## 2. AI-native initiative — how to phrase it (judgment, not “used ChatGPT”)

Reviewers care about **judgment**: when automation helps, where humans stay in the loop, and what you **verified**.

| Theme | Example sentence you can adapt |
|--------|-------------------------------|
| **System design** | “I invested in an **agent pipeline** (council → execute → validate → PR) so repetitive fixes are **consistent** and **reviewable**, not ad-hoc prompts.” |
| **Quality gates** | “**PR review council** and validation run **before** PR creation — AI speed without skipping review.” |
| **Operational safety** | “Sentry → Jira → agent flows are **operator-controlled** where needed (e.g. choose issue before ticket) so we don’t spam production noise into Jira.” |
| **Evidence culture** | “I automated **Jira-backed analytics and portfolio HTML** so performance discussions tie to **shipped tickets**, not memory.” |
| **Honesty** | “When automation didn’t fit (unclear ticket, risky area), we **didn’t** run the daemon — native competency includes **when not to automate**.” |

---

## 3. Fill in — your initiative (paste into the review form)

**Short title (≤ 1 line):**

> *[Example: “AI-assisted delivery automation: Jira → multi-agent pipeline → ADO PRs with review gates.”]*

**Your version:**

> _________________________________________________

**What you initiated or owned (3–6 bullets):**

- _________________________________________________
- _________________________________________________
- _________________________________________________

**What changed for the team (outcomes, even rough):**

- _________________________________________________
- _________________________________________________

**AI-native angle (2–4 sentences):**

> _________________________________________________
> _________________________________________________

**What didn’t work / what you learned:**

> _________________________________________________

**Evidence (links, paths, or ticket IDs — no secrets):**

- Repo / docs: `PLAYBOOK.md`, `Dr.-Nexus/README.md`, `AUTOMATION_RUNBOOK.md` (if applicable)
- Jira / ADO: _________________________________________________

---

## 4. Optional: “Initiative” paragraph (copy-paste block)

*Replace the bracketed parts with your specifics.*

> I took initiative on **AI-native engineering automation** in our internal **AI-Agent** workspace: end-to-end flows from **Jira** through a **multi-agent council** and **executor** to **Azure DevOps PRs**, with **validation and PR-review councils** before merge, plus **Slack/Jira** visibility. I also connected **Sentry**-driven workflows to **actionable Jira tickets** where appropriate, and documented operational runbooks (**PLAYBOOK**, daily workflows) so others can run the same path safely. Separately, I generated **data-backed review evidence** (Jira exports → dashboards/portfolio) so performance conversations anchor to **shipped work**. I apply **judgment** about when to run full automation versus manual steps, and I treat model output as **draft** until tests and review say otherwise.

---

## 5. Related files (keep in sync when you change the stack)

| Doc | Purpose |
|-----|---------|
| `PLAYBOOK.md` | Commands and scenarios |
| `Dr.-Nexus/README.md` | NEXUS architecture |
| `Dr.-Nexus/AUTOMATION_RUNBOOK.md` | Sentry → Jira → agent ops |
| `WORK_REVIEW_README.md` | Jira export + evidence HTML/PDF |

---

*Update this file when you ship a new automation so review season stays accurate.*
