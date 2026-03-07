import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AUTH_STATE_PATH, hasAuthState } from './auth.mjs';
import { SELECTORS, findFirst } from './selectors.mjs';
import { resolveAttachmentFile } from './attachment.mjs';

const JIRA_BASE = 'https://gofynd.atlassian.net';

/**
 * Take an error screenshot and return the path.
 */
async function errorScreenshot(page, label) {
  const ts = Date.now();
  const path = resolve(tmpdir(), `jira-transition-error-${label}-${ts}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
    console.log(`  Error screenshot saved: ${path}`);
  } catch {
    console.log('  (could not capture screenshot)');
  }
  return path;
}

/**
 * Launch browser with auth state.
 */
async function launchBrowser(opts = {}) {
  const { visible = false, slowMo = 0 } = opts;

  if (!hasAuthState()) {
    throw new Error(
      'No auth state found. Run `node jira-transition.mjs --setup` first to log in.'
    );
  }

  const browser = await chromium.launch({
    headless: !visible,
    slowMo,
  });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Navigate to issue page and wait for it to load.
 */
async function navigateToIssue(page, issueKey) {
  const url = `${JIRA_BASE}/browse/${issueKey}`;
  console.log(`Navigating to ${url} ...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for the issue to actually render
  const loaded = await findFirst(page, SELECTORS.issueLoaded, { timeout: 15000 });
  if (!loaded) {
    // Fallback: just wait for network idle
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  // Extra settle time for async JIRA rendering
  await page.waitForTimeout(2000);
}

/**
 * Read the current status text from the issue page.
 */
async function readStatus(page) {
  const btn = await findFirst(page, SELECTORS.statusButton, { timeout: 10000 });
  if (!btn) return '(unknown)';
  const text = await btn.innerText();
  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────
// Inspect mode
// ─────────────────────────────────────────────────────────────────────

export async function inspectPage(issueKey) {
  const { browser, page } = await launchBrowser({ visible: true });

  try {
    await navigateToIssue(page, issueKey);
    const status = await readStatus(page);
    console.log(`\nCurrent status: "${status}"\n`);

    // Dump all data-testid attributes on the page
    console.log('=== data-testid attributes on page ===');
    const testIds = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-testid]');
      return [...els].map((el) => ({
        tag: el.tagName.toLowerCase(),
        testId: el.getAttribute('data-testid'),
        text: el.innerText?.slice(0, 80) || '',
        role: el.getAttribute('role') || '',
      }));
    });
    // Filter to status/transition related
    const relevant = testIds.filter(
      (t) =>
        t.testId.includes('status') ||
        t.testId.includes('transition') ||
        t.testId.includes('workflow') ||
        t.testId.includes('modal') ||
        t.testId.includes('attachment') ||
        t.testId.includes('dialog')
    );
    for (const r of relevant) {
      console.log(`  <${r.tag} data-testid="${r.testId}" role="${r.role}"> ${r.text.slice(0, 60)}`);
    }
    if (relevant.length === 0) {
      console.log('  (no status/transition/attachment testIds found — dumping all)');
      for (const r of testIds.slice(0, 50)) {
        console.log(`  <${r.tag} data-testid="${r.testId}" role="${r.role}"> ${r.text.slice(0, 60)}`);
      }
      if (testIds.length > 50) console.log(`  ... and ${testIds.length - 50} more`);
    }

    // Try clicking the status button to open the dropdown
    console.log('\n=== Clicking status button to reveal transitions ===');
    const statusBtn = await findFirst(page, SELECTORS.statusButton, { timeout: 5000 });
    if (statusBtn) {
      await statusBtn.click();
      await page.waitForTimeout(2000);

      // Dump dropdown contents
      console.log('\n=== Dropdown / menu contents ===');
      const dropdownInfo = await page.evaluate(() => {
        const candidates = document.querySelectorAll(
          '[role="listbox"], [role="menu"], [role="dialog"], [data-testid*="transition"], [data-testid*="status"]'
        );
        return [...candidates].map((el) => ({
          tag: el.tagName.toLowerCase(),
          testId: el.getAttribute('data-testid') || '',
          role: el.getAttribute('role') || '',
          children: [...el.children].slice(0, 20).map((c) => ({
            tag: c.tagName.toLowerCase(),
            testId: c.getAttribute('data-testid') || '',
            role: c.getAttribute('role') || '',
            text: c.innerText?.slice(0, 80) || '',
          })),
        }));
      });

      for (const d of dropdownInfo) {
        console.log(`\n  <${d.tag} data-testid="${d.testId}" role="${d.role}">`);
        for (const c of d.children) {
          console.log(`    <${c.tag} data-testid="${c.testId}" role="${c.role}"> ${c.text.slice(0, 60)}`);
        }
      }

      // Also dump any new data-testid attrs that appeared
      const newTestIds = await page.evaluate(() => {
        const els = document.querySelectorAll('[data-testid]');
        return [...els]
          .filter(
            (el) =>
              el.getAttribute('data-testid').includes('status') ||
              el.getAttribute('data-testid').includes('transition') ||
              el.getAttribute('data-testid').includes('option') ||
              el.getAttribute('data-testid').includes('dropdown')
          )
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            testId: el.getAttribute('data-testid'),
            text: el.innerText?.slice(0, 80) || '',
            role: el.getAttribute('role') || '',
          }));
      });

      console.log('\n=== Transition/status testIds after click ===');
      for (const r of newTestIds) {
        console.log(`  <${r.tag} data-testid="${r.testId}" role="${r.role}"> ${r.text.slice(0, 60)}`);
      }
    } else {
      console.log('  Could not find status button to click.');
    }

    console.log('\n=== Inspect complete ===');
    console.log('The browser will stay open for 20 seconds so you can inspect manually.');
    console.log('Close the browser window or wait for auto-close.');

    await page.waitForTimeout(20000).catch(() => {});
  } catch (err) {
    console.error('Inspect error:', err.message);
    await errorScreenshot(page, 'inspect');
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Transition mode
// ─────────────────────────────────────────────────────────────────────

export async function performTransition(issueKey, transitionName, opts = {}) {
  const { visible = false, slowMo = 0, filePath = null } = opts;

  // Resolve the attachment file upfront
  const attachmentPath = resolveAttachmentFile(filePath, issueKey, transitionName);

  const { browser, page } = await launchBrowser({ visible, slowMo });

  try {
    // 1. Navigate to issue
    await navigateToIssue(page, issueKey);

    // 2. Read current status
    const currentStatus = await readStatus(page);
    console.log(`Current status: "${currentStatus}"`);

    // 3. Click status button to open transition dropdown
    console.log('Opening transition dropdown...');
    const statusBtn = await findFirst(page, SELECTORS.statusButton, { timeout: 10000 });
    if (!statusBtn) {
      await errorScreenshot(page, 'no-status-btn');
      throw new Error('Could not find the status button on the issue page.');
    }
    await statusBtn.click();
    await page.waitForTimeout(1000);

    // Wait for the dropdown to load (it fetches transitions async)
    // Retry click if the listbox doesn't appear
    console.log(`Looking for transition: "${transitionName}" ...`);
    let dropdownVisible = await page.locator('[role="listbox"] [role="option"]').first()
      .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

    if (!dropdownVisible) {
      console.log('  Dropdown did not appear, retrying click...');
      await statusBtn.click();
      await page.waitForTimeout(1000);
      dropdownVisible = await page.locator('[role="listbox"] [role="option"]').first()
        .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }
    await page.waitForTimeout(500);

    // 4. Find and click the target transition
    let clicked = false;

    // Strategy A: find by text in known containers
    for (const containerSel of SELECTORS.transitionDropdown) {
      if (clicked) break;
      try {
        const container = page.locator(containerSel).first();
        await container.waitFor({ state: 'visible', timeout: 5000 });
        for (const itemSel of SELECTORS.transitionItem) {
          if (clicked) break;
          const items = container.locator(itemSel);
          const count = await items.count();
          for (let i = 0; i < count; i++) {
            const text = await items.nth(i).innerText().catch(() => '');
            // Option text may be multi-line: "Dev Testing\nDEV VERIFICATION"
            // Match if any line starts with the transition name
            const lines = text.trim().split('\n').map((l) => l.trim().toLowerCase());
            if (lines.some((l) => l === transitionName.toLowerCase() || l.startsWith(transitionName.toLowerCase()))) {
              await items.nth(i).click();
              clicked = true;
              break;
            }
          }
        }
      } catch {
        // container not found, try next
      }
    }

    // Strategy B: broad text search across entire page
    if (!clicked) {
      try {
        const byText = page.getByRole('option', { name: transitionName });
        if (await byText.isVisible({ timeout: 2000 })) {
          await byText.click();
          clicked = true;
        }
      } catch {}
    }
    if (!clicked) {
      try {
        const byText = page.getByRole('menuitem', { name: transitionName });
        if (await byText.isVisible({ timeout: 2000 })) {
          await byText.click();
          clicked = true;
        }
      } catch {}
    }
    if (!clicked) {
      try {
        const byText = page.getByText(transitionName, { exact: true });
        if (await byText.isVisible({ timeout: 2000 })) {
          await byText.click();
          clicked = true;
        }
      } catch {}
    }

    if (!clicked) {
      await errorScreenshot(page, 'no-transition');
      throw new Error(
        `Could not find transition "${transitionName}" in the dropdown. ` +
        `Run --inspect to see available transitions.`
      );
    }
    console.log(`Clicked transition: "${transitionName}"`);

    // 5. Wait for transition screen (modal) to appear
    await page.waitForTimeout(2000);

    const modal = await findFirst(page, SELECTORS.modal, { timeout: 8000 });

    if (modal) {
      console.log('Transition screen detected.');
      const scope = modal;

      // 6. Check if modal has an attachment field — only upload if needed
      const hasAttachmentField = await scope.getByText('Drop files to attach').isVisible({ timeout: 2000 }).catch(() => false)
        || await scope.getByText('Attachment').isVisible({ timeout: 1000 }).catch(() => false);

      if (hasAttachmentField) {
        console.log('  Attachment field found — uploading file...');

        let uploaded = false;

        // Strategy 1 (preferred): click "browse" link to trigger native filechooser
        const browseLink = scope.getByText('browse').first();
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8000 }),
            browseLink.click(),
          ]);
          await fileChooser.setFiles(attachmentPath);
          uploaded = true;
          console.log('  Uploaded via filechooser (browse link).');
        } catch (e) {
          console.log(`  Browse link approach failed: ${e.message}`);
        }

        // Strategy 2: click the entire drop zone area
        if (!uploaded) {
          const dropZone = scope.getByText('Drop files to attach').first();
          try {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 8000 }),
              dropZone.click(),
            ]);
            await fileChooser.setFiles(attachmentPath);
            uploaded = true;
            console.log('  Uploaded via filechooser (drop zone).');
          } catch (e) {
            console.log(`  Drop zone approach failed: ${e.message}`);
          }
        }

        // Strategy 3: fallback to setInputFiles on hidden file input
        if (!uploaded) {
          const fileInput = await findFirst(page, SELECTORS.fileInput, {
            timeout: 3000,
            state: 'attached',
          });
          if (fileInput) {
            await fileInput.setInputFiles(attachmentPath);
            uploaded = true;
            console.log('  Uploaded via hidden file input.');
          }
        }

        if (!uploaded) {
          await errorScreenshot(page, 'no-file-input');
          throw new Error('Could not upload attachment on the transition screen.');
        }

        // Wait for upload to process
        console.log('  Waiting for upload to process...');
        await page.waitForTimeout(4000);

        // Check for upload error and retry if needed
        const uploadError = await scope.getByText('could not attach').isVisible().catch(() => false);
        if (uploadError) {
          console.log('  Upload failed (token error), retrying...');
          try {
            await scope.locator('button:has(svg), [aria-label="Remove"]').first().click();
            await page.waitForTimeout(1000);
          } catch {}
          const browseRetry = scope.getByText('browse').first();
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8000 }),
            browseRetry.click(),
          ]);
          await fileChooser.setFiles(attachmentPath);
          console.log('  Re-uploaded via browse link.');
          await page.waitForTimeout(4000);
        }
      } else {
        console.log('  No attachment field — checking for QC Report fields...');

        // Handle QC Report validator fields (Ready For UAT, Ready For Prod)
        const qcTransitions = ['ready for uat', 'ready for prod'];
        if (qcTransitions.includes(transitionName.toLowerCase())) {
          // Fill ADO Link field
          try {
            const adoLinkField = scope.locator('#customfield_10361');
            if (await adoLinkField.isVisible({ timeout: 3000 }).catch(() => false)) {
              await adoLinkField.fill('https://gofynd.com/');
              console.log('  Filled ADO Link field.');
            } else {
              // Try by label
              const adoByLabel = scope.getByLabel(/ado link/i).first();
              if (await adoByLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
                await adoByLabel.fill('https://gofynd.com/');
                console.log('  Filled ADO Link field (by label).');
              }
            }
          } catch (e) {
            console.log(`  Could not fill ADO Link: ${e.message}`);
          }

          // Fill Comment field
          try {
            const commentField = scope.locator('#comment');
            if (await commentField.isVisible({ timeout: 3000 }).catch(() => false)) {
              await commentField.fill('All verifications completed successfully. Proceeding to next stage.');
              console.log('  Filled Comment field.');
            } else {
              // Try by label
              const commentByLabel = scope.getByLabel(/comment/i).first();
              if (await commentByLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
                await commentByLabel.fill('All verifications completed successfully. Proceeding to next stage.');
                console.log('  Filled Comment field (by label).');
              }
            }
          } catch (e) {
            console.log(`  Could not fill Comment: ${e.message}`);
          }

          await page.waitForTimeout(1000);
        } else {
          console.log('  Submitting directly.');
        }
      }

      // 7. Click submit — try multiple strategies
      console.log('Submitting transition...');
      let submitted = false;

      // Strategy A: button labeled with the transition name (e.g. "Dev Testing", "Ready For UAT")
      // This is the new-style Atlassian dialog submit button — preferred.
      try {
        const namedBtn = scope.getByRole('button', { name: transitionName });
        await namedBtn.waitFor({ state: 'visible', timeout: 3000 });
        await namedBtn.click();
        submitted = true;
        console.log(`  Clicked submit button: "${transitionName}"`);
      } catch {}

      // Strategy B: legacy JIRA form submit button (id="issue-workflow-transition-submit")
      if (!submitted) {
        try {
          const legacySubmit = scope.locator('#issue-workflow-transition-submit');
          await legacySubmit.waitFor({ state: 'visible', timeout: 3000 });
          await legacySubmit.click();
          submitted = true;
          console.log('  Clicked legacy submit button.');
        } catch {}
      }

      // Strategy C: generic submit selectors
      if (!submitted) {
        const submitBtn = await findFirst(scope, SELECTORS.submitButton, { timeout: 3000 });
        if (submitBtn) {
          await submitBtn.click();
          submitted = true;
        }
      }
      if (!submitted) {
        const submitGlobal = await findFirst(page, SELECTORS.submitButton, { timeout: 3000 });
        if (submitGlobal) {
          await submitGlobal.click();
          submitted = true;
        }
      }

      if (!submitted) {
        await errorScreenshot(page, 'no-submit');
        throw new Error('Could not find the submit/confirm button on the transition screen.');
      }
    } else {
      // No modal — the transition may have been applied directly
      console.log('No transition screen modal detected (direct transition).');
    }

    // 8. Wait for transition to process
    console.log('Waiting for transition to complete...');
    await page.waitForTimeout(4000);

    // 9. Reload and verify
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const newStatus = await readStatus(page);
    console.log(`\nNew status: "${newStatus}"`);

    if (newStatus.toLowerCase() === currentStatus.toLowerCase()) {
      console.log('WARNING: Status appears unchanged. The transition may have failed.');
      console.log('Run with --visible to debug visually.');
      await errorScreenshot(page, 'status-unchanged');
    } else {
      console.log(`Transition successful: "${currentStatus}" -> "${newStatus}"`);
    }

    return { previousStatus: currentStatus, newStatus };
  } catch (err) {
    console.error(`\nTransition failed: ${err.message}`);
    await errorScreenshot(page, 'fatal');
    throw err;
  } finally {
    await browser.close();
  }
}
