import { expect, test, type Locator } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launchExoWorkspaceFixture } from "../helpers";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7KkAAAAASUVORK5CYII=",
  "base64",
);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("loads a root-relative site image through the Electron notes resolver", async ({}, testInfo) => {
  let notePath = "";
  const { electronApp, page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (workspaceRoot) => {
      const siteRoot = path.join(workspaceRoot, "notes/test-notes/kenneth-dot-computer/garden");
      notePath = path.join(siteRoot, "blog/self-improving-business-systems.md");
      const imagePath = path.join(siteRoot, "images/posts/self-improving-business-systems/loop-stack.png");
      const relativeImagePath = path.join(siteRoot, "blog/attachments/relative.png");
      const vectorImagePath = path.join(siteRoot, "blog/attachments/vector.svg");
      const noteRootImagePath = path.join(workspaceRoot, "notes/test-notes/images/root-control.png");
      await mkdir(path.dirname(notePath), { recursive: true });
      await mkdir(path.dirname(imagePath), { recursive: true });
      await mkdir(path.dirname(relativeImagePath), { recursive: true });
      await mkdir(path.dirname(noteRootImagePath), { recursive: true });
      await writeFile(
        notePath,
        "# Self-Improving Business Systems\n\n![Relative control](attachments/relative.png)\n\n![Vector control](attachments/vector.svg)\n\n![Note root control](/images/root-control.png)\n\n![The nested agentic work loop and human governance loop](/images/posts/self-improving-business-systems/loop-stack.png)\n",
        "utf8",
      );
      const visibleFixturePng = await readFile(
        path.join(repoRoot, "apps/desktop/tests/visual/shell.visual.spec.ts-snapshots/workspace-default-darwin.png"),
      );
      await writeFile(imagePath, visibleFixturePng);
      await writeFile(relativeImagePath, onePixelPng);
      await writeFile(vectorImagePath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" fill="#2f716c"/></svg>', "utf8");
      await writeFile(noteRootImagePath, onePixelPng);
    },
  });

  try {
    await electronApp.evaluate(({ BrowserWindow }, targetPath) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-file", targetPath);
    }, notePath);

    const relativeControl = page.getByLabel("Relative control");
    const vectorControl = page.getByLabel("Vector control");
    const noteRootControl = page.getByLabel("Note root control");
    const imageWidget = page.getByLabel("The nested agentic work loop and human governance loop");
    await expect(relativeControl).toBeVisible();
    await expect(vectorControl).toBeVisible();
    await expect(noteRootControl).toBeVisible();
    await expect(imageWidget).toBeVisible();
    await expect.poll(() => loadedWidth(relativeControl)).toBeGreaterThan(0);
    await expect.poll(() => loadedWidth(vectorControl)).toBeGreaterThan(0);
    await expect.poll(() => renderedWidth(vectorControl)).toBeGreaterThan(0);
    await expect.poll(() => loadedWidth(noteRootControl)).toBeGreaterThan(0);
    await expect
      .poll(() => loadedWidth(imageWidget))
      .toBeGreaterThan(0);
    await expect(imageWidget.locator("img")).toHaveCSS("border-radius", "8px");
    await expect(imageWidget).not.toHaveClass(/exo-md-image--missing/);
    await page.screenshot({ path: testInfo.outputPath("markdown-images-loaded.png"), fullPage: true });
  } finally {
    await cleanup();
  }
});

function loadedWidth(widget: Locator): Promise<number> {
  return widget.locator("img").evaluateAll((images) => images[0]?.naturalWidth ?? 0);
}

function renderedWidth(widget: Locator): Promise<number> {
  return widget.locator("img").evaluateAll((images) => images[0]?.getBoundingClientRect().width ?? 0);
}
