// Reference template for a swarm-test Playwright spec.
// One spec = ONE journey, written by ONE swarm agent into its own subdir. It is NOT
// loaded at runtime — it's a structural reminder for the agent that writes the spec.
//
// Conventions enforced by the SKILL.md / journey brief:
// - test.step('NN-label', ...) — NN must match the screenshot filename
// - page.screenshot({ path: '...NN-label.png', fullPage: false }) at end of step
// - Stable selectors only (getByRole, getByLabel, getByTestId, getByText)
// - Waits target conditions (networkidle, visible element), never arbitrary delays
// - Modal depth: if the journey opens a modal/dropdown/drawer, interact INSIDE it

import { test, expect } from '@playwright/test';

// If the journey is behind auth, load the shared session captured in phase 4:
//   test.use({ storageState: '.swarm-test/auth/storage.json' });

// SCREENSHOT_DIR is injected by the agent at the top of the generated spec — it points
// at THIS journey's subdir, e.g. '<...>/.swarm-test/runs/<ts>/01-subscribe-happy/'
declare const SCREENSHOT_DIR: string;

test('feature: <one-line description of what was just shipped>', async ({ page }) => {

  await test.step('01-navigate-to-entry', async () => {
    await page.goto('/your-route');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-navigate-to-entry.png`, fullPage: false });
  });

  await test.step('02-trigger-the-feature', async () => {
    await page.getByRole('button', { name: /your action/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-trigger-the-feature.png`, fullPage: false });
  });

  await test.step('03-verify-outcome', async () => {
    await expect(page.getByText(/expected text/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-verify-outcome.png`, fullPage: false });
  });
});
