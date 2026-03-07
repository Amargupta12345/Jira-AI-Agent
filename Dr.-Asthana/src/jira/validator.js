/**
 * Ticket validation — single guard for all pre-processing checks.
 *
 * Consolidates:
 * - Structural checks (affected systems, fix versions present)
 * - Content checks (summary, description, comments)
 * - Config checks (known services)
 * - Scope checks (single service, single version)
 *
 * Called once by the pipeline before any cloning or AI work begins.
 */

import { getServiceConfig } from '../utils/config.js';

/**
 * Validate a parsed ticket is ready for processing.
 * Returns an array of error strings. Empty array = valid.
 *
 * @param {object} config - Full config object
 * @param {object} ticket - Parsed ticket from jira/parser.js
 * @returns {string[]} Array of validation error messages
 */
export function validateTicket(config, ticket) {
  const errors = [];

  // --- Content checks ---

  if (!ticket.summary || ticket.summary === 'No summary') {
    errors.push('Ticket has no summary');
  }

  if (!ticket.description || ticket.description === 'No description provided') {
    if (!ticket.comments || ticket.comments.length === 0) {
      errors.push('Ticket has no description and no comments');
    }
  }

  // --- Structural checks ---

  if (!ticket.affectedSystems || ticket.affectedSystems.length === 0) {
    errors.push('No Affected Systems specified');
  }

  if (!ticket.targetBranch) {
    errors.push('No Fix Version specified');
  }

  // --- Scope checks ---

  if (ticket.affectedSystems && ticket.affectedSystems.length > 1) {
    errors.push(
      `Multiple Affected Systems not supported (found ${ticket.affectedSystems.length}: ${ticket.affectedSystems.join(', ')}). Split into separate tickets.`
    );
  }

  if (ticket.targetBranches && ticket.targetBranches.length > 1) {
    errors.push(
      `Multiple Fix Versions not supported (found ${ticket.targetBranches.length}: ${ticket.targetBranches.map(tb => tb.versionName).join(', ')}). Split into separate tickets.`
    );
  }

  // --- Config checks ---

  if (ticket.affectedSystems) {
    for (const system of ticket.affectedSystems) {
      const serviceConfig = getServiceConfig(config, system);
      if (!serviceConfig) {
        errors.push(`Unknown service: ${system}. Supported: ${Object.keys(config.services).join(', ')}`);
      }
    }
  }

  return errors;
}
