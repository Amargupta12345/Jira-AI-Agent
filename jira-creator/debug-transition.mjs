import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = resolve(__dirname, '.auth-state.json');

const browser = await chromium.launch({ headless: true, slowMo: 200 });
const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
const page = await context.newPage();

await page.goto('https://gofynd.atlassian.net/browse/JCP-9808', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Click status button
const statusBtn = page.locator('button[data-testid="issue-field-status.ui.status-view.status-button.status-button"]');
await statusBtn.click();
await page.waitForTimeout(1500);
await page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {
  await statusBtn.click();
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ state: 'visible', timeout: 15000 });
});

// Click target transition
const transitionName = process.argv[2] || 'Ready For Prod';
const options = page.locator('[role="option"]');
const count = await options.count();
let clicked = false;
for (let i = 0; i < count; i++) {
  const text = await options.nth(i).innerText();
  if (text.includes(transitionName)) {
    await options.nth(i).click();
    clicked = true;
    break;
  }
}
if (!clicked) { console.log('Transition not found!'); process.exit(1); }
console.log(`Clicked: ${transitionName}`);

await page.waitForTimeout(3000);

// Fill ADO Link if present
const adoInput = page.locator('#customfield_10361');
if (await adoInput.isVisible().catch(() => false)) {
  await adoInput.fill('https://gofynd.com/');
  console.log('Filled ADO Link');
}

// Fill Comment if present
const commentArea = page.locator('#comment');
if (await commentArea.isVisible().catch(() => false)) {
  await commentArea.click();
  await commentArea.fill('All verifications completed successfully. Proceeding to next stage.');
  console.log('Filled Comment');
}

await page.waitForTimeout(1000);

// Click submit
const submit = page.locator('#issue-workflow-transition-submit');
await submit.click();
console.log('Clicked submit');

await page.waitForTimeout(5000);

const dialogStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false);
if (dialogStillOpen) {
  const errors = await page.evaluate(() => {
    const errorEls = document.querySelectorAll('.error, .aui-message-error, [class*="error"], [role="alert"]');
    return [...errorEls].map(e => e.innerText?.trim()).filter(Boolean);
  });
  console.log('ERRORS:', errors);
  await page.screenshot({ path: '/tmp/transition-error.png', fullPage: true });
} else {
  console.log('Success!');
  await page.waitForTimeout(2000);
  const status = await page.locator('button[data-testid="issue-field-status.ui.status-view.status-button.status-button"]').innerText();
  console.log('New status:', status.trim());
}

await browser.close();
