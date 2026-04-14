# Initiative & AI-native impact — Amar Gupta

Performance review write-up for **"Initiative"** and **AI-native competency** sections.
All claims map to verifiable artifacts in this repo.

---

## 1. What I built and own (facts)

| Area | What it does | Where it lives |
|------|----------------|----------------|
| **NEXUS (Dr.-Nexus)** | Jira-labeled ticket → multi-agent **council** (plan) → executor → **validation + PR review council** → **Azure DevOps PR** → Jira + Slack — fully autonomous dev loop | `Dr.-Nexus/` |
| **Multi-provider AI fallback** | Claude runs primary; if it rate-limits or fails, **Codex (o4-mini)** takes over automatically via OpenAI API key — no human intervention needed across all stages (execute, planning council, PR review council) | `Dr.-Nexus/src/ai-provider/` |
| **Multi-agent council engine** | Adversarial council: proposer explores codebase → critics independently verify every claim → proposer synthesizes via AGREED/DISAGREE protocol → quality gate extracts actionable cheatsheet. Session memory across rounds. Human-feedback injection mid-run | `Dr.-Nexus/src/council/` |
| **Sentry → Jira → agent** | Production errors can be listed, turned into JCP tickets with service mapping, then auto-picked up by NEXUS — operator-controlled to avoid noise | `Dr.-Nexus/src/sentry/`, `AUTOMATION_RUNBOOK.md` |
| **Checkpoint + resume** | Every pipeline step is persisted to disk. Failed runs resume from the exact failure point — no re-running the 20-minute council if only the PR step failed | `Dr.-Nexus/src/pipeline/checkpoint.js` |
| **Jira CLI** | Ticket creation, transitions, comments, JQL search — reduces manual Jira UI work to one terminal command | `jira-creator/jira-cli.mjs` |
| **Sentry tooling** | CLI for issues/events/resolve/ignore with MCP-style workflows | `sentry-alert/` |
| **Operational playbook** | Single reference for daily automation: all flows, all commands, decision tree, failure recovery, human-in-the-loop guidance | `PLAYBOOK.md` |
| **Review evidence pipeline** | Jira export → Chart.js doughnuts + Mermaid flows + interactive HTML portfolio + PDF — performance discussions anchor to shipped tickets, not memory | `scripts/jira-evidence-portfolio.mjs`, `WORK_REVIEW_README.md` |

**One-line pipeline story:**

> Sentry → (optional) Jira ticket → **NEXUS** polls Jira → **adversarial council** produces a cheatsheet → executor implements → **PR review council** + validation → **ADO PR** → human review → Jira + Slack updates. If Claude rate-limits at any stage → **Codex auto-takes over**.

---

## 2. AI-native initiative — the judgment layer

Reviewers care about **judgment**: when automation helps, where humans stay in the loop, what you verified, and what you deliberately chose NOT to automate.

| Theme | What I did |
|--------|-------------------------------|
| **System design over one-off prompts** | Built a reusable council engine (`src/council/`) decoupled from any specific task. The same deliberation, quality-gate, and session-memory infrastructure is used for both planning and PR review — two independent use cases, one engine. |
| **Adversarial quality gates** | Critics must independently verify every claim in the codebase (check files exist, references aren't broken, tests have fixtures). "AGREED" is only valid if the plan already covers the critique — not just if the proposer says it does. |
| **Resilience by design** | Claude is the primary provider; Codex (o4-mini via API key) is the fallback at every stage. Rate limits or failures don't stall a run — they trigger a silent retry. The system degrades gracefully, not catastrophically. |
| **Human-in-the-loop where it matters** | An operator can drop a `human-feedback.md` file mid-council to steer the plan without restarting. The agent reads it on the next round. The PR is always submitted as a **draft for human review** — the agent never merges. |
| **Operational safety on Sentry** | Sentry → Jira is operator-controlled: you choose which issue becomes a ticket before NEXUS runs. We deliberately don't auto-create tickets for every Sentry error to avoid noise in Jira. |
| **Checkpoint resilience** | Pipeline state is persisted after every step. When something fails, you resume from the exact step — not from scratch. The 20-minute council output is reused on retry. |
| **Evidence culture** | Built a Jira-export → interactive HTML pipeline specifically so performance discussions are anchored to shipped tickets and real metrics, not memory or impressions. |
| **Knowing when not to automate** | When a ticket is ambiguous, risky, or has unclear scope — NEXUS is not run. The playbook documents this explicitly: `VALIDATE_TICKET` step rejects under-specified tickets before any code is written. |

---

## 3. My initiative (paste into the review form)

**Short title:**

> AI-native delivery automation: adversarial multi-agent pipeline from Jira → code → Azure DevOps PRs, with quality gates, multi-provider resilience, and human-in-the-loop controls.

---

**What I initiated or owned:**

- Designed and built **NEXUS** — an end-to-end autonomous dev pipeline that takes a Jira ticket labeled `nexus`, runs a multi-agent planning council, writes the code, validates it, runs a PR review council, and creates an Azure DevOps PR with full Jira + Slack notification — no manual steps between ticket and PR.
- Built a **reusable adversarial council engine** where AI critics independently verify every plan against the actual codebase before a single line of code is written, catching missing files, broken references, and wrong approaches at the planning stage.
- Implemented **multi-provider AI resilience**: Claude runs primary across all stages; Codex (OpenAI API key, no OAuth) automatically takes over on rate limits or failures — keeping runs alive without human intervention.
- Connected **Sentry production errors → Jira → NEXUS** with operator-controlled ticket creation and service mapping, so production noise doesn't directly pollute Jira but the path from error to automated fix exists.
- Built a **checkpoint + resume system** so any stage of the pipeline (council, execute, validate, ship) can be restarted independently without rerunning expensive upstream steps.
- Generated a **Jira-backed interactive HTML evidence portfolio** with Chart.js analytics, Mermaid flow diagrams, and a searchable table — so performance reviews are grounded in verifiable shipped work.

---

**What changed for the team (outcomes):**

- Routine, well-described bug fixes can go from Jira ticket to Azure DevOps PR without a developer writing or committing code — reviewer time is the only required human input.
- Rate limits on one AI provider no longer block a run — the fallback system keeps the pipeline running across the full workday without manual intervention.
- Operational runbooks (`PLAYBOOK.md`, `AUTOMATION_RUNBOOK.md`) mean anyone on the team can run the same automation path safely, not just the person who built it.
- Review evidence generation takes minutes instead of hours — Jira export to interactive HTML portfolio is one command.

---

**AI-native angle (2–4 sentences):**

> I treat AI as infrastructure, not a shortcut. The council separates thinking (expensive models deliberating, read-only tools) from doing (cheap model executing, strict guardrails) — so AI speed does not come at the cost of review. Every AI output is a draft: it goes through structural validation, a PR review council, and human review before merge. I also apply judgment about when not to automate: ambiguous tickets, risky refactors, and unclear scope are explicitly rejected by the pipeline's validation step rather than silently producing bad code.

---

**What didn't work / what I learned:**

> Claude's daily rate limit made single-provider setups brittle mid-workday. The fix was to treat AI providers as a resilience concern from the start — primary with automatic fallback — rather than patching around limits manually. I also learned that quality gates need to be structural (fast, no API calls) first and AI-evaluated second — running an AI quality gate on garbage output wastes tokens and time; rejecting it on length and format first is faster and cheaper.

---

**Evidence (links, paths, or ticket IDs):**

- Pipeline: `Dr.-Nexus/src/pipeline/steps.js`, `Dr.-Nexus/src/council/`, `Dr.-Nexus/src/ai-provider/`
- Ops docs: `PLAYBOOK.md`, `Dr.-Nexus/AUTOMATION_RUNBOOK.md`
- Evidence HTML: `review-data/work-evidence-portfolio.html` (generated from Jira export)
- Review README: `WORK_REVIEW_README.md`
- Jira: tickets labeled `nexus` or `nexus-done` in JCP project
- ADO PRs: created by NEXUS carry `ID:JCP-XXXXX;` prefix in title — searchable in Azure DevOps

---

## 4. Copy-paste paragraph (drop into the review form as-is)

> I took initiative on **AI-native engineering automation** — building NEXUS, an end-to-end autonomous pipeline from **Jira tickets** through a **multi-agent adversarial council** (where AI critics independently verify every plan against the real codebase) to an **executor agent** that writes the code, a **PR review council** that validates it, and an **Azure DevOps PR** with Jira and Slack notification. I connected **Sentry production errors** to this pipeline via operator-controlled ticket creation so the path from error to automated fix exists without adding noise to Jira. I added **multi-provider resilience** — when Claude hits a rate limit at any stage, Codex (via OpenAI API key) takes over automatically, keeping runs alive without human intervention. I built **checkpoint persistence** so any failed step resumes without re-running expensive upstream AI calls. I documented all of this in operational runbooks and a playbook so the team can run the same path safely. I apply judgment about when not to automate — the pipeline explicitly rejects under-specified tickets before any code is written, and every AI output is reviewed by a human before merge.

---

## 5. AI-native competency table (for the competency form)

| Where AI helped | Tool / workflow | What improved | How I validated |
|-----------------|-----------------|---------------|-----------------|
| Routine bug fixes: code writing | NEXUS executor (Claude/Codex) | Time from ticket to PR draft: hours → ~20 min unattended | PR review council + human code review before merge |
| Plan quality | Adversarial council (proposer + critic) | Plans catch missing files, broken references, wrong approach before code is written | Structural pre-checks + AI evaluator quality gate |
| Production error triage | Sentry CLI + NEXUS | Issues identified and ticketed without manual log-diving | Operator reviews issue before ticket is created |
| Review evidence | Jira export → HTML portfolio | Review prep: hours → one command | Data sourced from Jira — verifiable by anyone with access |
| Staying unblocked | Claude → Codex fallback | Rate limits no longer stall pipeline mid-day | Logs show which provider ran; output validated same as primary |

| What did NOT work | What I learned | What I'd do next |
|-------------------|----------------|------------------|
| Single AI provider breaks at daily rate limits | Treat providers as a resilience concern from day one, not an afterthought | Already fixed: fallback to Codex across all stages |
| Overly broad tickets produce garbage plans | The council can't fix a bad ticket — garbage in, garbage out | `VALIDATE_TICKET` step now rejects tickets missing required fields before council runs |
| AI quality gate is slow on garbage output | Structural pre-checks (length, file paths, action verbs) should filter first; AI evaluator second | Already layered: structural check → AI evaluator |

---

## 6. Related files (keep in sync when you change the stack)

| Doc | Purpose |
|-----|---------|
| `PLAYBOOK.md` | All commands, scenarios, decision tree, failure recovery |
| `Dr.-Nexus/README.md` | NEXUS architecture deep-dive |
| `Dr.-Nexus/AUTOMATION_RUNBOOK.md` | Sentry → Jira → agent operational runbook |
| `WORK_REVIEW_README.md` | Jira export + evidence HTML/PDF generation |
| `review-data/work-evidence-portfolio.html` | Generated interactive portfolio (gitignored, regenerate with `node scripts/jira-evidence-portfolio.mjs`) |

---

*Update this file when you ship a new automation so review season is copy-paste, not archaeology.*
