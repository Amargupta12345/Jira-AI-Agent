/**
 * lib/format.mjs — Human-readable output formatters
 *
 * Used by sentry-cli.mjs (terminal output) and mcp-server.mjs (text blocks).
 */

// ── Issues ───────────────────────────────────────────────────────────

/**
 * Format a single Sentry issue as a readable block.
 */
export function formatIssue(issue) {
  const lines = [];
  lines.push(`${issue.id}: ${issue.title}`);
  lines.push('─'.repeat(70));
  lines.push(`  Status:      ${issue.status}`);
  lines.push(`  Level:       ${issue.level}`);
  lines.push(`  Culprit:     ${issue.culprit || '(none)'}`);
  lines.push(`  Project:     ${issue.project?.slug || '(unknown)'}`);
  lines.push(`  First seen:  ${issue.firstSeen ? new Date(issue.firstSeen).toLocaleString() : '—'}`);
  lines.push(`  Last seen:   ${issue.lastSeen ? new Date(issue.lastSeen).toLocaleString() : '—'}`);
  lines.push(`  Times seen:  ${issue.count || '0'} event(s)`);
  lines.push(`  Assignee:    ${issue.assignedTo?.name || issue.assignedTo?.email || 'Unassigned'}`);

  if (issue.tags?.length) {
    const tagStr = issue.tags.slice(0, 5).map((t) => `${t.key}:${t.value}`).join('  ');
    lines.push(`  Tags:        ${tagStr}`);
  }

  lines.push('');
  lines.push(`  URL: ${issue.permalink || `https://sentry.io/issues/${issue.id}/`}`);
  return lines.join('\n');
}

/**
 * Format a list of issues as a compact table.
 */
export function formatIssueTable(issues) {
  if (!issues.length) return 'No issues found.';

  const lines = [];
  lines.push(`Found ${issues.length} issue(s)\n`);
  lines.push(
    '  ID             Level    Status       Last Seen   Count  Title'
  );
  lines.push(
    '  ─────────────  ───────  ───────────  ──────────  ─────  ─────────────────────────────────────'
  );

  for (const issue of issues) {
    const id = String(issue.id).padEnd(13);
    const level = (issue.level || '').padEnd(7);
    const status = (issue.status || '').padEnd(11);
    const lastSeen = issue.lastSeen
      ? new Date(issue.lastSeen).toISOString().slice(0, 10)
      : '—';
    const count = String(issue.count || 0).padStart(5);
    const title = issue.title?.length > 50
      ? issue.title.slice(0, 47) + '...'
      : (issue.title || '');
    lines.push(`  ${id}  ${level}  ${status}  ${lastSeen}  ${count}  ${title}`);
  }

  return lines.join('\n');
}

// ── Projects ─────────────────────────────────────────────────────────

/**
 * Format a list of projects as a compact table.
 */
export function formatProjectTable(projects) {
  if (!projects.length) return 'No projects found.';

  const lines = [];
  lines.push(`Found ${projects.length} project(s)\n`);
  lines.push('  Slug                         Name                          Platform');
  lines.push('  ───────────────────────────  ────────────────────────────  ────────────');

  for (const p of projects) {
    const slug = (p.slug || '').padEnd(27);
    const name = (p.name || '').padEnd(28);
    const platform = p.platform || '—';
    lines.push(`  ${slug}  ${name}  ${platform}`);
  }

  return lines.join('\n');
}

// ── Events ───────────────────────────────────────────────────────────

/**
 * Format an event list as a compact table.
 */
export function formatEventTable(events) {
  if (!events.length) return 'No events found.';

  const lines = [];
  lines.push(`Found ${events.length} event(s)\n`);
  lines.push('  Event ID                          Date                  Message');
  lines.push('  ────────────────────────────────  ────────────────────  ─────────────────────────');

  for (const e of events) {
    const id = (e.eventID || e.id || '').padEnd(32);
    const date = e.dateCreated
      ? new Date(e.dateCreated).toISOString().replace('T', ' ').slice(0, 19)
      : '—';
    const msg = (e.message || e.title || '').slice(0, 40);
    lines.push(`  ${id}  ${date}  ${msg}`);
  }

  return lines.join('\n');
}

// ── Stack traces ─────────────────────────────────────────────────────

/**
 * Render a full stack trace from a Sentry event object.
 * Returns a formatted multi-line string suitable for both terminal and MCP text.
 */
export function formatStackTrace(event) {
  if (!event) return '(no event data)';

  const lines = [];

  // Event header
  lines.push(`Event ID:   ${event.eventID || event.id || '—'}`);
  lines.push(`Date:       ${event.dateCreated ? new Date(event.dateCreated).toLocaleString() : '—'}`);
  lines.push(`Release:    ${event.release || '—'}`);
  lines.push(`Platform:   ${event.platform || '—'}`);

  // Tags summary
  const tags = event.tags || [];
  if (tags.length) {
    const envTag = tags.find((t) => t.key === 'environment');
    const txTag  = tags.find((t) => t.key === 'transaction');
    const urlTag = tags.find((t) => t.key === 'url');
    if (envTag)  lines.push(`Env:        ${envTag.value}`);
    if (txTag)   lines.push(`Tx:         ${txTag.value}`);
    if (urlTag)  lines.push(`URL:        ${urlTag.value}`);
  }

  lines.push('');

  // Exception stack traces
  const exceptions = event.exception?.values || [];
  if (!exceptions.length) {
    lines.push('(no exception data in this event)');
    return lines.join('\n');
  }

  for (const exc of exceptions) {
    lines.push(`┌─ ${exc.type || 'Exception'}: ${exc.value || ''}`);

    const frames = exc.stacktrace?.frames;
    if (!frames?.length) {
      lines.push('│  (no stack frames)');
    } else {
      // Show innermost 20 frames (most relevant), reversed to show from top of call stack
      const relevant = frames.slice(-20).reverse();
      for (const f of relevant) {
        const inApp = f.inApp ? '●' : '○';
        const loc = [f.module || f.filename, f.function].filter(Boolean).join(' › ');
        const lineno = f.lineno ? `:${f.lineno}` : '';
        lines.push(`│  ${inApp} ${loc}${lineno}`);
        if (f.context_line?.trim()) {
          lines.push(`│      ${f.context_line.trim()}`);
        }
      }
    }
    lines.push('└' + '─'.repeat(69));
    lines.push('');
  }

  // Breadcrumbs (last 10)
  const crumbs = event.breadcrumbs?.values || [];
  if (crumbs.length) {
    lines.push('Breadcrumbs (last 10):');
    for (const c of crumbs.slice(-10)) {
      const ts = c.timestamp ? new Date(c.timestamp * 1000).toISOString().slice(11, 19) : '—';
      const msg = (c.message || c.data?.url || '').slice(0, 60);
      lines.push(`  [${ts}] ${c.type || c.category || '—'}: ${msg}`);
    }
  }

  return lines.join('\n');
}

// ── Teams ────────────────────────────────────────────────────────────

export function formatTeamTable(teams) {
  if (!teams.length) return 'No teams found.';

  const lines = [];
  lines.push(`Found ${teams.length} team(s)\n`);
  lines.push('  Slug                         Name');
  lines.push('  ───────────────────────────  ─────────────────────────');

  for (const t of teams) {
    const slug = (t.slug || '').padEnd(27);
    lines.push(`  ${slug}  ${t.name || ''}`);
  }

  return lines.join('\n');
}
