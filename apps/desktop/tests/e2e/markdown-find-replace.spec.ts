import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture } from "../helpers";

test("replaces every Markdown editor match through the native find panel", async () => {
  let notePath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      notePath = path.join(workspaceRoot, "notes/test-notes/find-replace.md");
      await writeFile(
        notePath,
        "# Find and replace\n\nOld wording appears twice: old wording.\n",
        "utf8",
      );
    },
  });

  try {
    await fixture.page.getByRole("button", { name: "find-replace" }).click();
    await expect(fixture.page.getByTestId("editor-title")).toHaveText("find-replace");
    await fixture.page.locator(".cm-content").press("Meta+f");

    const panel = fixture.page.locator(".cm-panel.cm-search");
    await expect(panel).toBeVisible();
    await expect(fixture.page.locator(".cm-content").evaluate((content) => {
      const view = (content as HTMLElement & { cmView?: { view?: { state: { readOnly: boolean } } } }).cmView?.view;
      return view?.state.readOnly;
    })).resolves.toBe(false);
    await panel.locator('input[name="search"]').pressSequentially("wording");
    await panel.locator('input[name="replace"]').pressSequentially("language");
    await expect(fixture.page.locator(".cm-searchMatch")).toHaveCount(2);
    const replaceAll = panel.locator('button[name="replaceAll"]');
    await replaceAll.focus();
    await replaceAll.press("Enter");

    await expect.poll(() => editorText(fixture.page)).toBe("# Find and replace\n\nOld language appears twice: old language.\n");
    await expect.poll(() => readFile(notePath, "utf8")).toBe("# Find and replace\n\nOld language appears twice: old language.\n");
  } finally {
    await fixture.cleanup();
  }
});

function editorText(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as HTMLElement & { cmView?: { view?: { state: { doc: { toString: () => string } } } } }).cmView?.view;
    return view?.state.doc.toString() ?? "";
  });
}
