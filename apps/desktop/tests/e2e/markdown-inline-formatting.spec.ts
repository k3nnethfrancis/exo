import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture } from "../helpers";

test("wraps a Markdown selection in bold markers with Command-B", async () => {
  let notePath = "";
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      notePath = path.join(workspaceRoot, "notes/test-notes/inline-formatting.md");
      await writeFile(notePath, "A plain phrase.\n", "utf8");
    },
  });

  try {
    await fixture.page.getByRole("button", { name: "inline-formatting" }).click();
    await expect(fixture.page.getByTestId("editor-title")).toHaveText("inline-formatting");
    await selectEditorText(fixture.page, "plain");
    await fixture.page.locator(".cm-content").press("Meta+b");

    await expect.poll(() => editorText(fixture.page)).toBe("A **plain** phrase.\n");
    await expect.poll(() => readFile(notePath, "utf8")).toBe("A **plain** phrase.\n");
  } finally {
    await fixture.cleanup();
  }
});

test("wraps a Markdown selection in italic markers with Command-I", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      await writeFile(
        path.join(workspaceRoot, "notes/test-notes/inline-formatting.md"),
        "A plain phrase.\n",
        "utf8",
      );
    },
  });

  try {
    await fixture.page.getByRole("button", { name: "inline-formatting" }).click();
    await expect(fixture.page.getByTestId("editor-title")).toHaveText("inline-formatting");
    await selectEditorText(fixture.page, "plain");
    await fixture.page.locator(".cm-content").press("Meta+i");

    await expect.poll(() => editorText(fixture.page)).toBe("A *plain* phrase.\n");
  } finally {
    await fixture.cleanup();
  }
});

test("places the caret inside italic markers when Command-I has no selection", async () => {
  const fixture = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      await writeFile(
        path.join(workspaceRoot, "notes/test-notes/inline-formatting.md"),
        "A phrase.\n",
        "utf8",
      );
    },
  });

  try {
    await fixture.page.getByRole("button", { name: "inline-formatting" }).click();
    await expect(fixture.page.getByTestId("editor-title")).toHaveText("inline-formatting");
    await placeEditorCursor(fixture.page, 2);
    await fixture.page.locator(".cm-content").press("Meta+i");

    await expect.poll(() => editorText(fixture.page)).toBe("A **phrase.\n");
    await expect.poll(() => editorSelection(fixture.page)).toEqual({ anchor: 3, head: 3 });
  } finally {
    await fixture.cleanup();
  }
});

async function selectEditorText(page: import("@playwright/test").Page, text: string): Promise<void> {
  await page.locator(".cm-content").evaluate((content, selectedText) => {
    const view = (content as HTMLElement & {
      cmView?: { view?: { state: { doc: { toString: () => string } }; dispatch: (transaction: unknown) => void; focus: () => void } };
    }).cmView?.view;
    if (!view) throw new Error("CodeMirror view was unavailable");

    const source = view.state.doc.toString();
    const from = source.indexOf(selectedText);
    if (from < 0) throw new Error(`Could not find ${selectedText}`);
    view.dispatch({ selection: { anchor: from, head: from + selectedText.length } });
    view.focus();
  }, text);
}

async function placeEditorCursor(page: import("@playwright/test").Page, position: number): Promise<void> {
  await page.locator(".cm-content").evaluate((content, cursorPosition) => {
    const view = (content as HTMLElement & {
      cmView?: { view?: { dispatch: (transaction: unknown) => void; focus: () => void } };
    }).cmView?.view;
    if (!view) throw new Error("CodeMirror view was unavailable");

    view.dispatch({ selection: { anchor: cursorPosition } });
    view.focus();
  }, position);
}

function editorText(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as HTMLElement & { cmView?: { view?: { state: { doc: { toString: () => string } } } } }).cmView?.view;
    return view?.state.doc.toString() ?? "";
  });
}

function editorSelection(page: import("@playwright/test").Page): Promise<{ anchor: number; head: number }> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as HTMLElement & {
      cmView?: { view?: { state: { selection: { main: { anchor: number; head: number } } } } };
    }).cmView?.view;
    if (!view) throw new Error("CodeMirror view was unavailable");
    const { anchor, head } = view.state.selection.main;
    return { anchor, head };
  });
}
