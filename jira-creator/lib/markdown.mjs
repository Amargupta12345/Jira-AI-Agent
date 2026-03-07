/**
 * lib/markdown.mjs — Markdown ↔ ADF (Atlassian Document Format) conversion
 *
 * Provides two main exports:
 *   markdownToAdf(md)   — Convert Markdown string to ADF document
 *   adfToMarkdown(adf)  — Convert ADF document to Markdown string
 *
 * Uses `marked` lexer for tokenization (no HTML rendering).
 * Covers the ADF features used in real JCP tickets (headings, tables, panels,
 * code blocks, lists, inline marks, emoji, inlineCard, rules, etc.).
 *
 * See CLAUDE.md "Markdown Support" section for supported syntax.
 */

import { Lexer } from 'marked';

// ─────────────────────────────────────────────────────────────────────
//  Markdown → ADF
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string to an ADF document object.
 * @param {string} md - Markdown source
 * @returns {object} ADF document ({ type: 'doc', version: 1, content: [...] })
 */
export function markdownToAdf(md) {
  if (!md || typeof md !== 'string') {
    return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: md || '' }] }] };
  }

  // Pre-process panel syntax  :::info / :::warning / :::success / :::note / :::error
  // Convert to a token we can detect after lexing
  const panelBlocks = [];
  const panelRe = /^:::(info|warning|success|note|error)\s*\n([\s\S]*?)^:::\s*$/gm;
  let processed = md.replace(panelRe, (_match, panelType, body, offset) => {
    const id = panelBlocks.length;
    panelBlocks.push({ panelType: panelType === 'error' ? 'error' : panelType, body: body.trim() });
    return `<!--panel:${id}-->`;
  });

  const tokens = new Lexer().lex(processed);
  const content = convertBlockTokens(tokens, panelBlocks);

  return {
    type: 'doc',
    version: 1,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  };
}

/**
 * Convert an array of marked block-level tokens to ADF content nodes.
 */
function convertBlockTokens(tokens, panelBlocks) {
  const nodes = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        nodes.push({
          type: 'heading',
          attrs: { level: Math.min(token.depth, 6) },
          content: convertInlineTokens(token.tokens || []),
        });
        break;

      case 'paragraph': {
        // Check for panel placeholder
        const panelMatch = token.raw && token.raw.trim().match(/^<!--panel:(\d+)-->$/);
        if (panelMatch) {
          const panel = panelBlocks[parseInt(panelMatch[1], 10)];
          if (panel) {
            const innerTokens = new Lexer().lex(panel.body);
            const innerContent = convertBlockTokens(innerTokens, panelBlocks);
            nodes.push({
              type: 'panel',
              attrs: { panelType: panel.panelType },
              content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
            });
            break;
          }
        }
        const inlineContent = convertInlineTokens(token.tokens || []);
        if (inlineContent.length > 0) {
          nodes.push({ type: 'paragraph', content: inlineContent });
        }
        break;
      }

      case 'list': {
        const listType = token.ordered ? 'orderedList' : 'bulletList';
        const listNode = { type: listType, content: [] };
        if (token.ordered && token.start !== undefined && token.start !== 1) {
          listNode.attrs = { order: token.start };
        }
        for (const item of token.items) {
          listNode.content.push(convertListItem(item, panelBlocks));
        }
        nodes.push(listNode);
        break;
      }

      case 'table': {
        const tableNode = { type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: [] };

        // Header row
        if (token.header && token.header.length > 0) {
          const headerRow = { type: 'tableRow', content: [] };
          for (const cell of token.header) {
            const cellContent = convertInlineTokens(cell.tokens || []);
            headerRow.content.push({
              type: 'tableHeader',
              attrs: {},
              content: [{ type: 'paragraph', content: cellContent.length > 0 ? cellContent : [{ type: 'text', text: '' }] }],
            });
          }
          tableNode.content.push(headerRow);
        }

        // Body rows
        for (const row of token.rows || []) {
          const tableRow = { type: 'tableRow', content: [] };
          for (const cell of row) {
            const cellContent = convertInlineTokens(cell.tokens || []);
            tableRow.content.push({
              type: 'tableCell',
              attrs: {},
              content: [{ type: 'paragraph', content: cellContent.length > 0 ? cellContent : [{ type: 'text', text: '' }] }],
            });
          }
          tableNode.content.push(tableRow);
        }

        nodes.push(tableNode);
        break;
      }

      case 'code':
        nodes.push({
          type: 'codeBlock',
          attrs: { language: token.lang || null },
          content: [{ type: 'text', text: token.text }],
        });
        break;

      case 'hr':
        nodes.push({ type: 'rule' });
        break;

      case 'blockquote': {
        const innerContent = convertBlockTokens(token.tokens || [], panelBlocks);
        nodes.push({
          type: 'blockquote',
          content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
        });
        break;
      }

      case 'html': {
        // Check for panel placeholders in raw HTML tokens
        const htmlPanelMatch = token.raw && token.raw.trim().match(/^<!--panel:(\d+)-->$/);
        if (htmlPanelMatch) {
          const panel = panelBlocks[parseInt(htmlPanelMatch[1], 10)];
          if (panel) {
            const innerTokens = new Lexer().lex(panel.body);
            const innerContent = convertBlockTokens(innerTokens, panelBlocks);
            nodes.push({
              type: 'panel',
              attrs: { panelType: panel.panelType },
              content: innerContent.length > 0 ? innerContent : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
            });
          }
        }
        // Ignore other HTML
        break;
      }

      case 'space':
        // Skip whitespace tokens
        break;

      default:
        // Fallback: wrap unknown tokens as paragraph with raw text
        if (token.raw && token.raw.trim()) {
          nodes.push({
            type: 'paragraph',
            content: [{ type: 'text', text: token.raw.trim() }],
          });
        }
        break;
    }
  }

  return nodes;
}

/**
 * Convert a list item token to an ADF listItem node.
 * Handles nested lists inside list items.
 */
function convertListItem(item, panelBlocks) {
  const listItem = { type: 'listItem', content: [] };

  // marked puts inline tokens in item.tokens — which may contain paragraphs, nested lists, etc.
  if (item.tokens) {
    for (const child of item.tokens) {
      if (child.type === 'text' && child.tokens) {
        // Inline text content — wrap in paragraph
        const inlineContent = convertInlineTokens(child.tokens);
        if (inlineContent.length > 0) {
          listItem.content.push({ type: 'paragraph', content: inlineContent });
        }
      } else if (child.type === 'list') {
        // Nested list
        const nestedType = child.ordered ? 'orderedList' : 'bulletList';
        const nestedList = { type: nestedType, content: [] };
        if (child.ordered && child.start !== undefined && child.start !== 1) {
          nestedList.attrs = { order: child.start };
        }
        for (const nestedItem of child.items) {
          nestedList.content.push(convertListItem(nestedItem, panelBlocks));
        }
        listItem.content.push(nestedList);
      } else if (child.type === 'paragraph') {
        const inlineContent = convertInlineTokens(child.tokens || []);
        if (inlineContent.length > 0) {
          listItem.content.push({ type: 'paragraph', content: inlineContent });
        }
      } else {
        // Other block-level content inside list item
        const blockNodes = convertBlockTokens([child], panelBlocks);
        listItem.content.push(...blockNodes);
      }
    }
  }

  // Ensure listItem has at least one child
  if (listItem.content.length === 0) {
    listItem.content.push({ type: 'paragraph', content: [{ type: 'text', text: item.text || '' }] });
  }

  return listItem;
}

/**
 * Convert an array of marked inline tokens to ADF inline nodes.
 * Returns an array of { type: 'text', text, marks? } nodes.
 */
function convertInlineTokens(tokens) {
  const nodes = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        // Text might contain nested tokens (from strong/em wrapping)
        if (token.tokens && token.tokens.length > 0) {
          nodes.push(...convertInlineTokens(token.tokens));
        } else {
          const text = token.raw !== undefined ? token.raw : token.text;
          if (text) nodes.push({ type: 'text', text });
        }
        break;
      }

      case 'strong': {
        const children = convertInlineTokens(token.tokens || []);
        for (const child of children) {
          const marks = [...(child.marks || []), { type: 'strong' }];
          nodes.push({ ...child, marks });
        }
        break;
      }

      case 'em': {
        const children = convertInlineTokens(token.tokens || []);
        for (const child of children) {
          const marks = [...(child.marks || []), { type: 'em' }];
          nodes.push({ ...child, marks });
        }
        break;
      }

      case 'del': {
        const children = convertInlineTokens(token.tokens || []);
        for (const child of children) {
          const marks = [...(child.marks || []), { type: 'strike' }];
          nodes.push({ ...child, marks });
        }
        break;
      }

      case 'codespan':
        nodes.push({
          type: 'text',
          text: token.text,
          marks: [{ type: 'code' }],
        });
        break;

      case 'link': {
        // Check if it's a Jira URL → use inlineCard
        if (token.href && /atlassian\.net\/browse\//.test(token.href)) {
          nodes.push({
            type: 'inlineCard',
            attrs: { url: token.href },
          });
        } else {
          const linkChildren = convertInlineTokens(token.tokens || []);
          for (const child of linkChildren) {
            const marks = [...(child.marks || []), { type: 'link', attrs: { href: token.href } }];
            nodes.push({ ...child, marks });
          }
          // If no children, create one from the href
          if (linkChildren.length === 0) {
            nodes.push({ type: 'text', text: token.href, marks: [{ type: 'link', attrs: { href: token.href } }] });
          }
        }
        break;
      }

      case 'image':
        // ADF doesn't have inline images the same way — render as link
        nodes.push({
          type: 'text',
          text: token.text || token.href,
          marks: [{ type: 'link', attrs: { href: token.href } }],
        });
        break;

      case 'br':
        nodes.push({ type: 'hardBreak' });
        break;

      case 'escape':
        nodes.push({ type: 'text', text: token.text });
        break;

      default:
        // Fallback: extract raw text
        if (token.text || token.raw) {
          nodes.push({ type: 'text', text: token.text || token.raw });
        }
        break;
    }
  }

  return nodes;
}


// ─────────────────────────────────────────────────────────────────────
//  ADF → Markdown
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert an ADF document to a Markdown string.
 * @param {object} adf - ADF document ({ type: 'doc', content: [...] })
 * @returns {string} Markdown text
 */
export function adfToMarkdown(adf) {
  if (!adf || !adf.content) return '';
  return renderBlocks(adf.content, '').trim();
}

/**
 * Render an array of ADF block nodes to Markdown.
 * @param {Array} blocks - ADF content nodes
 * @param {string} indent - Current indentation prefix
 * @returns {string}
 */
function renderBlocks(blocks, indent) {
  const parts = [];

  for (let i = 0; i < blocks.length; i++) {
    const node = blocks[i];
    const rendered = renderBlock(node, indent);
    if (rendered !== null) {
      parts.push(rendered);
    }
  }

  return parts.join('\n\n');
}

/**
 * Render a single ADF block node to Markdown.
 */
function renderBlock(node, indent) {
  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      const text = renderInline(node.content || []);
      return `${indent}${prefix} ${text}`;
    }

    case 'paragraph': {
      const text = renderInline(node.content || []);
      return `${indent}${text}`;
    }

    case 'bulletList':
      return renderList(node, indent, false);

    case 'orderedList':
      return renderList(node, indent, true);

    case 'table':
      return renderTable(node, indent);

    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = (node.content || []).map((c) => c.text || '').join('');
      return `${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``;
    }

    case 'rule':
      return `${indent}---`;

    case 'blockquote': {
      const inner = renderBlocks(node.content || [], '');
      return inner.split('\n').map((line) => `${indent}> ${line}`).join('\n');
    }

    case 'panel': {
      const panelType = node.attrs?.panelType || 'info';
      const inner = renderBlocks(node.content || [], '');
      const lines = inner.split('\n');
      const header = `> **${panelType.charAt(0).toUpperCase() + panelType.slice(1)}:**`;
      if (lines.length === 1 && lines[0].trim().length < 80) {
        return `${indent}${header} ${lines[0].trim()}`;
      }
      return `${indent}${header}\n` + lines.map((line) => `${indent}> ${line}`).join('\n');
    }

    case 'mediaSingle':
    case 'mediaGroup': {
      // Render media references as [attachment]
      const mediaNodes = node.content || [];
      return mediaNodes.map((m) => {
        const alt = m.attrs?.alt || 'attachment';
        return `${indent}[${alt}]`;
      }).join('\n');
    }

    case 'expand':
    case 'nestedExpand': {
      const title = node.attrs?.title || 'Details';
      const inner = renderBlocks(node.content || [], '');
      return `${indent}<details>\n${indent}<summary>${title}</summary>\n\n${inner}\n${indent}</details>`;
    }

    default:
      // Fallback: try to extract inline text
      if (node.content) {
        const text = renderInline(node.content);
        if (text) return `${indent}${text}`;
      }
      return null;
  }
}

/**
 * Render an ADF list (ordered or unordered) to Markdown.
 */
function renderList(node, indent, ordered) {
  const items = node.content || [];
  const lines = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const start = node.attrs?.order || 1;
    const bullet = ordered ? `${start + i}. ` : '- ';
    const itemContent = item.content || [];

    // First child becomes the bullet line
    let first = true;
    for (const child of itemContent) {
      if (first && (child.type === 'paragraph' || child.type === 'heading')) {
        const text = renderInline(child.content || []);
        lines.push(`${indent}${bullet}${text}`);
        first = false;
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (first) {
          lines.push(`${indent}${bullet}`);
          first = false;
        }
        const nested = child.type === 'bulletList'
          ? renderList(child, indent + '  ', false)
          : renderList(child, indent + '  ', true);
        lines.push(nested);
      } else {
        if (first) {
          const text = renderBlock(child, '');
          lines.push(`${indent}${bullet}${text || ''}`);
          first = false;
        } else {
          const text = renderBlock(child, indent + '  ');
          if (text) lines.push(text);
        }
      }
    }

    if (first) {
      // Empty list item
      lines.push(`${indent}${bullet}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render an ADF table to Markdown.
 */
function renderTable(node, indent) {
  const rows = node.content || [];
  if (rows.length === 0) return '';

  const tableData = [];

  for (const row of rows) {
    const cells = (row.content || []).map((cell) => {
      const text = renderBlocks(cell.content || [], '').replace(/\n/g, ' ').trim();
      return text;
    });
    tableData.push(cells);
  }

  // Determine column widths
  const colCount = Math.max(...tableData.map((r) => r.length));
  const widths = [];
  for (let c = 0; c < colCount; c++) {
    let max = 3; // minimum width
    for (const row of tableData) {
      const cellLen = (row[c] || '').length;
      if (cellLen > max) max = cellLen;
    }
    widths.push(max);
  }

  const lines = [];
  const isFirstRowHeader = rows[0]?.content?.[0]?.type === 'tableHeader';

  for (let r = 0; r < tableData.length; r++) {
    const cells = tableData[r];
    const paddedCells = [];
    for (let c = 0; c < colCount; c++) {
      const cell = cells[c] || '';
      paddedCells.push(cell.padEnd(widths[c]));
    }
    lines.push(`${indent}| ${paddedCells.join(' | ')} |`);

    // Add separator after header row
    if (r === 0 && isFirstRowHeader) {
      const sep = widths.map((w) => '-'.repeat(w));
      lines.push(`${indent}| ${sep.join(' | ')} |`);
    }
  }

  // If no header was detected, still add separator after first row for valid markdown
  if (!isFirstRowHeader && tableData.length > 0) {
    const sep = widths.map((w) => '-'.repeat(w));
    const sepLine = `${indent}| ${sep.join(' | ')} |`;
    lines.splice(1, 0, sepLine);
  }

  return lines.join('\n');
}

/**
 * Render an array of ADF inline nodes to Markdown text.
 */
function renderInline(nodes) {
  if (!nodes) return '';
  const parts = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        let text = node.text || '';
        const marks = node.marks || [];

        // Apply marks in a stable order: link outermost, then strong, em, code innermost
        // But code should be innermost (no nesting inside code)
        const hasCode = marks.some((m) => m.type === 'code');
        const hasStrong = marks.some((m) => m.type === 'strong');
        const hasEm = marks.some((m) => m.type === 'em');
        const hasStrike = marks.some((m) => m.type === 'strike');
        const link = marks.find((m) => m.type === 'link');

        if (hasCode) {
          text = `\`${text}\``;
        } else {
          if (hasStrike) text = `~~${text}~~`;
          if (hasEm) text = `*${text}*`;
          if (hasStrong) text = `**${text}**`;
        }

        if (link) {
          text = `[${text}](${link.attrs?.href || ''})`;
        }

        // textColor — no markdown equivalent, just render the text
        parts.push(text);
        break;
      }

      case 'hardBreak':
        parts.push('\n');
        break;

      case 'inlineCard': {
        const url = node.attrs?.url || '';
        // Extract ticket key from Jira browse URL
        const ticketMatch = url.match(/\/browse\/([\w-]+)/);
        if (ticketMatch) {
          parts.push(`[${ticketMatch[1]}](${url})`);
        } else {
          parts.push(`[${url}](${url})`);
        }
        break;
      }

      case 'emoji': {
        const shortName = node.attrs?.shortName || node.attrs?.text || '';
        // Map common Atlassian emoji to unicode
        const emojiMap = {
          ':check_mark:': '\u2705',
          ':cross_mark:': '\u274C',
          ':warning:': '\u26A0\uFE0F',
          ':info:': '\u2139\uFE0F',
          ':thumbsup:': '\uD83D\uDC4D',
          ':thumbsdown:': '\uD83D\uDC4E',
          ':star:': '\u2B50',
          ':fire:': '\uD83D\uDD25',
          ':rocket:': '\uD83D\uDE80',
          ':bug:': '\uD83D\uDC1B',
        };
        parts.push(emojiMap[shortName] || shortName);
        break;
      }

      case 'mention': {
        const name = node.attrs?.text || node.attrs?.displayName || 'user';
        parts.push(`@${name}`);
        break;
      }

      case 'status': {
        const statusText = node.attrs?.text || '';
        parts.push(`[${statusText}]`);
        break;
      }

      default:
        if (node.text) parts.push(node.text);
        break;
    }
  }

  return parts.join('');
}
