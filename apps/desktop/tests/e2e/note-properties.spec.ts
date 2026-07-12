import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("edits durable note properties with clear key validation", async () => {
  const noteName = "metadata-behavior";
  const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
    prepareWorkspace: async (root) => {
      await writeFile(
        path.join(root, "notes/test-notes", "filename-fallback.md"),
        "Body without an opening heading.\n",
        "utf8",
      );
      await writeFile(
        path.join(root, "notes/test-notes", `${noteName}.md`),
        "---\ndate: 2026-07-11\ntags: [exo]\n---\n\n# Heading Alias\n\nBody.\n",
        "utf8",
      );
    },
    initialNoteLabel: noteName,
  });
  const notePath = path.join(workspaceRoot, "notes/test-notes", `${noteName}.md`);

  try {
    await expect.poll(() => page.evaluate(async (filePath) => (await window.exo.notes.read(filePath)).title, path.join(workspaceRoot, "notes/test-notes", "filename-fallback.md"))).toBe("filename-fallback");
    await page.getByTestId("editor-panel").hover();
    await page.getByTestId("toggle-properties").click();
    await expect(page.getByTestId("properties-panel")).toBeVisible();
    await expect(page.locator("#property-title")).toHaveValue("Heading Alias");
    await expect(page.locator("#property-date")).toHaveValue("2026-07-11");
    await expect(page.locator("#property-tags")).toHaveValue("exo");

    const propertyKey = page.locator("#property-new-key");
    await propertyKey.fill("bad key");
    await expect(page.getByTestId("property-key-feedback")).toHaveText("Use letters, numbers, _ or -; begin with a letter or _.");
    await expect(page.getByTestId("add-frontmatter-property")).toBeDisabled();

    await propertyKey.fill("date");
    await expect(page.getByTestId("property-key-feedback")).toHaveText("date already exists.");
    await expect(page.getByTestId("add-frontmatter-property")).toBeDisabled();

    await propertyKey.fill("status");
    await expect(page.getByTestId("property-key-feedback")).toHaveCount(0);
    await page.getByLabel("New property value").fill("draft");
    await page.getByTestId("add-frontmatter-property").click();
    await expect(page.locator("#property-status")).toHaveValue("draft");

    await page.locator("#property-title").fill("Explicit Alias");
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
    await expect.poll(async () => readFile(notePath, "utf8")).toMatch(/date: ['"]?2026-07-11['"]?\n[\s\S]*status: draft/);

    await page.getByTestId("toggle-properties").click();
    await page.getByRole("button", { name: `Close ${noteName}`, exact: true }).click();
    await page.getByTestId("sidebar").getByRole("button", { name: noteName }).click();
    await page.getByTestId("editor-panel").hover();
    await page.getByTestId("toggle-properties").click();
    await expect(page.locator("#property-title")).toHaveValue("Explicit Alias");
    await expect(page.locator("#property-status")).toHaveValue("draft");

    await expect.poll(() => page.evaluate(async (filePath) => (await window.exo.notes.read(filePath)).title, notePath)).toBe("Explicit Alias");
  } finally {
    await cleanup();
  }
});

test("keeps the properties control reachable through repeated open and close", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    const editor = page.getByTestId("editor-panel");
    const toggle = page.getByTestId("toggle-properties");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await editor.hover();
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByTestId("properties-panel")).toBeVisible();

      await page.locator(".properties-card__content").hover();
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-label", "Hide properties");
      await toggle.click();
      await expect(page.getByTestId("properties-panel")).toHaveCount(0);
    }
  } finally {
    await cleanup();
  }
});
