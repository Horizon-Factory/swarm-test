// Reference template for a swarm-test Playwright spec.
// The skill adapts this to whatever the user just coded — it is NOT loaded
// at runtime, it's a structural reminder for the Claude that writes specs.
//
// Conventions enforced by the SKILL.md:
// - test.step('NN-label', ...) — NN must match the screenshot filename
// - page.screenshot({ path: '...NN-label.png', fullPage: false }) at end of step
// - Stable selectors only (getByRole, getByLabel, getByTestId, getByText)
// - Waits target conditions (networkidle, visible element), never arbitrary delays

import { test, expect } from '@playwright/test';

// SCREENSHOT_DIR is injected by the skill at the top of the generated spec:
//   const SCREENSHOT_DIR = '<absolute path to .swarm-test/runs/<ts>/>'
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
