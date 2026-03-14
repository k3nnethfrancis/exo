import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

test("boots the shell, opens notes, and manages terminal tabs", async () => {
  const { electronApp, page } = await launchExoFixture();

  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");
  await expect(page.getByTestId("terminal-meta")).toContainText("fixtures/workspace/lab");

  await page.getByTestId("launch-claude").click();
  await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();

  await page.getByTestId("launch-codex").click();
  await expect(page.getByTestId("terminal-tab-codex")).toBeVisible();

  await page.getByTestId("toggle-terminal-placement").click();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();

  await expect(page.locator('[data-testid="tags-panel"] .tag-pill').first()).toBeVisible();
  await page.locator('[data-testid="tags-panel"] .tag-pill').first().click();
  await expect(page.getByTestId("tag-results")).toBeVisible();

  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Related Note");

  await electronApp.close();
});
