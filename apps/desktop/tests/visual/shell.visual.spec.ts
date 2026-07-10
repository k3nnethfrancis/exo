import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

import { launchExoTerminalFixture, launchExoWorkspaceFixture } from "../helpers";

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

async function cycleAppearanceTo(page: Page, targetMode: "system" | "light" | "dark") {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentMode = await page.locator("html").getAttribute("data-appearance-mode");
    if (currentMode === targetMode) {
      return;
    }

    if (!(await page.getByTestId("workspace-appearance").isVisible().catch(() => false))) {
      await page.getByTestId("workspace-menu-button").click();
    }
    await page.getByTestId("workspace-appearance").click();
  }

  throw new Error(`Unable to reach appearance mode ${targetMode}.`);
}

test("captures the default workspace shell", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
  await cycleAppearanceTo(page, "dark");
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-default.png", screenshotOptions);
  await cleanup();
});

test("captures terminal pane with agent tabs", async () => {
  const { page, cleanup } = await launchExoTerminalFixture();
  await cycleAppearanceTo(page, "dark");
  await page.getByTestId("launch-claude").click();
  await page.getByTestId("launch-codex").click();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-terminal-agents.png", screenshotOptions);
  await cleanup();
});

test("captures the expanded project roots drawer", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
  await cycleAppearanceTo(page, "dark");
  await page.getByTestId("project-roots-toggle").click();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-project-roots-expanded.png", screenshotOptions);
  await cleanup();
});

test("captures the warm light mode shell", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
  await cycleAppearanceTo(page, "light");
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-light-mode.png", screenshotOptions);
  await cleanup();
});

test("captures nested list geometry", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Probe\n\n- top item\n  - child item\n    - grandchild item\n  - sibling child\n    continuation line\n`,
      );
    },
  });

  await cycleAppearanceTo(page, "light");
  await settleForScreenshot(page);
  await expect(page.getByTestId("editor-panel")).toHaveScreenshot("workspace-list-geometry.png", screenshotOptions);
  await cleanup();
});
