import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

test("captures the default workspace shell", async () => {
  const { page, cleanup } = await launchExoFixture();
  await expect(page).toHaveScreenshot("workspace-default.png");
  await cleanup();
});

test("captures bottom dock and agent tabs", async () => {
  const { page, cleanup } = await launchExoFixture();
  await page.getByTestId("terminal-tab-shell").dblclick();
  await page.getByTestId("launch-claude").click();
  await page.getByTestId("launch-codex").click();
  await expect(page).toHaveScreenshot("workspace-bottom-terminal.png");
  await cleanup();
});
