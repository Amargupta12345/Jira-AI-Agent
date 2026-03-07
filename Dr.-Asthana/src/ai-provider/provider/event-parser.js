/**
 * Provider event parser.
 *
 * Parses newline-delimited stdout events, forwards raw/JSON events to callbacks,
 * and records concise log-summary lines for known provider event formats.
 */

import { log, debug } from '../../utils/logger.js';

/**
 * Parse one stdout line and update summaries/callbacks.
 *
 * @returns {boolean} true when line was valid JSON and counted as an event
 */
export function processOutputLine({ line, onEvent, label, logSummaryLines }) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    if (onEvent) onEvent({ type: 'raw', text: trimmed });
    return false;
  }

  if (onEvent) onEvent(event);
  appendSummaryForEvent(event, label, logSummaryLines);
  return true;
}

function appendSummaryForEvent(event, label, logSummaryLines) {
  switch (event.type) {
    case 'assistant':
      if (event.message?.content) {
        for (const block of event.message.content) {
          switch (block.type) {
            case 'text':
              debug(`[${label}] Response text: ${block.text.substring(0, 200)}...`);
              logSummaryLines.push(`[text] ${block.text}`);
              break;
            case 'tool_use':
              log(`[${label}] Tool: ${block.name}${block.input?.command ? ` — ${block.input.command.substring(0, 80)}` : ''}`);
              logSummaryLines.push(`[tool] ${block.name}${block.input?.command ? `: ${block.input.command.substring(0, 200)}` : ''}`);
              break;
          }
        }
      }
      break;
    case 'result':
      debug(`[${label}] Result event: cost=$${event.cost_usd ?? '?'}, duration=${event.duration_ms ?? '?'}ms, turns=${event.num_turns ?? '?'}`);
      logSummaryLines.push(`[result] cost=$${event.cost_usd ?? '?'}, duration=${event.duration_ms ?? '?'}ms, turns=${event.num_turns ?? '?'}`);
      break;
    case 'item.completed':
      if (event.item) {
        switch (event.item.type) {
          case 'reasoning':
            if (event.item.text) {
              debug(`[${label}] thinking: ${event.item.text}`);
              logSummaryLines.push(`[thinking] ${event.item.text}`);
            }
            break;
          case 'agent_message':
            if (event.item.text) {
              log(`[${label}] agent: ${event.item.text.substring(0, 200)}${event.item.text.length > 200 ? '...' : ''}`);
              logSummaryLines.push(`[agent] ${event.item.text}`);
            }
            break;
          case 'command_execution':
            if (event.item.command) {
              const cmd = event.item.command.replace(/^\/bin\/zsh -lc '(.+)'$/, '$1');
              log(`[${label}] exec: ${cmd.substring(0, 120)}${cmd.length > 120 ? '...' : ''}`);
              logSummaryLines.push(`[exec] ${cmd}`);
              if (event.item.aggregated_output) logSummaryLines.push(event.item.aggregated_output.substring(0, 1000));
            }
            break;
        }
      }
      break;
  }
}
