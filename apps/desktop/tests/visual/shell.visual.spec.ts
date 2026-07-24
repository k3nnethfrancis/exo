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
  const currentMode = await page.locator("html").getAttribute("data-appearance-mode");
  if (currentMode === targetMode) {
    return;
  }

  await page.getByTestId("workspace-menu-toggle").click();
  await page.getByTestId("workspace-menu-settings").click();
  await page.getByTestId("workspace-settings-tab-appearance").click();
  await page.getByTestId("workspace-settings-appearance").selectOption(targetMode);
  await expect(page.locator("html")).toHaveAttribute("data-appearance-mode", targetMode);
  await page.getByTestId("workspace-settings-close").click();
}

test("captures the default workspace shell", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
  await cycleAppearanceTo(page, "dark");
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-default.png", screenshotOptions);
  await cleanup();
});

test("captures terminal pane with shell tabs", async () => {
  const { page, cleanup } = await launchExoTerminalFixture();
  await cycleAppearanceTo(page, "dark");
  await page.getByTestId("new-terminal").click();
  await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(2);
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-terminal-tabs.png", screenshotOptions);
  await cleanup();
});

test("captures the expanded workspace menu", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
  await cycleAppearanceTo(page, "dark");
  await page.getByTestId("workspace-menu-toggle").click();
  await settleForScreenshot(page);
  await expect(page).toHaveScreenshot("workspace-menu-expanded.png", screenshotOptions);
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
    env: { EXO_FORCE_THEME: "light" },
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Probe\n\n1. first ordered item\n   1. nested ordered item\n2. second ordered item\n\n- top item\n  - child item\n    - grandchild item\n  - sibling child\n    continuation line\n`,
      );
    },
  });

  await settleForScreenshot(page);
  await expect(page.getByTestId("editor-panel")).toHaveScreenshot("workspace-list-geometry.png", screenshotOptions);
  await cleanup();
});
