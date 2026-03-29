#!/usr/bin/env node

/**
 * mcp-server.mjs — Local Sentry MCP Server (stdio transport)
 *
 * Implements the Model Context Protocol over stdin/stdout so Cursor AI
 * can call Sentry tools directly without going through sentry.io's remote MCP.
 *
 * Uses credentials from sentry-config.json (same file as sentry-cli.mjs).
 *
 * Registered in ~/.cursor/mcp.json as:
 *   "sentry": {
 *     "command": "node",
 *     "args": ["/Users/amargupta/Documents/AI-Agent/sentry-alert/mcp-server.mjs"]
 *   }
 *
 * Tools exposed:
 *   sentry_list_projects       — All projects in org
 *   sentry_list_issues         — Unresolved issues for a project
 *   sentry_search_issues       — Search with Sentry query syntax
 *   sentry_get_issue           — Full issue details
 *   sentry_get_latest_event    — Latest event + stack trace for an issue
 *   sentry_list_events         — Recent events for an issue
 *   sentry_resolve_issue       — Mark issue resolved
 *   sentry_ignore_issue        — Mark issue ignored
 *   sentry_unresolve_issue     — Mark issue unresolved
 *   sentry_add_comment         — Add a note to an issue
 *   sentry_list_teams          — All teams in org
 */

import { createInterface } from 'node:readline';
import {
  config, ORG_SLUG, DEFAULT_PROJECT,
  sentryGet, sentryGetList, sentryPost, sentryPut,
} from './lib/api.mjs';
import {
  formatIssue, formatIssueTable, formatProjectTable,
  formatEventTable, formatStackTrace, formatTeamTable,
} from './lib/format.mjs';

// ── MCP Protocol helpers ─────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function textContent(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function jsonContent(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ── Tool definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'sentry_list_projects',
    description: 'List all Sentry projects in the organisation.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Return raw JSON instead of formatted table' },
      },
      required: [],
    },
  },
  {
    name: 'sentry_list_issues',
    description: 'List unresolved issues for a Sentry project, sorted by most recent.',
    inputSchema: {
      type: 'object',
      properties: {
        projectSlug: { type: 'string', description: `Sentry project slug (default: ${DEFAULT_PROJECT || 'required'})` },
        query:       { type: 'string', description: 'Sentry search query (default: "is:unresolved")' },
        environment: { type: 'string', description: 'Filter by environment, e.g. "production"' },
        limit:       { type: 'number', description: 'Max issues to return (default: 25)' },
        json:        { type: 'boolean', description: 'Return raw JSON' },
      },
      required: [],
    },
  },
  {
    name: 'sentry_search_issues',
    description: 'Search Sentry issues using Sentry query syntax (e.g. "is:unresolved level:fatal TypeError").',
    inputSchema: {
      type: 'object',
      properties: {
        projectSlug: { type: 'string', description: 'Sentry project slug' },
        query:       { type: 'string', description: 'Sentry search query string' },
        environment: { type: 'string', description: 'Filter by environment' },
        limit:       { type: 'number', description: 'Max results (default: 25)' },
        json:        { type: 'boolean', description: 'Return raw JSON' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sentry_get_issue',
    description: 'Get full details for a specific Sentry issue by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
        json:    { type: 'boolean', description: 'Return raw JSON' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_get_latest_event',
    description: 'Get the latest event for a Sentry issue, including full stack trace, breadcrumbs, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
        json:    { type: 'boolean', description: 'Return raw JSON event object' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_list_events',
    description: 'List recent events (occurrences) for a Sentry issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
        limit:   { type: 'number', description: 'Max events to return (default: 25)' },
        json:    { type: 'boolean', description: 'Return raw JSON' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_resolve_issue',
    description: 'Mark a Sentry issue as resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_ignore_issue',
    description: 'Mark a Sentry issue as ignored.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_unresolve_issue',
    description: 'Mark a previously resolved Sentry issue as unresolved again.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
      },
      required: ['issueId'],
    },
  },
  {
    name: 'sentry_add_comment',
    description: 'Add a comment/note to a Sentry issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Sentry numeric issue ID' },
        text:    { type: 'string', description: 'Comment text (plain text or Markdown)' },
      },
      required: ['issueId', 'text'],
    },
  },
  {
    name: 'sentry_list_teams',
    description: 'List all teams in the Sentry organisation.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Return raw JSON' },
      },
      required: [],
    },
  },
];

// ── Tool execution ───────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {

    case 'sentry_list_projects': {
      const projects = await sentryGetList(`/organizations/${ORG_SLUG}/projects/`, { all_projects: 1 });
      if (args.json) return jsonContent(projects);
      return textContent(formatProjectTable(projects));
    }

    case 'sentry_list_issues': {
      const project = args.projectSlug || DEFAULT_PROJECT;
      if (!project) throw new Error('projectSlug is required (or set defaultProject in sentry-config.json)');
      const query = args.query || 'is:unresolved';
      const params = { query, limit: args.limit || 25, sort: 'date' };
      if (args.environment) params.environment = args.environment;
      const issues = await sentryGetList(`/projects/${ORG_SLUG}/${project}/issues/`, params);
      if (args.json) return jsonContent(issues);
      return textContent(`Project: ${project}\n\n${formatIssueTable(issues)}`);
    }

    case 'sentry_search_issues': {
      const project = args.projectSlug || DEFAULT_PROJECT;
      if (!project) throw new Error('projectSlug is required');
      const params = { query: args.query, limit: args.limit || 25, sort: 'date' };
      if (args.environment) params.environment = args.environment;
      const issues = await sentryGetList(`/projects/${ORG_SLUG}/${project}/issues/`, params);
      if (args.json) return jsonContent(issues);
      return textContent(`Search: "${args.query}" in ${project}\n\n${formatIssueTable(issues)}`);
    }

    case 'sentry_get_issue': {
      const issue = await sentryGet(`/issues/${args.issueId}/`);
      if (args.json) return jsonContent(issue);
      return textContent(formatIssue(issue));
    }

    case 'sentry_get_latest_event': {
      const event = await sentryGet(`/issues/${args.issueId}/events/latest/`);
      if (args.json) return jsonContent(event);
      return textContent(
        `Latest event for issue ${args.issueId}:\n${'─'.repeat(70)}\n\n${formatStackTrace(event)}`
      );
    }

    case 'sentry_list_events': {
      const list = await sentryGetList(`/issues/${args.issueId}/events/`, { limit: args.limit || 25 });
      if (args.json) return jsonContent(list);
      return textContent(`Events for issue ${args.issueId}:\n\n${formatEventTable(list)}`);
    }

    case 'sentry_resolve_issue': {
      await sentryPut(`/issues/${args.issueId}/`, { status: 'resolved' });
      return textContent(`Resolved: issue ${args.issueId}`);
    }

    case 'sentry_ignore_issue': {
      await sentryPut(`/issues/${args.issueId}/`, { status: 'ignored' });
      return textContent(`Ignored: issue ${args.issueId}`);
    }

    case 'sentry_unresolve_issue': {
      await sentryPut(`/issues/${args.issueId}/`, { status: 'unresolved' });
      return textContent(`Unresolved: issue ${args.issueId}`);
    }

    case 'sentry_add_comment': {
      const result = await sentryPost(`/issues/${args.issueId}/notes/`, { text: args.text });
      return textContent(`Comment added (id: ${result?.id || '?'}) on issue ${args.issueId}`);
    }

    case 'sentry_list_teams': {
      const list = await sentryGetList(`/organizations/${ORG_SLUG}/teams/`);
      if (args.json) return jsonContent(list);
      return textContent(formatTeamTable(list));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP request router ───────────────────────────────────────────────

async function handleRequest(msg) {
  const { method, params, id } = msg;

  // Notifications have no id — just acknowledge silently
  if (id === undefined || id === null) return;

  try {
    switch (method) {
      case 'initialize':
        ok(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sentry-alert', version: '1.0.0' },
        });
        break;

      case 'tools/list':
        ok(id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        if (!name) {
          fail(id, -32602, 'Missing tool name');
          return;
        }
        try {
          const result = await callTool(name, args || {});
          ok(id, result);
        } catch (err) {
          // Tool errors go back as content (not protocol errors) so Cursor shows them inline
          ok(id, textContent(`Error: ${err.message}`));
        }
        break;
      }

      case 'ping':
        ok(id, {});
        break;

      default:
        fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    fail(id, -32603, `Internal error: ${err.message}`);
  }
}

// ── Stdio loop ───────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  await handleRequest(msg);
});

rl.on('close', () => process.exit(0));

// Suppress unhandled promise rejections from surfacing as noise on stderr
process.on('unhandledRejection', () => {});
