/**
 * Centralized JIRA UI selector registry.
 *
 * Updated with actual selectors discovered via --inspect on gofynd.atlassian.net.
 */

export const SELECTORS = {
  // ── Issue page ──────────────────────────────────────────────────────
  statusButton: [
    'button[data-testid="issue-field-status.ui.status-view.status-button.status-button"]',
    'button[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"]',
  ],

  // ── Transition dropdown ─────────────────────────────────────────────
  transitionDropdown: [
    '[role="listbox"]',
  ],

  transitionItem: [
    '[role="option"]',
  ],

  // ── Transition screen (modal dialog) ────────────────────────────────
  modal: [
    '[role="dialog"]',
    'section[role="dialog"]',
  ],

  // File input for attachments inside the transition modal
  fileInput: [
    'input[type="file"]',
  ],

  // Drop zone / attachment area inside the modal
  attachmentArea: [
    '[data-testid*="attachment"]',
    '[data-testid*="drop-zone"]',
    '[data-testid*="media-picker"]',
    'div[class*="dropzone"]',
  ],

  // Submit / confirm button on the transition screen
  submitButton: [
    '[role="dialog"] button[type="submit"]',
    '[role="dialog"] button:has-text("Submit")',
    '[role="dialog"] button:has-text("Save")',
    '[role="dialog"] button:has-text("Confirm")',
    'form button[type="submit"]',
  ],

  // ── General helpers ─────────────────────────────────────────────────
  issueLoaded: [
    '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
    '[data-testid*="issue-view"]',
  ],
};

/**
 * Try each selector in `list` against `parentLocator` (a Page or Locator)
 * and return the first one that matches at least one visible element.
 */
export async function findFirst(parent, selectorList, opts = {}) {
  const { timeout = 5000, state = 'visible' } = opts;
  for (const sel of selectorList) {
    try {
      const loc = parent.locator(sel).first();
      await loc.waitFor({ state, timeout });
      return loc;
    } catch {
      // selector didn't match — try next
    }
  }
  return null;
}
