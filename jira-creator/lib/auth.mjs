import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const AUTH_STATE_PATH = resolve(__dirname, '..', '.auth-state.json');

const JIRA_URL = 'https://gofynd.atlassian.net';

export function hasAuthState() {
  return existsSync(AUTH_STATE_PATH);
}

/**
 * Launch a visible browser so the user can log in to JIRA manually.
 * Automatically detects when login is complete by polling for JIRA dashboard URL.
 */
export async function setupAuth() {
  console.log('Launching browser for JIRA login...');
  console.log('Log in when the browser opens. Session will be saved automatically once login is detected.');
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(JIRA_URL);

  console.log('Waiting for login to complete...');

  // Poll until the URL indicates we're on the JIRA site (not on an auth/login page)
  await page.waitForURL(
    (url) => {
      const href = url.toString();
      return (
        href.includes('gofynd.atlassian.net') &&
        !href.includes('id.atlassian.com') &&
        !href.includes('/login') &&
        !href.includes('/auth')
      );
    },
    { timeout: 300000 } // 5 minutes to log in
  );

  // Extra wait for cookies/session to settle
  await page.waitForTimeout(3000);

  // Save the authenticated state
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`Auth state saved to ${AUTH_STATE_PATH}`);

  await browser.close();
  console.log('Browser closed. You can now run transitions.');
}
