/**
 * Ticket data extraction from raw JIRA responses.
 * Full ADF-to-markdown conversion.
 */

/**
 * Apply ADF text marks as markdown syntax.
 */
function applyMarks(text, marks) {
  if (!marks || !Array.isArray(marks) || marks.length === 0) {
    return text;
  }
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'link':
        result = mark.attrs?.href ? `[${result}](${mark.attrs.href})` : result;
        break;
    }
  }
  return result;
}

/**
 * Extract plain text from Atlassian Document Format (ADF)
 */
function extractTextFromADF(content) {
  if (!Array.isArray(content)) {
    return '';
  }

  const textParts = [];

  for (const node of content) {
    switch (node.type) {
      case 'text':
        if (node.text) textParts.push(applyMarks(node.text, node.marks));
        break;
      case 'hardBreak':
        textParts.push('\n');
        break;
      case 'paragraph':
        if (node.content) {
          textParts.push(extractTextFromADF(node.content));
          textParts.push('\n');
        }
        break;
      case 'bulletList':
        if (node.content) {
          for (const listItem of node.content) {
            textParts.push('- ');
            textParts.push(extractTextFromADF(listItem.content || []));
            textParts.push('\n');
          }
        }
        break;
      case 'orderedList':
        if (node.content) {
          for (let i = 0; i < node.content.length; i++) {
            textParts.push(`${i + 1}. `);
            textParts.push(extractTextFromADF(node.content[i].content || []));
            textParts.push('\n');
          }
        }
        break;
      case 'table':
        if (node.content) {
          const rows = [];
          let isFirstRow = true;
          for (const row of node.content) {
            if (row.type !== 'tableRow' || !row.content) continue;
            const cells = row.content.map((cell) => {
              const cellText = extractTextFromADF(cell.content || []);
              return cellText.replace(/\n/g, ' ').trim();
            });
            rows.push(`| ${cells.join(' | ')} |`);
            if (isFirstRow) {
              rows.push(`| ${cells.map(() => '---').join(' | ')} |`);
              isFirstRow = false;
            }
          }
          textParts.push(rows.join('\n'));
          textParts.push('\n');
        }
        break;
      case 'blockquote':
        textParts.push((extractTextFromADF(node.content || [])).split('\n').map((line) => `> ${line}`).join('\n'));
        textParts.push('\n');
        break;
      case 'panel': {
        const panelType = (node.attrs?.panelType || 'info').toUpperCase();
        textParts.push(`[${panelType}] `);
        textParts.push(extractTextFromADF(node.content || []));
        textParts.push('\n');
        break;
      }
      case 'inlineCard':
        textParts.push(node.attrs?.url || '');
        break;
      case 'mention':
        textParts.push(`@${node.attrs?.text || node.attrs?.id || 'unknown'}`);
        break;
      case 'codeBlock':
        if (node.content) {
          textParts.push('```\n');
          textParts.push(extractTextFromADF(node.content));
          textParts.push('\n```\n');
        }
        break;
      case 'heading':
        if (node.content) {
          const level = node.attrs?.level || 1;
          textParts.push('#'.repeat(level) + ' ');
          textParts.push(extractTextFromADF(node.content));
          textParts.push('\n');
        }
        break;
      default:
        if (node.content) {
          textParts.push(extractTextFromADF(node.content));
        }
        break;
    }
  }

  return textParts.join('').trim();
}

export function extractDescription(ticket) {
  const description = ticket.fields?.description;
  if (!description) return 'No description provided';
  if (typeof description === 'string') return description;
  if (description.type === 'doc' && description.content) {
    return extractTextFromADF(description.content);
  }
  return 'No description provided';
}

export function extractComments(ticket) {
  const comments = ticket.fields?.comment?.comments || [];
  return comments.map((comment) => {
    let text = '';
    if (comment.body?.content) {
      text = extractTextFromADF(comment.body.content);
    } else if (typeof comment.body === 'string') {
      text = comment.body;
    }
    return {
      author: comment.author?.displayName || 'Unknown',
      text,
      created: comment.created,
    };
  });
}

export function extractAffectedSystems(config, ticket) {
  const field = config.jira.fields.affectedSystems;
  const affectedSystems = ticket.fields?.[field];
  if (!affectedSystems || !Array.isArray(affectedSystems)) return [];
  return affectedSystems.map((s) => s.value || s.name || s).filter(Boolean);
}

export function extractBranchFromFixVersion(ticket) {
  const fixVersions = ticket.fields?.fixVersions;
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) return null;
  const versionName = fixVersions[0].name || fixVersions[0];
  const match = versionName.match(/v?(\d+\.\d+\.\d+)/i);
  return match ? `version/${match[1]}` : null;
}

export function extractAllBranches(ticket) {
  const fixVersions = ticket.fields?.fixVersions;
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) return [];
  return fixVersions
    .map((fv) => {
      const versionName = fv.name || fv;
      const match = versionName.match(/v?(\d+\.\d+\.\d+)/i);
      if (!match) return null;
      return { branch: `version/${match[1]}`, versionName, version: match[1] };
    })
    .filter(Boolean);
}

export function getFixVersionName(ticket) {
  const fixVersions = ticket.fields?.fixVersions;
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) return null;
  return fixVersions[0].name || fixVersions[0];
}

export function parseTicket(config, ticket) {
  return {
    key: ticket.key,
    summary: ticket.fields?.summary || 'No summary',
    description: extractDescription(ticket),
    comments: extractComments(ticket),
    type: ticket.fields?.issuetype?.name || 'Unknown',
    priority: ticket.fields?.priority?.name || 'None',
    status: ticket.fields?.status?.name || 'Unknown',
    affectedSystems: extractAffectedSystems(config, ticket),
    fixVersion: getFixVersionName(ticket),
    targetBranch: extractBranchFromFixVersion(ticket),
    targetBranches: extractAllBranches(ticket),
    labels: ticket.fields?.labels || [],
  };
}

export function displayTicketDetails(ticket, loggerInstance) {
  const { log } = loggerInstance;
  log('');
  log('== TICKET DETAILS ==');
  log('');
  log(`Key:              ${ticket.key}`);
  log(`Title:            ${ticket.summary}`);
  log(`Type:             ${ticket.type}`);
  log(`Priority:         ${ticket.priority}`);
  log(`Status:           ${ticket.status}`);
  log(`Affected Systems: ${ticket.affectedSystems.join(', ') || 'None'}`);
  log(`Fix Version:      ${ticket.fixVersion || 'None'}`);
  log(`Target Branch:    ${ticket.targetBranch || 'None'}`);
  if (ticket.targetBranches && ticket.targetBranches.length > 1) {
    log(`Fix Versions:     ${ticket.targetBranches.map(tb => tb.versionName).join(', ')}`);
    log(`Target Branches:  ${ticket.targetBranches.map(tb => tb.branch).join(', ')}`);
  }
  log('');
  log(`Description: ${(ticket.description || 'No description').substring(0, 200)}...`);
  log(`Comments: ${ticket.comments.length}`);
  log('');
}
