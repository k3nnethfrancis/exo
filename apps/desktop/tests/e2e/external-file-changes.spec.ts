import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoFixture } from "../helpers";

test("refreshes an open clean document when it changes on disk", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/vault/external-change-test.md");
      await writeFile(target, "# External Change Test\n\nbefore external update\n", "utf8");
    },
  });

  const target = path.join(workspaceRoot, "notes/vault/external-change-test.md");

  await page.getByRole("button", { name: /external-change-test/i }).first().click();
  await expect(page.getByTestId("editor-panel")).toContainText("before external update");

  await writeFile(target, "# External Change Test\n\nafter external update from agent\n", "utf8");

  await expect(page.getByTestId("editor-panel")).toContainText("after external update from agent", { timeout: 5000 });

  await cleanup();
});

test("preserves editor scroll when an open document refreshes from disk", async () => {
  const longBody = Array.from({ length: 140 }, (_value, index) => `line ${String(index + 1).padStart(3, "0")}`).join("\n");
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/vault/external-scroll-test.md");
      await writeFile(target, `# External Scroll Test\n\n${longBody}\n`, "utf8");
    },
  });

  const target = path.join(workspaceRoot, "notes/vault/external-scroll-test.md");

  await page.getByRole("button", { name: /external-scroll-test/i }).first().click();
  const scroller = page.locator(".editor-surface .cm-scroller").first();
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight + 900)).toBe(true);
  await scroller.evaluate((element) => {
    element.scrollTo(0, 1200);
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(800);
  await page.waitForTimeout(350);

  await writeFile(target, `# External Scroll Test\n\n${longBody}\nagent appended line\n`, "utf8");
  await page.waitForTimeout(1800);

  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(800);

  await cleanup();
});
