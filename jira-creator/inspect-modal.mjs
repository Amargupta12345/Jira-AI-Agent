import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = resolve('/Users/vaibhavpratihar/Desktop/jira-creator/.auth-state.json');

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
const page = await context.newPage();

await page.goto('https://gofynd.atlassian.net/browse/JCP-9808', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Click status button
const statusBtn = page.locator('button[data-testid="issue-field-status.ui.status-view.status-button.status-button"]');
await statusBtn.click();
await page.waitForTimeout(2000);

// Click "Ready For UAT"
const options = page.locator('[role="option"]');
const count = await options.count();
for (let i = 0; i < count; i++) {
  const text = await options.nth(i).innerText();
  if (text.includes('Ready For UAT')) {
    await options.nth(i).click();
    break;
  }
}

await page.waitForTimeout(3000);

// Screenshot the modal
await page.screenshot({ path: '/tmp/modal-ready-for-uat.png', fullPage: true });

// Dump the modal DOM
const modal = page.locator('[role="dialog"]').first();
try {
  await modal.waitFor({ state: 'visible', timeout: 5000 });
  const html = await modal.innerHTML();

  // Dump all form fields, labels, inputs in the modal
  const fields = await modal.evaluate((el) => {
    const items = [];
    // Labels
    el.querySelectorAll('label, legend, h2, h3, h4').forEach(l => {
      items.push({ type: 'label', text: l.innerText?.trim(), for: l.getAttribute('for') || '' });
    });
    // Inputs
    el.querySelectorAll('input, textarea, select, [contenteditable]').forEach(inp => {
      items.push({
        type: inp.tagName.toLowerCase(),
        inputType: inp.getAttribute('type') || '',
        name: inp.getAttribute('name') || '',
        id: inp.getAttribute('id') || '',
        testId: inp.getAttribute('data-testid') || '',
        placeholder: inp.getAttribute('placeholder') || '',
      });
    });
    // Buttons
    el.querySelectorAll('button').forEach(b => {
      items.push({ type: 'button', text: b.innerText?.trim(), testId: b.getAttribute('data-testid') || '' });
    });
    // All data-testid elements
    el.querySelectorAll('[data-testid]').forEach(d => {
      items.push({
        type: 'testid-element',
        tag: d.tagName.toLowerCase(),
        testId: d.getAttribute('data-testid'),
        text: d.innerText?.slice(0, 100) || '',
      });
    });
    return items;
  });

  console.log('\n=== Modal form fields ===');
  for (const f of fields) {
    console.log(JSON.stringify(f));
  }
} catch (e) {
  console.log('No dialog found:', e.message);
}

await page.waitForTimeout(15000);
await browser.close();
