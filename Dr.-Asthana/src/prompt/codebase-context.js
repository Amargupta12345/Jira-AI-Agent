/**
 * Reads the cloned repo directory to build codebase context.
 */

import fs from 'fs';
import path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.tmp', '.pipeline-state', 'dist', 'build',
  'coverage', '.nyc_output', '.cache', '__pycache__', '.next',
]);

/**
 * Build a file tree N levels deep.
 */
function buildFileTree(dir, depth = 2, prefix = '') {
  if (depth <= 0) return '';

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  const lines = [];
  const filtered = entries.filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'));
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of filtered) {
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      lines.push(buildFileTree(path.join(dir, entry.name), depth - 1, prefix + '  '));
    } else {
      lines.push(`${prefix}${entry.name}`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * Read a file if it exists, return contents or null.
 */
function readFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Extract file paths from text (ticket description, comments).
 * Matches patterns like `path/to/file.js`, backtick-quoted paths, and markdown list items.
 */
export function extractFilePaths(text) {
  if (!text) return [];
  const paths = new Set();

  // Match backtick-quoted paths: `server/utils/foo.js`
  for (const m of text.matchAll(/`([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})`/g)) {
    paths.add(m[1]);
  }

  // Match markdown list items starting with a path: - server/utils/foo.js
  for (const m of text.matchAll(/^[\s]*[-*]\s+`?([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})`?/gm)) {
    paths.add(m[1]);
  }

  return [...paths].filter(p => !p.startsWith('.') && p.includes('/'));
}

/**
 * Read referenced files from the clone and format as context.
 * Skips files that don't exist or are too large.
 */
function buildReferencedFilesContext(cloneDir, filePaths, maxPerFile = 2000, maxTotal = 40000) {
  if (!filePaths || filePaths.length === 0) return '';

  const lines = [];
  let totalSize = 0;

  lines.push('## Referenced Files (from ticket)');
  lines.push('');

  for (const relPath of filePaths) {
    if (totalSize >= maxTotal) {
      lines.push(`\n(Truncated — ${maxTotal} char limit reached, remaining files omitted)`);
      break;
    }

    const content = readFileIfExists(path.join(cloneDir, relPath));
    if (content === null) continue;

    const truncated = content.length > maxPerFile;
    const snippet = truncated ? content.substring(0, maxPerFile) : content;
    totalSize += snippet.length;

    lines.push(`### ${relPath}`);
    lines.push('```');
    lines.push(snippet);
    if (truncated) lines.push(`\n... (truncated, ${content.length} chars total)`);
    lines.push('```');
    lines.push('');
  }

  return lines.length > 2 ? lines.join('\n') : '';
}

/**
 * Build codebase context from a cloned repo directory.
 *
 * @param {string} cloneDir - Path to cloned repo
 * @param {object} [options]
 * @param {string[]} [options.referencedFiles] - File paths extracted from ticket to pre-include
 * @returns {string} Markdown string with codebase context
 */
export function buildCodebaseContext(cloneDir, options = {}) {
  const lines = [];

  // Read instruction files — these contain the service's authoritative rules for testing and building
  let hasServiceRules = false;
  for (const f of ['CLAUDE.md', 'CODEX.md', 'codex.md', 'README.md']) {
    const content = readFileIfExists(path.join(cloneDir, f));
    if (content) {
      if (!hasServiceRules) {
        lines.push('## Service Rules (IMPORTANT — follow these for testing and validation)');
        lines.push('');
        hasServiceRules = true;
      }
      lines.push(`### ${f}`);
      lines.push('```');
      lines.push(content.substring(0, 3000));
      lines.push('```');
      lines.push('');
    }
  }

  // File tree (2 levels deep)
  lines.push('## File Tree');
  lines.push('```');
  lines.push(buildFileTree(cloneDir, 2));
  lines.push('```');
  lines.push('');

  // package.json highlights
  const pkgContent = readFileIfExists(path.join(cloneDir, 'package.json'));
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      lines.push('## package.json');
      lines.push('');
      if (pkg.scripts) {
        lines.push('### Scripts');
        lines.push('```json');
        lines.push(JSON.stringify(pkg.scripts, null, 2));
        lines.push('```');
        lines.push('');
      }
      if (pkg.dependencies) {
        lines.push('### Dependencies');
        lines.push(Object.keys(pkg.dependencies).join(', '));
        lines.push('');
      }
      if (pkg.devDependencies) {
        lines.push('### Dev Dependencies');
        lines.push(Object.keys(pkg.devDependencies).join(', '));
        lines.push('');
      }
    } catch { /* invalid JSON */ }
  }

  // Pre-loaded files referenced in the ticket
  if (options.referencedFiles && options.referencedFiles.length > 0) {
    const refContext = buildReferencedFilesContext(cloneDir, options.referencedFiles);
    if (refContext) {
      lines.push(refContext);
    }
  }

  return lines.join('\n');
}
