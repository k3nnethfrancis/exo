import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

test("captures the default workspace shell", async () => {
  const { electronApp, page } = await launchExoFixture();
  await expect(page).toHaveScreenshot("workspace-default.png");
  await electronApp.close();
});

test("captures bottom dock and agent tabs", async () => {
  const { electronApp, page } = await launchExoFixture();
  await page.getByTestId("toggle-terminal-placement").click();
  await page.getByTestId("launch-claude").click();
  await page.getByTestId("launch-codex").click();
  await expect(page).toHaveScreenshot("workspace-bottom-terminal.png");
  await electronApp.close();
});
