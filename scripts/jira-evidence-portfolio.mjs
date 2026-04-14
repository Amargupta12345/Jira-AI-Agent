#!/usr/bin/env node
/**
 * Self-contained interactive evidence portfolio (modern UI + AI-native section).
 * Input:  review-data/my-tickets-updated-full.json
 * Output: review-data/work-evidence-portfolio.html
 *
 * Customize AI-native copy:
 *   - Edit AI_NATIVE_SECTION below, or
 *   - Copy scripts/evidence-custom.example.json → review-data/evidence-custom.json
 * Then: node scripts/jira-evidence-portfolio.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'review-data');
const DATA_PATH = resolve(OUT_DIR, 'my-tickets-updated-full.json');
const CONFIG_PATH = resolve(ROOT, 'jira-creator/jira-config.json');

/** Edit this block to personalize your AI-native story for reviewers */
const AI_NATIVE_SECTION = {
  headline: 'AI-native ways of working',
  lede:
    'Impact comes from judgment: when to use AI, how to verify output, and what to automate. I use AI to accelerate investigation and drafting, but every change is validated with tests, review, and safe rollout. This portfolio is generated from live Jira data — evidence, not vibes.',
  pillars: [
    {
      title: 'Investigation → plan → execute (repeatable)',
      body:
        'Use AI to summarize context (tickets/PRs/logs), propose 2–3 options, and produce a small, testable plan. Prefer incremental diffs to reduce risk in CMS + platform code.',
      accent: 'from-violet-500/20 to-fuchsia-500/10',
    },
    {
      title: 'Review & verification',
      body:
        'Treat AI output as a draft. Validate using unit/integration tests, reproducible steps, peer review, and post-deploy checks—especially for Blocker and production issues.',
      accent: 'from-cyan-500/20 to-blue-500/10',
    },
    {
      title: 'Speed without losing quality',
      body:
        'AI helps me move faster on debugging, refactors, and test creation. Quality stays high via guardrails: smaller PRs, clear rollback paths, and follow-up hardening after hotfixes.',
      accent: 'from-amber-500/20 to-orange-500/10',
    },
    {
      title: 'Know when NOT to use AI',
      body:
        'Avoid AI for sensitive data, uncertain requirements, or high-risk changes without clear reproduction. If context is missing, I first collect evidence (logs, traces, steps) before drafting fixes.',
      accent: 'from-emerald-500/20 to-teal-500/10',
    },
  ],
};

function loadEvidenceCustom() {
  const p = resolve(OUT_DIR, 'evidence-custom.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`evidence-custom.json: ${e.message} — using defaults`);
    return null;
  }
}

function loadAiImpact() {
  const p = resolve(OUT_DIR, 'ai-impact.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch (e) {
    console.warn(`ai-impact.json: ${e.message} — skipping AI impact section`);
    return null;
  }
}

function loadAiMetricsEvidence() {
  const p = resolve(OUT_DIR, 'ai-metrics.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const s = raw.summary || {};
    if (typeof s.cursorCommits !== 'number' && typeof s.mergedAiPrs !== 'number') return null;
    return { mode: 'single', raw };
  } catch (e) {
    console.warn(`ai-metrics.json: ${e.message} — skipping AI metrics evidence`);
    return null;
  }
}

function loadAiMetricsAllEvidence() {
  const p = resolve(OUT_DIR, 'ai-metrics-all.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const s = raw.summary || {};
    if (typeof s.cursorCommits !== 'number' && typeof s.mergedAiPrs !== 'number') return null;
    if (!Array.isArray(raw.repos)) return null;
    return { mode: 'all', raw };
  } catch (e) {
    console.warn(`ai-metrics-all.json: ${e.message} — skipping combined AI metrics evidence`);
    return null;
  }
}

function mergeAiSection(base, over) {
  if (!over || typeof over !== 'object') return base;
  const pillars =
    Array.isArray(over.pillars) && over.pillars.length > 0
      ? over.pillars.map((x, i) => ({
          title: x.title ?? base.pillars[i]?.title ?? '',
          body: x.body ?? base.pillars[i]?.body ?? '',
          accent: x.accent ?? base.pillars[i]?.accent ?? 'from-slate-500/20 to-slate-500/10',
        }))
      : base.pillars;
  return {
    headline: over.headline ?? base.headline,
    lede: over.lede ?? base.lede,
    pillars,
  };
}

/** Pinned tickets appear first in Highlights (must exist in export) */
function applyPinnedOrder(rows, pinKeys) {
  if (!pinKeys?.length) return rows;
  const m = new Map(rows.map((r) => [r.key, r]));
  const out = [];
  const used = new Set();
  for (const k of pinKeys) {
    if (m.has(k)) {
      out.push(m.get(k));
      used.add(k);
    }
  }
  for (const r of rows) {
    if (!used.has(r.key)) out.push(r);
  }
  return out;
}

function loadJiraBase() {
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return String(c.siteUrl || '').replace(/\/$/, '') || 'https://example.atlassian.net';
  } catch {
    return 'https://example.atlassian.net';
  }
}

function loadDisplayName() {
  try {
    const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return c.user?.name || c.user?.email || 'Engineer';
  } catch {
    return 'Engineer';
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function countBy(issues, getter) {
  const map = new Map();
  for (const issue of issues) {
    const key = getter(issue) || '(none)';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function issueRow(issue, jiraBase) {
  const f = issue.fields || {};
  const key = issue.key;
  const url = `${jiraBase}/browse/${key}`;
  const type = f.issuetype?.name || '';
  const pri = f.priority?.name || '';
  const st = f.status?.name || '';
  const comp = (f.components || []).map((c) => c.name).join(', ') || '—';
  const sum = f.summary || '';
  return { key, url, type, pri, st, comp, sum };
}

function buildMermaidPie(issues) {
  const byType = countBy(issues, (i) => i.fields?.issuetype?.name).slice(0, 10);
  const lines = ['pie title Issues by type'];
  for (const [name, n] of byType) {
    const safe = name.replace(/"/g, "'").slice(0, 42);
    lines.push(`  "${safe}" : ${n}`);
  }
  return lines.join('\n');
}

function buildHighlights(issues) {
  const epics = issues.filter((i) => i.fields?.issuetype?.name === 'Epic');
  const stories = issues.filter((i) => i.fields?.issuetype?.name === 'Story');
  const blockers = issues.filter((i) => i.fields?.priority?.name === 'Blocker');
  return { epics, stories, blockers };
}

function computeStats(issues) {
  const done = issues.filter((i) => i.fields?.status?.statusCategory?.key === 'done').length;
  const inProg = issues.filter((i) => i.fields?.status?.statusCategory?.key === 'indeterminate').length;
  const todo = issues.filter((i) => i.fields?.status?.statusCategory?.key === 'new').length;
  const { epics, stories, blockers } = buildHighlights(issues);
  return {
    total: issues.length,
    epics: epics.length,
    stories: stories.length,
    blockers: blockers.length,
    done,
    inProg,
    todo,
  };
}

function pillClass(type, pri) {
  if (pri === 'Blocker') return 'pill pill--blocker';
  if (type === 'Epic') return 'pill pill--epic';
  if (type === 'Story') return 'pill pill--story';
  return 'pill';
}

function main() {
  if (!existsSync(DATA_PATH)) {
    console.error(`Missing ${DATA_PATH}`);
    console.error('Run: node scripts/jira-review-dashboard.mjs');
    process.exit(1);
  }

  const bundle = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const issues = bundle.issues || [];
  const jiraBase = loadJiraBase();
  const displayName = loadDisplayName();
  const generatedAt = new Date().toISOString();
  const jql = bundle.meta?.jql || '';
  const stats = computeStats(issues);

  const byType = countBy(issues, (i) => i.fields?.issuetype?.name);
  const byCat = countBy(issues, (i) => i.fields?.status?.statusCategory?.name);
  const byPri = countBy(issues, (i) => i.fields?.priority?.name);
  const { epics, stories, blockers } = buildHighlights(issues);

  const palette = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#64748b'];

  const chartPayload = {
    issueType: {
      labels: byType.map(([k]) => k),
      data: byType.map(([, v]) => v),
    },
    statusCat: {
      labels: byCat.map(([k]) => k),
      data: byCat.map(([, v]) => v),
    },
    priority: {
      labels: byPri.map(([k]) => k),
      data: byPri.map(([, v]) => v),
    },
  };

  const highlightRows = [...epics, ...stories, ...blockers].map((i) => issueRow(i, jiraBase));
  const seen = new Set();
  let uniqueHighlights = highlightRows.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });

  const allRows = issues.map((i) => issueRow(i, jiraBase)).sort((a, b) => b.key.localeCompare(a.key));
  const mermaidPie = buildMermaidPie(issues);

  const custom = loadEvidenceCustom();
  const aiSection = mergeAiSection(AI_NATIVE_SECTION, custom);
  uniqueHighlights = applyPinnedOrder(uniqueHighlights, custom?.pinnedTickets);
  const aiImpact = loadAiImpact();
  // Prefer combined evidence when it exists (all services), fall back to single-repo evidence.
  const aiMetrics = loadAiMetricsAllEvidence() || loadAiMetricsEvidence();

  const aiMetricsRaw = aiMetrics?.raw || null;
  const aiMetricsSummary = aiMetricsRaw?.summary || {};
  const aiMetricsMeta = aiMetricsRaw?.meta || {};
  const aiMetricsRepos = aiMetrics?.mode === 'all' ? aiMetricsRaw?.repos || [] : [];

  const aiCardsHtml = aiSection.pillars
    .map(
      (p) => `
    <article class="ai-card bg-gradient-to-br ${p.accent} border border-white/10 rounded-2xl p-5 backdrop-blur-sm hover:border-white/20 transition-all duration-300 hover:-translate-y-0.5">
      <h3 class="text-sm font-semibold text-white/95 tracking-tight mb-2">${escapeHtml(p.title)}</h3>
      <p class="text-sm text-slate-400 leading-relaxed">${escapeHtml(p.body)}</p>
    </article>`,
    )
    .join('');

  const aiImpactCardsHtml = Array.isArray(aiImpact?.summaryCards)
    ? aiImpact.summaryCards
        .slice(0, 6)
        .map(
          (c) => `
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
        <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">${escapeHtml(c.label ?? '')}</p>
        <p class="stat-num text-xl font-bold text-white">${escapeHtml(c.value ?? '')}</p>
        ${c.sub ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(c.sub)}</p>` : ''}
      </div>`,
        )
        .join('')
    : '';

  const aiImpactRowsHtml = Array.isArray(aiImpact?.beforeAfter)
    ? aiImpact.beforeAfter
        .slice(0, 10)
        .map((r) => {
          const before = r.before ?? '';
          const after = r.after ?? '';
          const unit = r.unit ? ` ${r.unit}` : '';
          const dir = r.direction === 'higher_is_better' ? '↑ higher is better' : '↓ lower is better';
          return `
        <tr class="border-b border-white/5 hover:bg-white/5">
          <td class="py-2.5 pr-2 text-slate-300">${escapeHtml(r.metric ?? '')}</td>
          <td class="py-2.5 pr-2 text-slate-400">${escapeHtml(`${before}${unit}`)}</td>
          <td class="py-2.5 pr-2 text-slate-400">${escapeHtml(`${after}${unit}`)}</td>
          <td class="py-2.5 text-slate-500 text-xs">${escapeHtml(dir)}</td>
        </tr>`;
        })
        .join('')
    : '';

  const aiImpactNotesHtml = Array.isArray(aiImpact?.notes)
    ? aiImpact.notes
        .slice(0, 6)
        .map((n) => `<li class="text-sm text-slate-400 leading-relaxed">${escapeHtml(n)}</li>`)
        .join('')
    : '';

  const aiMetricsToolRows = aiMetricsRaw?.breakdown?.byTool
    ? Object.entries(aiMetricsRaw.breakdown.byTool)
        .slice(0, 6)
        .map(
          ([tool, n]) => `
          <div class="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
            <span class="text-sm text-slate-300">${escapeHtml(tool)}</span>
            <span class="font-mono text-xs text-slate-400">${escapeHtml(String(n))} PRs</span>
          </div>`,
        )
        .join('')
    : '';

  function topToolLabel(repoEntry) {
    const byTool = repoEntry?.breakdown?.byTool;
    if (!byTool || typeof byTool !== 'object') return '—';
    const top = Object.entries(byTool).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
    if (!top) return '—';
    return `${top[0]} (${top[1]})`;
  }

  const aiMetricsReposRowsHtml =
    aiMetrics?.mode === 'all'
      ? aiMetricsRepos
          .slice(0, 12)
          .map((r) => {
            const repo = r?.meta?.repo || r?.meta?.serviceKey || '—';
            const svc = r?.meta?.serviceKey || '—';
            const cursor = r?.summary?.cursorCommits ?? 0;
            const prs = r?.summary?.mergedAiPrs ?? 0;
            return `
        <tr class="border-b border-white/5 hover:bg-white/5">
          <td class="py-2.5 pr-2 text-slate-300">${escapeHtml(String(svc))}</td>
          <td class="py-2.5 pr-2 text-slate-500 text-xs font-mono">${escapeHtml(String(repo))}</td>
          <td class="py-2.5 pr-2 font-mono text-slate-300">${escapeHtml(String(cursor))}</td>
          <td class="py-2.5 pr-2 font-mono text-slate-300">${escapeHtml(String(prs))}</td>
          <td class="py-2.5 text-slate-500 text-xs">${escapeHtml(topToolLabel(r))}</td>
        </tr>`;
          })
          .join('')
      : '';

  const highlightCardsHtml = uniqueHighlights
    .map(
      (r) => `
    <a href="${escapeAttr(r.url)}" target="_blank" rel="noopener" class="ticket-card group block rounded-xl border border-white/10 bg-slate-900/50 p-4 backdrop-blur hover:bg-slate-800/70 hover:border-cyan-500/30 transition-all duration-200">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="font-mono text-xs text-cyan-400 group-hover:text-cyan-300">${escapeHtml(r.key)}</span>
        <span class="${pillClass(r.type, r.pri)}">${escapeHtml(r.type)}</span>
        <span class="text-xs text-slate-500">${escapeHtml(r.pri)} · ${escapeHtml(r.st)}</span>
      </div>
      <p class="text-sm text-slate-300 line-clamp-3 ticket-clamp leading-snug">${escapeHtml(r.sum)}</p>
    </a>`,
    )
    .join('');

  const tableRowsHtml = allRows
    .map(
      (r) => `
      <tr data-search="${escapeAttr(`${r.key} ${r.sum} ${r.comp} ${r.type} ${r.pri}`.toLowerCase())}" class="border-b border-white/5 hover:bg-white/5">
        <td class="py-2.5 pr-2"><a class="font-mono text-cyan-400 hover:underline" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.key)}</a></td>
        <td class="py-2.5 pr-2 text-slate-400">${escapeHtml(r.type)}</td>
        <td class="py-2.5 pr-2">${escapeHtml(r.pri)}</td>
        <td class="py-2.5 pr-2 text-slate-400">${escapeHtml(r.st)}</td>
        <td class="py-2.5 pr-2 text-slate-500 text-xs max-w-[140px]">${escapeHtml(r.comp)}</td>
        <td class="py-2.5 text-slate-300">${escapeHtml(r.sum)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Impact · ${escapeHtml(displayName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
        },
      },
    };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: Inter, system-ui, sans-serif; }
    .mesh {
      background-color: #020617;
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 92, 246, 0.35), transparent),
        radial-gradient(ellipse 60% 40% at 100% 0%, rgba(6, 182, 212, 0.12), transparent),
        radial-gradient(ellipse 50% 30% at 0% 100%, rgba(236, 72, 153, 0.08), transparent);
    }
    .grid-bg {
      background-image: linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
      background-size: 48px 48px;
    }
    .reveal { opacity: 0; transform: translateY(12px); transition: opacity 0.5s ease, transform 0.5s ease; }
    .reveal.visible { opacity: 1; transform: translateY(0); }
    .pill { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.45rem; border-radius: 6px; background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
    .pill--epic { background: rgba(139, 92, 246, 0.25); color: #c4b5fd; }
    .pill--story { background: rgba(6, 182, 212, 0.2); color: #67e8f9; }
    .pill--blocker { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
    .stat-num { font-variant-numeric: tabular-nums; }
    canvas { max-height: 220px !important; }
    #full-wrap { max-height: 420px; overflow: auto; }
    #full-wrap thead th { position: sticky; top: 0; background: rgb(15 23 42 / 0.95); backdrop-filter: blur(8px); z-index: 1; }
    .ticket-clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
    .print-toast { opacity: 0; transform: translateY(6px); pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease; }
    .print-toast.show { opacity: 1; transform: translateY(0); }
    @page { margin: 14mm 12mm; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .no-print { display: none !important; }
      .print-break { break-inside: avoid; }
      main { padding-top: 0 !important; padding-bottom: 0 !important; max-width: none !important; }
      section { margin-bottom: 18px !important; }
      #full-wrap { max-height: none !important; overflow: visible !important; }
      .reveal { opacity: 1 !important; transform: none !important; }
      html, body { background: #ffffff !important; color: #0f172a !important; }
      .mesh, .grid-bg { background: #ffffff !important; background-image: none !important; }
      a { color: #0284c7 !important; text-decoration: none !important; }
      a[href]::after { content: ""; }

      /* Typography */
      body { font-size: 12px !important; line-height: 1.45 !important; }
      h1 { color: #0f172a !important; font-size: 22px !important; line-height: 1.15 !important; }
      h2 { color: #0f172a !important; font-size: 15px !important; margin-bottom: 8px !important; }
      h3 { color: #0f172a !important; font-size: 13px !important; margin-bottom: 6px !important; }
      p { color: rgba(15, 23, 42, 0.82) !important; }
      .text-slate-400, .text-slate-500 { color: rgba(15, 23, 42, 0.72) !important; }
      .text-white { color: #0f172a !important; }
      /* Gradient/clip text can become invisible in print */
      .text-transparent { color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; }
      .bg-clip-text { -webkit-background-clip: border-box !important; background-clip: border-box !important; }
      .stat-num { color: #0f172a !important; }

      /* Cards become clean print cards */
      .backdrop-blur { backdrop-filter: none !important; }
      .shadow-sm { box-shadow: none !important; }
      .rounded-2xl, .rounded-xl { border-radius: 12px !important; }
      .border-white\\/10 { border-color: rgba(15, 23, 42, 0.12) !important; }
      .bg-slate-900\\/60, .bg-slate-900\\/50, .bg-slate-900\\/40, .bg-slate-900\\/30, .bg-slate-900\\/80, .bg-slate-800\\/70 { background: #ffffff !important; }

      /* Charts: give them room and avoid cramped doughnuts */
      canvas { max-height: 260px !important; }
      .print-chart-img { display: block !important; width: 100% !important; max-height: 280px !important; object-fit: contain !important; }

      /* Table: readable in print */
      #full { border-collapse: collapse !important; }
      #full thead th { position: static !important; background: #f8fafc !important; color: rgba(15,23,42,0.7) !important; border-bottom: 1px solid rgba(15,23,42,0.12) !important; }
      #full tbody td { color: rgba(15,23,42,0.82) !important; border-bottom: 1px solid rgba(15,23,42,0.08) !important; }
      #full tbody tr { break-inside: avoid !important; }

      .ticket-card { background: #ffffff !important; border-color: rgba(15,23,42,0.12) !important; }
      .ticket-card p, .ticket-card span, .ticket-card div { color: #0f172a !important; }
      .pill { background: rgba(15,23,42,0.08) !important; color: rgba(15,23,42,0.72) !important; }

      /* Highlights: ensure text is not cut off */
      .ticket-clamp { display: block !important; -webkit-line-clamp: unset !important; overflow: visible !important; }

      /* Mermaid / diagrams */
      svg { max-width: 100% !important; height: auto !important; }
      pre.mermaid { color: rgba(15,23,42,0.72) !important; }
    }
  </style>
</head>
<body class="mesh text-slate-200 min-h-screen antialiased">
  <header class="no-print fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-md print:hidden">
    <div class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <span class="font-semibold text-white tracking-tight">Evidence portfolio</span>
      <div class="flex flex-wrap items-center gap-2">
      <button type="button" id="btn-print"
        class="no-print inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/30 hover:to-violet-500/30 text-white border border-white/10 shadow-sm shadow-cyan-500/10 transition-all active:scale-[0.98]">
        <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 text-cyan-200">
          <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/>
        </svg>
        Download PDF
      </button>
      <span class="no-print print-toast text-[11px] text-slate-400 border border-white/10 bg-slate-950/60 px-2.5 py-1.5 rounded-xl backdrop-blur" id="print-toast">
        Preparing print view…
      </span>
      <nav class="flex flex-wrap gap-1 text-sm">
        <a href="#overview" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">Overview</a>
        <a href="#ai-native" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">AI-native</a>
        ${aiMetrics ? `<a href="#ai-evidence" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">AI evidence</a>` : ''}
        ${aiImpact ? `<a href="#ai-impact" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">AI impact</a>` : ''}
        <a href="#analytics" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">Analytics</a>
        <a href="#evidence" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">Highlights</a>
        <a href="#all" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">All tickets</a>
      </nav>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 pt-24 pb-16 print:pt-6 relative grid-bg rounded-none">
    <section id="overview" class="reveal mb-16">
      <p class="text-xs font-mono text-cyan-500/90 mb-3 tracking-widest uppercase">Live export · ${escapeHtml(generatedAt.slice(0, 10))}</p>
      <h1 class="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
        Delivery evidence for <span class="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">${escapeHtml(displayName)}</span>
      </h1>
      <p class="text-slate-400 max-w-2xl text-base leading-relaxed mb-8">
        Interactive view of Jira work (assignee = you). Use the sections below for review conversations — every key links to the ticket for audit trail.
      </p>

      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Tickets</p>
          <p class="stat-num text-2xl font-bold text-white" data-count="${stats.total}">0</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Epics</p>
          <p class="stat-num text-2xl font-bold text-violet-300" data-count="${stats.epics}">0</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Stories</p>
          <p class="stat-num text-2xl font-bold text-cyan-300" data-count="${stats.stories}">0</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Blockers</p>
          <p class="stat-num text-2xl font-bold text-rose-300" data-count="${stats.blockers}">0</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Done (cat.)</p>
          <p class="stat-num text-2xl font-bold text-emerald-300" data-count="${stats.done}">0</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">In progress</p>
          <p class="stat-num text-2xl font-bold text-amber-300" data-count="${stats.inProg}">0</p>
        </div>
      </div>
      <p class="mt-4 text-xs text-slate-500 font-mono break-all">JQL: ${escapeHtml(jql)}</p>
    </section>

    <section id="ai-native" class="reveal mb-16">
      <h2 class="text-xl font-semibold text-white mb-1 flex items-center gap-2">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-lg">✦</span>
        ${escapeHtml(aiSection.headline)}
      </h2>
      <p class="text-slate-400 mb-8 max-w-3xl leading-relaxed">${escapeHtml(aiSection.lede)}</p>
      <div class="grid sm:grid-cols-2 gap-4">${aiCardsHtml}</div>
    </section>

    ${
      aiMetrics
        ? `<section id="ai-evidence" class="reveal mb-16">
      <h2 class="text-xl font-semibold text-white mb-1 flex items-center gap-2">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/20 text-lg">✓</span>
        AI evidence (from VCS)
      </h2>
      <p class="text-slate-400 mb-6 max-w-3xl leading-relaxed">
        Proof that I consistently use AI-assisted workflows in real delivery — measured from version control activity, not self-reported.
      </p>

      <div class="rounded-2xl border border-white/10 bg-slate-900/30 p-5 print-break">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-slate-300 mb-1">Summary</p>
            <p class="text-xs text-slate-500 font-mono">${escapeHtml(
              [
                aiMetrics.mode === 'all'
                  ? `repos: ${(aiMetricsMeta.repos || []).length || aiMetricsRepos.length}`
                  : aiMetricsMeta?.repo
                    ? `repo: ${aiMetricsMeta.repo}`
                    : '',
                aiMetricsMeta?.fromDate ? `from: ${String(aiMetricsMeta.fromDate).slice(0, 10)}` : '',
                aiMetricsMeta?.toDate ? `to: ${String(aiMetricsMeta.toDate).slice(0, 10)}` : '',
              ]
                .filter(Boolean)
                .join(' · '),
            )}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <div class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
              <p class="text-[11px] text-slate-500 uppercase tracking-wide">Cursor commits</p>
              <p class="font-mono text-sm text-white">${escapeHtml(String(aiMetricsSummary?.cursorCommits ?? 0))}</p>
            </div>
            <div class="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
              <p class="text-[11px] text-slate-500 uppercase tracking-wide">Merged AI PRs</p>
              <p class="font-mono text-sm text-white">${escapeHtml(String(aiMetricsSummary?.mergedAiPrs ?? 0))}</p>
            </div>
          </div>
        </div>

        <div class="mt-4 grid sm:grid-cols-2 gap-4">
          <div class="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <p class="text-xs text-slate-500 uppercase tracking-wide mb-2">By AI tool</p>
            ${aiMetricsToolRows || '<p class="text-sm text-slate-500">—</p>'}
          </div>
          <div class="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <p class="text-xs text-slate-500 uppercase tracking-wide mb-2">Verification habits</p>
            <ul class="list-disc pl-5 space-y-1.5 text-sm text-slate-400">
              <li>Use AI for drafts and exploration, not final authority</li>
              <li>Validate with tests, code review, and staged rollout</li>
              <li>Convert hotfix learnings into permanent fixes</li>
            </ul>
          </div>
        </div>

        ${
          aiMetrics?.mode === 'all' && aiMetricsReposRowsHtml
            ? `<div class="mt-4 rounded-xl border border-white/10 bg-slate-900/40 overflow-hidden">
          <div class="px-4 py-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-slate-500 uppercase tracking-wide">Per service breakdown (top 12)</p>
            <p class="text-[11px] text-slate-500 font-mono">Cursor commits + merged AI PRs</p>
          </div>
          <div class="px-4 pb-3 overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th class="py-2 pr-2">Service</th>
                  <th class="py-2 pr-2">Repo</th>
                  <th class="py-2 pr-2">Cursor commits</th>
                  <th class="py-2 pr-2">Merged AI PRs</th>
                  <th class="py-2">Top tool</th>
                </tr>
              </thead>
              <tbody>${aiMetricsReposRowsHtml}</tbody>
            </table>
          </div>
        </div>`
            : ''
        }
      </div>
    </section>`
        : ''
    }

    ${
      aiImpact
        ? `<section id="ai-impact" class="reveal mb-16">
      <h2 class="text-xl font-semibold text-white mb-1 flex items-center gap-2">
        <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/20 text-lg">↗</span>
        ${escapeHtml(aiImpact.headline ?? 'AI impact (speed + quality)')}
      </h2>
      <p class="text-slate-400 mb-6 max-w-3xl leading-relaxed">${escapeHtml(
        aiImpact.lede ??
          'Before/after metrics that show faster delivery and higher quality with AI-assisted workflows (with verification).',
      )}</p>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${aiImpactCardsHtml || ''}
      </div>

      ${
        aiImpactRowsHtml
          ? `<div class="rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden mb-4">
        <div class="px-5 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-slate-300 font-medium">Before vs after</p>
          <p class="text-xs text-slate-500 font-mono">${escapeHtml(
            [aiImpact.timeRange, aiImpact.dataSource].filter(Boolean).join(' · '),
          )}</p>
        </div>
        <div class="px-5 pb-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-500 uppercase tracking-wide">
                <th class="py-2 pr-2">Metric</th>
                <th class="py-2 pr-2">Before</th>
                <th class="py-2 pr-2">After</th>
                <th class="py-2">Goal</th>
              </tr>
            </thead>
            <tbody>${aiImpactRowsHtml}</tbody>
          </table>
        </div>
      </div>`
          : ''
      }

      ${
        aiImpactNotesHtml
          ? `<div class="rounded-2xl border border-white/10 bg-slate-900/30 p-5 print-break">
        <p class="text-sm font-medium text-slate-300 mb-3">How I keep quality high</p>
        <ul class="list-disc pl-5 space-y-2">${aiImpactNotesHtml}</ul>
      </div>`
          : ''
      }
    </section>`
        : ''
    }

    <section id="analytics" class="reveal mb-16">
      <h2 class="text-xl font-semibold text-white mb-6">Workload analytics</h2>
      <div class="grid md:grid-cols-3 gap-4 mb-6">
        <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
          <h3 class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Issue type</h3>
          <canvas id="c1"></canvas>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
          <h3 class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Status category</h3>
          <canvas id="c2"></canvas>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
          <h3 class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Priority</h3>
          <canvas id="c3"></canvas>
        </div>
      </div>
      <details class="group rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden">
        <summary class="cursor-pointer px-5 py-4 text-sm text-slate-400 hover:text-white transition-colors list-none flex items-center justify-between">
          <span>Mermaid diagram (export to Confluence / Notion)</span>
          <span class="text-cyan-500 text-xs group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div class="px-5 pb-5 overflow-x-auto border-t border-white/5">
          <pre class="mermaid text-xs">${mermaidPie.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
        </div>
      </details>
    </section>

    <section id="evidence" class="reveal mb-16">
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 class="text-xl font-semibold text-white">Highlighted evidence</h2>
          <p class="text-sm text-slate-500 mt-1">Epics, Stories, and Blocker-priority items — ${uniqueHighlights.length} cards</p>
        </div>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${highlightCardsHtml}</div>
    </section>

    <section id="all" class="reveal">
      <h2 class="text-xl font-semibold text-white mb-2">All tickets</h2>
      <p class="text-sm text-slate-500 mb-4"><span id="result-count">${allRows.length}</span> rows · press <kbd class="px-1.5 py-0.5 rounded bg-white/10 font-mono text-xs">/</kbd> to search</p>
      <input type="search" id="q" placeholder="Filter key, summary, component, type…" autocomplete="off"
        class="w-full max-w-md rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 mb-4" />
      <div id="full-wrap" class="rounded-xl border border-white/10 overflow-hidden">
        <table class="w-full text-sm" id="full">
          <thead>
            <tr class="text-left text-xs text-slate-500 uppercase tracking-wide">
              <th class="py-2 pl-3">Key</th><th>Type</th><th>Pri</th><th>Status</th><th>Components</th><th class="pr-3">Summary</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>
      <p class="mt-6 text-xs text-slate-500 border border-white/10 rounded-xl p-4 bg-slate-900/30 print-break">
        <strong class="text-slate-400">Share:</strong> Use <strong>Save as PDF</strong> (header) or upload this HTML. Jira links need org login. Customize AI copy via <code class="text-cyan-500/90">review-data/evidence-custom.json</code> (see <code class="text-cyan-500/90">scripts/evidence-custom.example.json</code>) or <code class="text-cyan-500/90">AI_NATIVE_SECTION</code> in the generator script.
      </p>
    </section>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    const CP = ${JSON.stringify(chartPayload)};
    const palette = ${JSON.stringify(palette)};

    function doughnut(id, labels, data) {
      const ctx = document.getElementById(id);
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: labels.map((_, i) => palette[i % palette.length]),
            borderWidth: 2,
            borderColor: '#0f172a',
            hoverOffset: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', boxWidth: 10, padding: 12, font: { size: 11 } },
            },
          },
        },
      });
    }
    doughnut('c1', CP.issueType.labels, CP.issueType.data);
    doughnut('c2', CP.statusCat.labels, CP.statusCat.data);
    doughnut('c3', CP.priority.labels, CP.priority.data);

    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose', fontFamily: 'Inter' });

    // Print helpers: ensure charts/diagrams render inside PDF.
    let __printRestore = null;
    function preparePrintAssets() {
      const backups = [];

      // Convert Chart.js canvases to images for reliable printing
      document.querySelectorAll('canvas').forEach((cv) => {
        try {
          const dataUrl = cv.toDataURL('image/png', 1.0);
          if (!dataUrl || dataUrl.length < 32) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.className = 'print-chart-img';
          img.style.display = 'none';
          cv.insertAdjacentElement('afterend', img);
          backups.push(() => img.remove());
        } catch {
          // ignore
        }
      });

      // Mermaid sometimes needs a nudge before print
      try {
        if (window.mermaid?.run) {
          window.mermaid.run({ querySelector: '.mermaid' });
        }
      } catch {
        // ignore
      }

      // In print media, show the generated images and hide canvases
      backups.push(() => {});
      __printRestore = () => backups.forEach((fn) => fn());
    }

    function cleanupPrintAssets() {
      try {
        __printRestore?.();
      } finally {
        __printRestore = null;
      }
      // Remove any leftover print images
      document.querySelectorAll('img.print-chart-img').forEach((img) => img.remove());
    }

    // Animated counters
    function animateValue(el, end, duration) {
      const start = 0;
      const t0 = performance.now();
      function frame(now) {
        const p = Math.min((now - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(start + (end - start) * ease);
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    document.querySelectorAll('.stat-num[data-count]').forEach((el) => {
      const end = parseInt(el.getAttribute('data-count'), 10) || 0;
      animateValue(el, end, 900);
    });

    // Reveal on scroll
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible');
        });
      },
      { threshold: 0.08 },
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    // Search + count
    const q = document.getElementById('q');
    const rc = document.getElementById('result-count');
    function applyFilter() {
      const term = q.value.trim().toLowerCase();
      let n = 0;
      document.querySelectorAll('#full tbody tr').forEach((tr) => {
        const hay = tr.getAttribute('data-search') || '';
        const show = !term || hay.includes(term);
        tr.style.display = show ? '' : 'none';
        if (show) n++;
      });
      rc.textContent = n;
    }
    q.addEventListener('input', applyFilter);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== q) {
        e.preventDefault();
        q.focus();
      }
    });

    // Active nav hint (optional)
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav-pill').forEach((x) => x.classList.remove('text-cyan-400'));
        a.classList.add('text-cyan-400');
      });
    });

    const toast = document.getElementById('print-toast');
    function showToast(on) {
      if (!toast) return;
      toast.classList.toggle('show', !!on);
    }
    document.getElementById('btn-print')?.addEventListener('click', () => {
      showToast(true);
      // Let layout settle (fonts/charts) before print dialog
      setTimeout(() => window.print(), 160);
    });
    window.addEventListener('beforeprint', () => {
      showToast(false);
      document.documentElement.classList.add('is-printing');
      preparePrintAssets();
      // show images for print (CSS handles sizing)
      document.querySelectorAll('canvas').forEach((c) => (c.style.display = 'none'));
      document.querySelectorAll('img.print-chart-img').forEach((i) => (i.style.display = 'block'));
    });
    window.addEventListener('afterprint', () => {
      showToast(false);
      document.documentElement.classList.remove('is-printing');
      // restore canvases
      document.querySelectorAll('canvas').forEach((c) => (c.style.display = ''));
      cleanupPrintAssets();
    });
  </script>
</body>
</html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, 'work-evidence-portfolio.html');
  writeFileSync(outPath, html, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`Open locally: file://${outPath}`);
}

main();
