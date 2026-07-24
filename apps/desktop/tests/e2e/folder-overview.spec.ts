import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("keeps Folder Overview read-only until Create index is explicit", async () => {
  const folderName = "unindexed-project";
  const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (root) => {
      const folderPath = path.join(root, "notes/test-notes", folderName);
      await mkdir(folderPath, { recursive: true });
      await writeFile(path.join(folderPath, "child.md"), "# Child\n\nFolder content.\n", "utf8");
    },
  });
  const folderPath = path.join(workspaceRoot, "notes/test-notes", folderName);
  const indexPath = path.join(folderPath, "index.md");

  try {
    await expect(access(indexPath)).rejects.toMatchObject({ code: "ENOENT" });

    const folder = page.getByRole("button", { name: `${folderName}, collapsed folder` });
    await folder.dblclick();
    const overview = page.getByTestId("folder-overview");
    await expect(overview).toHaveAttribute("data-folder-loaded", "true");
    await expect(overview.getByRole("heading", { name: folderName, exact: true })).toBeVisible();
    await expect(overview).toContainText("Viewing it has not changed your files.");
    await expect(overview.getByRole("button", { name: "child", exact: true })).toBeVisible();
    await expect(page.getByTestId("sidebar").getByRole("button", { name: "index", exact: true })).toHaveCount(0);
    await expect(access(indexPath)).rejects.toMatchObject({ code: "ENOENT" });

    await overview.getByRole("button", { name: "child", exact: true }).click();
    await expect(page.getByTestId("editor-title")).toHaveText("child");
    await page.locator(".tab-strip__tab").filter({ hasText: folderName }).click();
    await expect(overview).toHaveAttribute("data-folder-loaded", "true");

    await overview.getByRole("button", { name: "Create index" }).click();
    await expect.poll(() => readFile(indexPath, "utf8")).toBe(`# ${folderName}\n`);
    await expect(page.getByTestId("editor-title")).toHaveText("index");
    await expect(page.getByTestId("sidebar").getByRole("button", { name: "index", exact: true })).toHaveCount(0);

    await page.locator(".tab-strip__tab").filter({ hasText: folderName }).click();
    await expect(overview).toHaveAttribute("data-folder-loaded", "true");
    await expect(overview.getByRole("button", { name: "Open index" })).toBeVisible();
    await expect(overview.getByRole("button", { name: "Create index" })).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("restores the document owner after closing Folder Overview", async () => {
  const folderName = "close-overview";
  const marker = "\n\nSaved after closing Folder Overview.\n";
  const { page, electronApp, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (root) => {
      const folderPath = path.join(root, "notes/test-notes", folderName);
      await mkdir(folderPath, { recursive: true });
      await writeFile(path.join(folderPath, "child.md"), "# Child\n\nFolder content.\n", "utf8");
    },
  });
  const folderPath = path.join(workspaceRoot, "notes/test-notes", folderName);
  const notePath = path.join(folderPath, "child.md");

  try {
    await page.getByRole("button", { name: `${folderName}, collapsed folder` }).dblclick();
    const overview = page.getByTestId("folder-overview");
    await expect(overview).toHaveAttribute("data-folder-loaded", "true");
    await overview.getByRole("button", { name: "child", exact: true }).click();
    await expect(page.getByTestId("editor-title")).toHaveText("child");

    await page.locator(".tab-strip__tab").filter({ hasText: folderName }).click();
    await expect(overview).toHaveAttribute("data-folder-loaded", "true");
    await page.getByRole("button", { name: `Close ${folderName}`, exact: true }).click();

    await expect(page.getByTestId("editor-title")).toHaveText("child");
    const content = page.locator(".editor-surface .cm-content");
    await content.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await page.keyboard.type(marker);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
    await expect.poll(() => readFile(notePath, "utf8")).toContain(marker);

    await page.reload();
    await electronApp.evaluate(({ BrowserWindow }, targetPath) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-file", targetPath);
    }, notePath);
    await expect(page.locator(".editor-surface .cm-content")).toContainText("Saved after closing Folder Overview.");
  } finally {
    await cleanup();
  }
});
