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

  lines.push(`# JIRA Ticket: ${ticketData.key}`);
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

  return lines.join('\n');
}
