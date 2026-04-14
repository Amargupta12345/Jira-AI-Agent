/**
 * HTML report generator for weekly productivity reports.
 *
 * Produces a fully self-contained single-file HTML with:
 *   - Summary metric cards (with week-over-week delta badges)
 *   - Jira resolved + in-progress ticket tables
 *   - Azure DevOps PR table with AI badges
 *   - AI-native metrics section (tool breakdown, assist rate)
 *   - Activity sparkline (commits per day)
 *   - Printable, no external dependencies
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(label, color) {
  return `<span class="badge badge--${color}">${esc(label)}</span>`;
}

function typeBadge(type) {
  const map = {
    'Bug': 'red', 'Story': 'violet', 'Task': 'slate',
    'Epic': 'orange', 'Sub-task': 'gray',
  };
  return badge(type, map[type] || 'slate');
}

function prioBadge(pri) {
  const map = { 'Blocker': 'red', 'Critical': 'orange', 'High': 'yellow', 'Medium': 'blue', 'Low': 'slate' };
  return badge(pri, map[pri] || 'slate');
}

function statusBadge(status, cat) {
  if (cat === 'done')          return badge(status, 'green');
  if (cat === 'indeterminate') return badge(status, 'blue');
  return badge(status, 'slate');
}

function aiToolBadge(tool) {
  if (!tool) return '';
  const map = { 'Claude': 'violet', 'Codex': 'blue', 'Cursor': 'cyan' };
  return badge(tool, map[tool] || 'slate');
}

function prStatusBadge(status) {
  if (status === 'completed') return badge('Merged', 'green');
  if (status === 'active')    return badge('Open', 'blue');
  if (status === 'abandoned') return badge('Abandoned', 'slate');
  return badge(status, 'slate');
}

function delta(curr, prev) {
  if (prev === undefined || prev === null) return '';
  const diff = curr - prev;
  if (diff === 0) return `<span class="delta delta--neutral">→ same</span>`;
  if (diff > 0)   return `<span class="delta delta--up">▲ +${diff}</span>`;
  return `<span class="delta delta--down">▼ ${diff}</span>`;
}

// ISO week label: e.g. "2026-W15"
function weekLabel(from) {
  const d = new Date(from);
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 4);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatDateRange(from, to) {
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${new Date(from).toLocaleDateString('en-US', opts)} – ${new Date(to).toLocaleDateString('en-US', opts)}`;
}

// ── Section builders ───────────────────────────────────────────────────────────

function buildSummaryCards(jira, azure, prev) {
  const j = jira.summary;
  const a = azure.summary;
  const p = prev || {};
  const pj = p.jira?.summary || {};
  const pa = p.azure?.summary || {};

  const cards = [
    {
      label: 'Tickets Resolved',
      value: j.resolved,
      sub: j.storyPointsResolved > 0 ? `${j.storyPointsResolved} SP` : null,
      icon: '✅',
      color: 'green',
      d: delta(j.resolved, pj.resolved),
    },
    {
      label: 'PRs Merged',
      value: a.mergedPRs,
      sub: a.activePRs > 0 ? `+${a.activePRs} open` : null,
      icon: '🔀',
      color: 'blue',
      d: delta(a.mergedPRs, pa.mergedPRs),
    },
    {
      label: 'Commits',
      value: a.totalCommits,
      sub: null,
      icon: '📝',
      color: 'orange',
      d: delta(a.totalCommits, pa.totalCommits),
    },
    {
      label: 'AI Assist Rate',
      value: a.totalPRs > 0 ? `${a.aiAssistRate}%` : '—',
      sub: a.aiPRs > 0 ? `${a.aiPRs} of ${a.totalPRs} PRs` : null,
      icon: '🤖',
      color: 'violet',
      d: delta(a.aiAssistRate, pa.aiAssistRate),
    },
  ];

  return `
<div class="cards-row">
  ${cards.map(c => `
  <div class="card card--${c.color}">
    <div class="card__icon">${c.icon}</div>
    <div class="card__value">${esc(String(c.value))}</div>
    <div class="card__label">${esc(c.label)}</div>
    ${c.sub ? `<div class="card__sub">${esc(c.sub)}</div>` : ''}
    ${c.d ? `<div class="card__delta">${c.d}</div>` : ''}
  </div>`).join('')}
</div>`;
}

function buildJiraSection(jira, siteUrl) {
  const base = siteUrl.replace(/\/$/, '');

  const resolvedRows = jira.resolved.map(r => `
    <tr>
      <td><a href="${base}/browse/${esc(r.key)}" target="_blank" class="ticket-link">${esc(r.key)}</a></td>
      <td class="summary-cell">${esc(r.summary)}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${prioBadge(r.priority)}</td>
      <td class="sp-cell">${r.sp > 0 ? r.sp : '—'}</td>
    </tr>`).join('');

  const inProgressRows = jira.inProgress.map(r => `
    <tr>
      <td><a href="${base}/browse/${esc(r.key)}" target="_blank" class="ticket-link">${esc(r.key)}</a></td>
      <td class="summary-cell">${esc(r.summary)}</td>
      <td>${typeBadge(r.type)}</td>
      <td>${statusBadge(r.status, r.statusCat)}</td>
      <td class="sp-cell">${r.sp > 0 ? r.sp : '—'}</td>
    </tr>`).join('');

  return `
<section class="section">
  <h2 class="section-title">🎯 Jira Work</h2>

  <h3 class="sub-title">Resolved this week (${jira.resolved.length})</h3>
  ${jira.resolved.length === 0
    ? '<p class="empty">No tickets resolved this week.</p>'
    : `<div class="table-wrap"><table>
        <thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Priority</th><th>SP</th></tr></thead>
        <tbody>${resolvedRows}</tbody>
      </table></div>`}

  <h3 class="sub-title" style="margin-top:1.5rem">In Progress (${jira.inProgress.length})</h3>
  ${jira.inProgress.length === 0
    ? '<p class="empty">Nothing in progress.</p>'
    : `<div class="table-wrap"><table>
        <thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Status</th><th>SP</th></tr></thead>
        <tbody>${inProgressRows}</tbody>
      </table></div>`}
</section>`;
}

function buildPRSection(azure) {
  if (azure.skipped) {
    return `
<section class="section">
  <h2 class="section-title">🔀 Pull Requests &amp; Commits</h2>
  <p class="empty">⚠️ ${esc(azure.reason)}</p>
</section>`;
  }

  const prRows = azure.prs.map(pr => `
    <tr>
      <td class="repo-cell">${esc(pr.repo)}</td>
      <td class="summary-cell"><a href="${esc(pr.url)}" target="_blank" class="ticket-link">#${pr.prId} ${esc(pr.title)}</a></td>
      <td>${prStatusBadge(pr.status)}</td>
      <td>${aiToolBadge(pr.aiTool)}</td>
      <td class="date-cell">${esc(pr.createdDate || '—')}</td>
    </tr>`).join('');

  // Commits by repo mini-table
  const repoRows = Object.entries(azure.commitsByRepo)
    .sort((a, b) => b[1] - a[1])
    .map(([repo, count]) => `
    <tr>
      <td>${esc(repo)}</td>
      <td class="num-cell">${count}</td>
      <td><div class="bar-mini" style="width:${Math.min(count * 12, 160)}px"></div></td>
    </tr>`).join('');

  return `
<section class="section">
  <h2 class="section-title">🔀 Pull Requests</h2>
  ${azure.prs.length === 0
    ? '<p class="empty">No PRs created this week.</p>'
    : `<div class="table-wrap"><table>
        <thead><tr><th>Repo</th><th>PR</th><th>Status</th><th>AI</th><th>Created</th></tr></thead>
        <tbody>${prRows}</tbody>
      </table></div>`}

  ${azure.commits.length > 0 ? `
  <h3 class="sub-title" style="margin-top:1.5rem">Commits by Repo</h3>
  <div class="table-wrap"><table>
    <thead><tr><th>Repo</th><th>#</th><th></th></tr></thead>
    <tbody>${repoRows}</tbody>
  </table></div>` : ''}
</section>`;
}

function buildAiSection(azure, jira) {
  if (azure.skipped) return '';

  const s = azure.summary;
  const byTool = azure.byTool || {};

  const toolColors = { Claude: '#8b5cf6', Codex: '#3b82f6', Cursor: '#06b6d4' };
  const totalAiPRs = Object.values(byTool).reduce((a, b) => a + b, 0);

  const toolBars = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => {
      const pct = totalAiPRs > 0 ? Math.round((count / totalAiPRs) * 100) : 0;
      const color = toolColors[tool] || '#64748b';
      return `
      <div class="tool-row">
        <div class="tool-name">${esc(tool)}</div>
        <div class="tool-bar-wrap">
          <div class="tool-bar" style="width:${pct}%; background:${color}"></div>
        </div>
        <div class="tool-count">${count}</div>
      </div>`;
    }).join('');

  // Activity sparkline data
  const sparkData = Object.entries(azure.commitsByDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, n]) => ({ date, n }));

  const maxN = Math.max(...sparkData.map(d => d.n), 1);
  const sparkW = 8;
  const sparkH = 40;
  const sparkBars = sparkData.map((d, i) => {
    const h = Math.max(4, Math.round((d.n / maxN) * sparkH));
    return `<rect x="${i * (sparkW + 2)}" y="${sparkH - h}" width="${sparkW}" height="${h}" rx="2" fill="#3b82f6" opacity="0.8">
      <title>${d.date}: ${d.n} commit${d.n !== 1 ? 's' : ''}</title></rect>`;
  }).join('');
  const svgW = sparkData.length * (sparkW + 2);

  return `
<section class="section">
  <h2 class="section-title">🤖 AI-Native Metrics</h2>
  <div class="ai-grid">
    <div class="ai-stat-card">
      <div class="ai-stat-value">${s.aiPRs}</div>
      <div class="ai-stat-label">AI-Assisted PRs</div>
    </div>
    <div class="ai-stat-card">
      <div class="ai-stat-value">${s.aiAssistRate}%</div>
      <div class="ai-stat-label">AI Assist Rate</div>
    </div>
    <div class="ai-stat-card">
      <div class="ai-stat-value">${s.cursorCommits}</div>
      <div class="ai-stat-label">Cursor Commits</div>
    </div>
    <div class="ai-stat-card">
      <div class="ai-stat-value">${Object.keys(byTool).length || '—'}</div>
      <div class="ai-stat-label">Tools Used</div>
    </div>
  </div>

  ${totalAiPRs > 0 ? `
  <h3 class="sub-title" style="margin-top:1.5rem">Tool Breakdown</h3>
  <div class="tool-breakdown">${toolBars}</div>` : ''}

  ${sparkData.length > 0 ? `
  <h3 class="sub-title" style="margin-top:1.5rem">Commit Activity</h3>
  <div class="spark-wrap">
    <svg width="${svgW || 10}" height="${sparkH}" class="sparkline">${sparkBars}</svg>
    <div class="spark-labels">
      ${sparkData.length > 0 ? `<span>${sparkData[0].date}</span>` : ''}
      ${sparkData.length > 1 ? `<span>${sparkData[sparkData.length - 1].date}</span>` : ''}
    </div>
  </div>` : ''}
</section>`;
}

// ── CSS ────────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117;
    --bg2: #161b27;
    --card: rgba(255,255,255,0.04);
    --border: rgba(255,255,255,0.08);
    --text: #e2e8f0;
    --text2: #94a3b8;
    --text3: #64748b;
    --green: #22c55e; --green-bg: rgba(34,197,94,0.12);
    --blue: #60a5fa;  --blue-bg: rgba(96,165,250,0.12);
    --violet:#a78bfa; --violet-bg:rgba(167,139,250,0.12);
    --orange:#fb923c; --orange-bg:rgba(251,146,60,0.12);
    --red:   #f87171; --red-bg:   rgba(248,113,113,0.12);
    --yellow:#fbbf24; --yellow-bg:rgba(251,191,36,0.12);
    --cyan:  #22d3ee; --cyan-bg:  rgba(34,211,238,0.12);
    --slate: #94a3b8; --slate-bg: rgba(148,163,184,0.12);
    --gray:  #64748b; --gray-bg:  rgba(100,116,139,0.12);
  }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:14px; line-height:1.6; }
  a { color:var(--blue); text-decoration:none; }
  a:hover { text-decoration:underline; }

  /* Layout */
  .wrapper { max-width:1100px; margin:0 auto; padding:2rem 1.5rem; }
  .section { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.5rem; margin-bottom:1.5rem; }

  /* Header */
  .header { margin-bottom:2rem; }
  .header__week { font-size:0.85rem; color:var(--text3); font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:0.3rem; }
  .header__title { font-size:1.8rem; font-weight:700; color:var(--text); margin-bottom:0.2rem; }
  .header__range { font-size:0.9rem; color:var(--text2); }
  .header__meta  { font-size:0.8rem; color:var(--text3); margin-top:0.3rem; }

  /* Summary cards */
  .cards-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; margin-bottom:1.5rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.25rem 1.5rem; position:relative; }
  .card--green  { border-left:3px solid var(--green); }
  .card--blue   { border-left:3px solid var(--blue); }
  .card--orange { border-left:3px solid var(--orange); }
  .card--violet { border-left:3px solid var(--violet); }
  .card__icon { font-size:1.4rem; margin-bottom:0.5rem; }
  .card__value { font-size:2rem; font-weight:700; color:var(--text); line-height:1; }
  .card__label { font-size:0.8rem; color:var(--text2); margin-top:0.25rem; font-weight:500; }
  .card__sub   { font-size:0.75rem; color:var(--text3); margin-top:0.2rem; }
  .card__delta { margin-top:0.5rem; }

  /* Section titles */
  .section-title { font-size:1.05rem; font-weight:700; color:var(--text); margin-bottom:1rem; }
  .sub-title { font-size:0.9rem; font-weight:600; color:var(--text2); margin-bottom:0.75rem; }

  /* Delta badges */
  .delta { font-size:0.75rem; font-weight:600; padding:2px 6px; border-radius:4px; }
  .delta--up      { color:#86efac; background:rgba(34,197,94,0.15); }
  .delta--down    { color:#fca5a5; background:rgba(248,113,113,0.15); }
  .delta--neutral { color:var(--text3); background:var(--slate-bg); }

  /* Type/priority badges */
  .badge { display:inline-block; font-size:0.7rem; font-weight:600; padding:2px 7px; border-radius:4px; letter-spacing:0.02em; }
  .badge--red    { color:var(--red);    background:var(--red-bg); }
  .badge--violet { color:var(--violet); background:var(--violet-bg); }
  .badge--blue   { color:var(--blue);   background:var(--blue-bg); }
  .badge--orange { color:var(--orange); background:var(--orange-bg); }
  .badge--yellow { color:var(--yellow); background:var(--yellow-bg); }
  .badge--green  { color:var(--green);  background:var(--green-bg); }
  .badge--cyan   { color:var(--cyan);   background:var(--cyan-bg); }
  .badge--slate  { color:var(--slate);  background:var(--slate-bg); }
  .badge--gray   { color:var(--gray);   background:var(--gray-bg); }

  /* Tables */
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; }
  th { font-size:0.72rem; font-weight:600; color:var(--text3); text-transform:uppercase; letter-spacing:0.06em; padding:8px 10px; text-align:left; border-bottom:1px solid var(--border); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:rgba(255,255,255,0.02); }
  .ticket-link { color:var(--blue); font-weight:500; }
  .summary-cell { max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .repo-cell   { white-space:nowrap; font-size:0.8rem; color:var(--text2); }
  .sp-cell     { text-align:right; color:var(--text2); font-size:0.85rem; }
  .num-cell    { text-align:right; color:var(--text2); width:50px; }
  .date-cell   { white-space:nowrap; color:var(--text3); font-size:0.8rem; }

  /* Mini bar */
  .bar-mini { height:6px; background:rgba(96,165,250,0.5); border-radius:3px; }

  /* AI section */
  .ai-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1rem; }
  .ai-stat-card { background:rgba(167,139,250,0.05); border:1px solid rgba(167,139,250,0.15); border-radius:10px; padding:1rem; text-align:center; }
  .ai-stat-value { font-size:2rem; font-weight:700; color:var(--violet); }
  .ai-stat-label { font-size:0.78rem; color:var(--text2); margin-top:0.3rem; }

  .tool-breakdown { display:flex; flex-direction:column; gap:0.6rem; max-width:500px; }
  .tool-row { display:flex; align-items:center; gap:0.75rem; }
  .tool-name { width:70px; font-size:0.82rem; font-weight:600; color:var(--text2); }
  .tool-bar-wrap { flex:1; background:rgba(255,255,255,0.06); border-radius:4px; height:8px; overflow:hidden; }
  .tool-bar { height:8px; border-radius:4px; transition:width 0.3s; }
  .tool-count { width:30px; text-align:right; font-size:0.82rem; color:var(--text2); }

  /* Sparkline */
  .spark-wrap { overflow-x:auto; padding:0.5rem 0; }
  .sparkline { display:block; }
  .spark-labels { display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text3); margin-top:4px; }

  /* Empty state */
  .empty { color:var(--text3); font-size:0.875rem; padding:0.5rem 0; }

  /* Footer */
  .footer { text-align:center; color:var(--text3); font-size:0.75rem; margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); }

  /* Print */
  @media print {
    body { background:#fff; color:#000; }
    .section { border:1px solid #e2e8f0; background:#fff; break-inside:avoid; }
    a { color:#2563eb; }
    .card { border-left:3px solid #94a3b8 !important; background:#f8fafc; }
    .card__value { color:#1e293b; }
  }
`;

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Generate a self-contained HTML report for one week.
 *
 * @param {object} opts
 * @param {object} opts.jira         Output of fetchWeeklyJiraData()
 * @param {object} opts.azure        Output of fetchWeeklyAzureData()
 * @param {string} opts.weekFrom     ISO date "YYYY-MM-DD"
 * @param {string} opts.weekTo       ISO date "YYYY-MM-DD"
 * @param {object} [opts.prev]       Last week's saved snapshot (for deltas)
 * @returns {string}  Full HTML document
 */
export function generateReport({ jira, azure, weekFrom, weekTo, prev }) {
  const label = weekLabel(weekFrom);
  const range = formatDateRange(weekFrom, weekTo);
  const name  = jira?.user?.name || 'Engineer';
  const now   = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Weekly Report — ${esc(label)} — ${esc(name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrapper">

  <header class="header">
    <div class="header__week">${esc(label)}</div>
    <div class="header__title">Weekly Productivity Report</div>
    <div class="header__range">${esc(range)}</div>
    <div class="header__meta">${esc(name)} · Generated ${esc(now)}</div>
  </header>

  ${buildSummaryCards(jira, azure, prev)}

  ${buildJiraSection(jira, jira.siteUrl || 'https://gofynd.atlassian.net')}

  ${buildPRSection(azure)}

  ${buildAiSection(azure, jira)}

  <footer class="footer">
    AI-Agent Weekly Report · ${esc(label)} · ${esc(now)}
  </footer>

</div>
</body>
</html>`;

  return html;
}
