import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

test("boots the shell, opens notes, and manages terminal tabs", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("editor-title")).toHaveText("Focus Note");
  await expect(page.getByTestId("terminal-meta")).toContainText("fixtures/workspace/lab");

  await page.getByTestId("launch-claude").click();
  await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();

  await page.getByTestId("launch-codex").click();
  await expect(page.getByTestId("terminal-tab-codex")).toBeVisible();

  await page.getByTestId("terminal-tab-shell").dblclick();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();

  await page.getByTestId("knowledge-toggle").click();
  await expect(page.locator('[data-testid="tags-panel"] .tag-pill').first()).toBeVisible();
  await page.locator('[data-testid="tags-panel"] .tag-pill').first().click();
  await expect(page.getByTestId("tag-results")).toBeVisible();

  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("Related Note");

  await cleanup();
});

test("opens project files and creates note branches", async () => {
  const { page, cleanup } = await launchExoFixture({ mutable: true });

  await page.getByRole("button", { name: "exo-demo" }).click();
  await page.getByRole("button", { name: "src" }).click({ button: "right" });
  await expect(page.getByText("New File")).toBeVisible();
  await page.getByText("New File").click();
  await page.getByTestId("workspace-dialog-input").fill("scratch.ts");
  await page.getByTestId("workspace-dialog-confirm").click();

  await page.getByTestId("workspace-search").fill("scratch.ts");
  await page.getByRole("button", { name: /scratch\.ts/i }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("scratch.ts");
  await expect(page.getByTestId("properties-panel")).toContainText("Project file");

  await page.getByTestId("workspace-search").fill("");
  await page.getByRole("button", { name: "focus-note.md" }).click();
  await page.getByTestId("create-branch").click();
  await expect(page.getByTestId("branch-meta")).toContainText("Branch 1");
  await page.getByTestId("knowledge-toggle").click();
  await expect(page.getByTestId("branches-panel")).toContainText("1 · Focus Note");
  await expect(page.getByTestId("branch-tree")).toContainText("1.md");

  await cleanup();
});
