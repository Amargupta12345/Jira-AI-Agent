/**
 * AI Summariser wrapper.
 *
 * Uses the local `aisum` CLI with presets and falls back to hard truncation.
 * Presets: jira-title (255), jira-description (32000), jira-comment (32000),
 *          slack-message (500), pr-title (120), pr-description (2500)
 */

import { execFileSync } from 'child_process';
import { warn } from './logger.js';

function hardTruncate(text, maxChars) {
  if (!text) return '';
  if (!maxChars || text.length <= maxChars) return text;
  return text.substring(0, Math.max(0, maxChars - 3)) + '...';
}

function runAisum(args, input) {
  try {
    return execFileSync('aisum', args, {
      input,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(err?.message || 'aisum failed');
  }
}

/**
 * Summarise text to stay within length limits while preserving detail.
 *
 * @param {string} text
 * @param {object} opts
 * @param {string} [opts.preset] - aisum preset (jira-title, jira-comment, slack-message, pr-title, pr-description)
 * @param {number} [opts.limit] - raw character limit (alternative to preset)
 * @param {string} [opts.label='text'] - label for logs
 * @returns {string}
 */
export function summariseText(text, { preset, limit, label = 'text' } = {}) {
  if (!text) return '';

  // Determine effective limit for short-circuit check
  const PRESET_LIMITS = {
    'jira-title': 255,
    'jira-description': 32000,
    'jira-comment': 32000,
    'slack-message': 500,
    'pr-title': 120,
    'pr-description': 2500,
  };
  const effectiveLimit = limit || (preset ? PRESET_LIMITS[preset] : null);

  if (effectiveLimit && text.length <= effectiveLimit) {
    return text;
  }

  const args = [];
  if (preset) {
    args.push('--preset', preset);
  } else if (limit) {
    args.push('--limit', String(limit));
  } else {
    // No constraint specified, return as-is
    return text;
  }

  try {
    const output = runAisum(args, text).trim();
    if (!output) {
      throw new Error('empty summariser output');
    }
    if (effectiveLimit && output.length > effectiveLimit) {
      warn(`Summariser exceeded limit for ${label} (${output.length} > ${effectiveLimit}); applying hard cap`);
      return hardTruncate(output, effectiveLimit);
    }
    return output;
  } catch (error) {
    warn(`Summariser failed for ${label}: ${error.message}. Falling back to hard truncation.`);
    return hardTruncate(text, effectiveLimit);
  }
}
