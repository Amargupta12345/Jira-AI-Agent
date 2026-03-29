#!/usr/bin/env node
/**
 * Fetches all pages of a Jira JQL search (enhanced API) and writes:
 *   - review-data/my-tickets-updated-full.json  (merged issues)
 *   - review-data/jira-work-dashboard.html       (interactive charts)
 *
 * Run from repo root: node scripts/jira-review-dashboard.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'review-data');

const { jiraPost } = await import(resolve(ROOT, 'jira-creator/lib/api.mjs'));

const JQL =
  'project = JCP AND assignee = currentUser() AND updated >= -365d ORDER BY updated DESC';
const FIELDS = [
  'summary',
  'status',
  'assignee',
  'labels',
  'priority',
  'issuetype',
  'project',
  'components',
];

async function fetchAllIssues() {
  const all = [];
  let nextPageToken = undefined;
  do {
    const body = { jql: JQL, maxResults: 100, fields: FIELDS };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const data = await jiraPost('/rest/api/3/search/jql', body);
    const chunk = data.issues || [];
    all.push(...chunk);
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  } while (true);
  return all;
}

function countBy(issues, getter) {
  const map = new Map();
  for (const issue of issues) {
    const key = getter(issue) || '(none)';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function toChartData(pairs) {
  const labels = pairs.map(([k]) => k);
  const data = pairs.map(([, v]) => v);
  return { labels, data };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Mermaid labels: keep alphanumeric + spaces to avoid parse issues */
function mermaidSafeLabel(s) {
  return String(s)
    .replace(/["\n\r]/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .slice(0, 48);
}

function buildMermaidFlowchart(total, statusCategoryPairs) {
  const lines = ['flowchart TB', `  root["Total ${total} tickets"]`];
  statusCategoryPairs.forEach(([name, n], i) => {
    lines.push(`  root --> n${i}["${mermaidSafeLabel(name)}: ${n}"]`);
  });
  return lines.join('\n');
}

function buildHtml(issues, meta) {
  const byType = countBy(issues, (i) => i.fields?.issuetype?.name);
  const byStatusCat = countBy(issues, (i) => i.fields?.status?.statusCategory?.name);
  const byStatus = countBy(issues, (i) => i.fields?.status?.name);
  const byPriority = countBy(issues, (i) => i.fields?.priority?.name);
  const byComponent = countBy(issues, (i) => {
    const c = i.fields?.components;
    if (!c?.length) return '(no component)';
    if (c.length === 1) return c[0].name;
    return c.map((x) => x.name).sort().join(' + ');
  });

  const t1 = toChartData(byType);
  const t2 = toChartData(byStatusCat);
  const t3 = toChartData(byPriority);
  const t4 = toChartData(byComponent.slice(0, 12)); // top 12 for readability
  const t5 = toChartData(byStatus.slice(0, 15));

  const palette = [
    '#2563eb',
    '#7c3aed',
    '#db2777',
    '#ea580c',
    '#ca8a04',
    '#16a34a',
    '#0891b2',
    '#4f46e5',
    '#c026d3',
    '#0d9488',
    '#b45309',
    '#64748b',
  ];

  const payload = {
    meta,
    totals: {
      issues: issues.length,
      byIssueType: Object.fromEntries(byType),
      byStatusCategory: Object.fromEntries(byStatusCat),
      byPriority: Object.fromEntries(byPriority),
    },
    charts: {
      issueType: t1,
      statusCategory: t2,
      priority: t3,
      topComponents: t4,
      topStatuses: t5,
    },
  };

  const summaryListHtml = [
    `<li><strong>Total tickets</strong> (in this export): ${issues.length}</li>`,
    ...byStatusCat.map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${v}</li>`),
  ].join('\n    ');

  const mermaidSrc = buildMermaidFlowchart(issues.length, byStatusCat);
  const chartJson = JSON.stringify(payload);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jira work overview (last ~365 days)</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    body { margin: 0; padding: 1.5rem; max-width: 1200px; margin-inline: auto; }
    h1 { font-size: 1.35rem; font-weight: 600; margin-bottom: 0.25rem; }
    .sub { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.25rem; }
    .grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 1rem;
      border: 1px solid #334155;
    }
    .card h2 { font-size: 0.95rem; margin: 0 0 0.75rem; color: #cbd5e1; font-weight: 600; }
    canvas { max-height: 280px; }
    .mermaid-wrap {
      background: #1e293b;
      border-radius: 12px;
      padding: 1rem;
      border: 1px solid #334155;
      margin-top: 1.25rem;
      overflow-x: auto;
    }
    pre.mermaid {
      margin: 0;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      color: #94a3b8;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>Your Jira workload — segmented view</h1>
  <p class="sub">Assignee = you · Project JCP · Updated in the last 365 days · ${escapeHtml(
    String(issues.length),
  )} issues (all pages)</p>
  <p class="sub">Generated: ${escapeHtml(meta.generatedAt)} · Query: <code style="color:#94a3b8">${escapeHtml(
    meta.jql,
  )}</code></p>

  <div class="grid">
    <div class="card"><h2>By issue type</h2><canvas id="c1"></canvas></div>
    <div class="card"><h2>By status category</h2><canvas id="c2"></canvas></div>
    <div class="card"><h2>By priority</h2><canvas id="c3"></canvas></div>
    <div class="card"><h2>By component (top 12)</h2><canvas id="c4"></canvas></div>
    <div class="card" style="grid-column: 1 / -1;"><h2>By workflow status (top 15)</h2><canvas id="c5"></canvas></div>
  </div>

  <div class="mermaid-wrap">
    <h2 style="font-size:0.95rem;margin:0 0 0.5rem;color:#cbd5e1;">Text summary (same data as charts)</h2>
    <ul style="margin:0;padding-left:1.25rem;color:#cbd5e1;font-size:0.9rem;line-height:1.6;">
    ${summaryListHtml}
    </ul>
    <h2 style="font-size:0.95rem;margin:1rem 0 0.5rem;color:#cbd5e1;">Flow diagram — status categories → volume</h2>
    <pre class="mermaid">${mermaidSrc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
  </div>

  <script>
    const P = ${chartJson};
    const palette = ${JSON.stringify(palette)};

    function pie(id, title, labels, data) {
      const ctx = document.getElementById(id);
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: labels.map((_, i) => palette[i % palette.length]),
            borderWidth: 0,
          }],
        },
        options: {
          plugins: {
            legend: { position: 'right', labels: { color: '#cbd5e1', boxWidth: 12 } },
            tooltip: { callbacks: { footer: (items) => {
              const t = items.reduce((s, x) => s + x.parsed, 0);
              const pct = t ? ((items[0].parsed / t) * 100).toFixed(1) : 0;
              return 'Share: ' + pct + '%';
            }}},
          },
        },
      });
    }

    function bar(id, labels, data) {
      const ctx = document.getElementById(id);
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Tickets',
            data,
            backgroundColor: palette[0],
          }],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
            y: { grid: { display: false }, ticks: { color: '#cbd5e1' } },
          },
        },
      });
    }

    const c = P.charts;
    pie('c1', 'type', c.issueType.labels, c.issueType.data);
    pie('c2', 'cat', c.statusCategory.labels, c.statusCategory.data);
    pie('c3', 'pri', c.priority.labels, c.priority.data);
    pie('c4', 'comp', c.topComponents.labels, c.topComponents.data);
    bar('c5', c.topStatuses.labels, c.topStatuses.data);
  </script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });</script>
</body>
</html>`;
}

mkdirSync(OUT_DIR, { recursive: true });

const generatedAt = new Date().toISOString();
console.log('Fetching all matching issues (paginated)...');
const issues = await fetchAllIssues();
console.log(`Fetched ${issues.length} issues.`);

const bundle = {
  meta: {
    jql: JQL,
    generatedAt,
    issueCount: issues.length,
  },
  issues,
};

writeFileSync(
  resolve(OUT_DIR, 'my-tickets-updated-full.json'),
  JSON.stringify(bundle, null, 2),
  'utf8',
);

const html = buildHtml(issues, { jql: JQL, generatedAt });
writeFileSync(resolve(OUT_DIR, 'jira-work-dashboard.html'), html, 'utf8');

console.log(`Wrote ${resolve(OUT_DIR, 'my-tickets-updated-full.json')}`);
console.log(`Wrote ${resolve(OUT_DIR, 'jira-work-dashboard.html')}`);
console.log('Open the HTML file in a browser to view pie / bar charts.');
