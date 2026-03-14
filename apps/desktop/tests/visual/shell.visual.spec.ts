import { test, expect, type Page } from "@playwright/test";

import { launchExoFixture } from "../helpers";

async function settleForScreenshot(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

const screenshotOptions = {
  maxDiffPixels: 1200,
} as const;

test("captures the default workspace shell", async () => {
  const { page, cleanup } = await launchExoFixture();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-default.png", screenshotOptions);
  await cleanup();
});

test("captures bottom dock and agent tabs", async () => {
  const { page, cleanup } = await launchExoFixture();
  await page.getByTestId("terminal-tab-shell").dblclick();
  await page.getByTestId("launch-claude").click();
  await page.getByTestId("launch-codex").click();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-bottom-terminal.png", screenshotOptions);
  await cleanup();
});

test("captures the expanded project roots drawer", async () => {
  const { page, cleanup } = await launchExoFixture();
  await page.getByTestId("project-roots-toggle").click();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-project-roots-expanded.png", screenshotOptions);
  await cleanup();
});
