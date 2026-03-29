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
    'Impact comes from judgment: when to use AI, how to verify output, and what to automate. This portfolio itself is generated from live Jira data — evidence, not vibes.',
  pillars: [
    {
      title: 'Automation & agents',
      body:
        'Used AI-assisted development workflows (e.g. Dr.-Nexus / agent pipelines) to turn tickets into reviewed changes faster, with human gates before merge.',
      accent: 'from-violet-500/20 to-fuchsia-500/10',
    },
    {
      title: 'Review & verification',
      body:
        'Treated model output as draft: tests, PR review, and production validation stay non-negotiable — especially for Blocker and Epic-class work.',
      accent: 'from-cyan-500/20 to-blue-500/10',
    },
    {
      title: 'Data-backed storytelling',
      body:
        'Charts and exports come from the same Jira source of truth as delivery, so performance conversations anchor to shipped work and severity mix.',
      accent: 'from-amber-500/20 to-orange-500/10',
    },
    {
      title: 'Continuous learning',
      body:
        'When an AI shortcut failed, switched to a simpler path — and logged the lesson. Native competency means knowing when not to delegate judgment.',
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

  const aiCardsHtml = aiSection.pillars
    .map(
      (p) => `
    <article class="ai-card bg-gradient-to-br ${p.accent} border border-white/10 rounded-2xl p-5 backdrop-blur-sm hover:border-white/20 transition-all duration-300 hover:-translate-y-0.5">
      <h3 class="text-sm font-semibold text-white/95 tracking-tight mb-2">${escapeHtml(p.title)}</h3>
      <p class="text-sm text-slate-400 leading-relaxed">${escapeHtml(p.body)}</p>
    </article>`,
    )
    .join('');

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
    @media print {
      .no-print { display: none !important; }
      .print-break { break-inside: avoid; }
      main { padding-top: 0.5rem !important; }
      #full-wrap { max-height: none !important; overflow: visible !important; }
      .reveal { opacity: 1 !important; transform: none !important; }
    }
  </style>
</head>
<body class="mesh text-slate-200 min-h-screen antialiased">
  <header class="no-print fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-slate-950/80 backdrop-blur-md print:hidden">
    <div class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <span class="font-semibold text-white tracking-tight">Evidence portfolio</span>
      <div class="flex flex-wrap items-center gap-2">
      <button type="button" id="btn-print" class="no-print text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10 transition-colors">Save as PDF</button>
      <nav class="flex flex-wrap gap-1 text-sm">
        <a href="#overview" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">Overview</a>
        <a href="#ai-native" class="nav-pill px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">AI-native</a>
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
        ${escapeHtml(AI_NATIVE_SECTION.headline)}
      </h2>
      <p class="text-slate-400 mb-8 max-w-3xl leading-relaxed">${escapeHtml(AI_NATIVE_SECTION.lede)}</p>
      <div class="grid sm:grid-cols-2 gap-4">${aiCardsHtml}</div>
    </section>

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

    document.getElementById('btn-print')?.addEventListener('click', () => window.print());
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
