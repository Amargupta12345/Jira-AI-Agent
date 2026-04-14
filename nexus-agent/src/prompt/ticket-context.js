/**
 * Builds prompt section from JIRA ticket data.
 */

/**
 * Build a markdown string with ticket context for debate agents.
 *
 * @param {object} ticketData - Parsed ticket object from jira/parser.js
 * @returns {string} Markdown string with ticket key, summary, description, comments, systems, branch
 */
export function buildTicketContext(ticketData) {
  const lines = [];
  const isBug = ticketData.type && ticketData.type.toLowerCase() === 'bug';

  lines.push(`# JIRA Ticket: ${ticketData.key}`);
  lines.push('');

  // Surface ticket type prominently so all AI agents know the expected behaviour
  lines.push(`## Ticket Type`);
  if (isBug) {
    lines.push(`**BUG** — ${ticketData.priority || 'Normal'} priority`);
    lines.push('');
    lines.push('> This is a bug report. The fix must be minimal and targeted to the root cause.');
    lines.push('> Do NOT refactor unrelated code. Scope is strictly limited to what the stack trace and error imply.');
  } else {
    lines.push(`**${ticketData.type || 'Task'}** — ${ticketData.priority || 'Normal'} priority`);
  }
  lines.push('');

  lines.push(`## Summary`);
  lines.push(ticketData.summary);
  lines.push('');

  lines.push(`## Description`);
  lines.push(ticketData.description || 'No description provided');
  lines.push('');

  if (ticketData.comments && ticketData.comments.length > 0) {
    lines.push('## Comments');
    lines.push('');
    for (let i = 0; i < ticketData.comments.length; i++) {
      const c = ticketData.comments[i];
      lines.push(`### Comment ${i + 1} by ${c.author}`);
      lines.push(c.text);
      lines.push('');
    }
  }

  if (ticketData.affectedSystems && ticketData.affectedSystems.length > 0) {
    lines.push(`## Affected Systems`);
    lines.push(ticketData.affectedSystems.join(', '));
    lines.push('');
  }

  if (ticketData.targetBranch) {
    lines.push(`## Target Branch`);
    lines.push(ticketData.targetBranch);
    lines.push('');
  }

  if (ticketData.labels && ticketData.labels.length > 0) {
    const sentryLabel = ticketData.labels.find(l => l.toLowerCase().includes('sentry'));
    if (sentryLabel) {
      lines.push(`## Origin`);
      lines.push('This ticket was auto-created from a **Sentry production error**. ' +
        'The stack trace in the description is the primary source of truth for identifying the root cause.');
      lines.push('');
    }
  }

  return lines.join('\n');
}
