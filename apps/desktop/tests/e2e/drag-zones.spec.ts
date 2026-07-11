/**
 * Drag zone behavior tests.
 *
 * Rules:
 * 1. Three columns: explorer | editor pane | terminal pane
 * 2. You can drag tabs within the same zone to split that zone
 * 3. You CANNOT drag editor/notes tabs into the terminal zone
 * 4. You CAN drag terminal tabs into the editor zone
 * 5. You can merge split tab groups by dragging a tab back to another group
 * 6. No drag operation should ever produce a blank canvas
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";
import { launchExoTerminalFixture, launchExoWorkspaceFixture } from "../helpers";

// ---------------------------------------------------------------------------
// Helpers — simulate manual drag (not HTML5 DnD)
// ---------------------------------------------------------------------------

/**
 * Simulate a manual drag from one element to a target position.
 * This mimics the mousedown → mousemove (past threshold) → mouseup
 * sequence that useDragManager expects.
 */
async function manualDrag(
  page: Page,
  source: { x: number; y: number },
  target: { x: number; y: number },
  options?: { drop?: boolean },
) {
  const drop = options?.drop ?? true;

  // mousedown at source
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();

  // Move past the 5px threshold in small steps
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    await page.mouse.move(
      source.x + (target.x - source.x) * ratio,
      source.y + (target.y - source.y) * ratio,
    );
  }

  // Small pause to let React render
  await page.waitForTimeout(100);

  if (drop) {
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
}

async function getCenter(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Element not found: ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function getBoundingBox(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`Element not found: ${selector}`);
  return box;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Three-zone layout", () => {
  test("renders explorer, editor pane, and terminal pane as three columns", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // All three zones visible
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator(".pane-leaf--editor")).toBeVisible();
    await expect(page.locator(".pane-leaf--terminal")).toBeVisible();
    const sidebarBox = await getBoundingBox(page, '[data-testid="sidebar"]');
    expect(Math.round(sidebarBox.width)).toBeLessThanOrEqual(175);

    // Editor is to the left of terminal
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");
    const terminalBox = await getBoundingBox(page, ".pane-leaf--terminal");
    expect(editorBox.x).toBeLessThan(terminalBox.x);

    await cleanup();
  });

});

test.describe("Drag editor tab over terminal pane", () => {
  test("does NOT produce drop zones on terminal pane", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();
    await expect(page.getByTestId("editor-title")).toHaveText("related-note");

    // Get the editor tab position (the "related-note" tab)
    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();
    expect(editorTabBox).not.toBeNull();

    // Get terminal pane center
    const terminalCenter = await getCenter(page, ".pane-leaf--terminal");

    // Drag editor tab toward terminal pane (don't release yet)
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      terminalCenter,
      { drop: false },
    );

    // Check: NO drop zone overlays should be visible
    const dropZones = await page.locator(".leaf-drop-zone--active").count();
    expect(dropZones).toBe(0);

    // Also check for old dock-drop-zone system
    const dockDropZones = await page.locator(".dock-drop-zone--active").count();
    expect(dockDropZones).toBe(0);

    // Release
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The app should NOT be blank — editor and terminal still visible
    await expect(page.locator(".pane-leaf--editor")).toBeVisible();
    await expect(page.locator(".pane-leaf--terminal")).toBeVisible();

    await cleanup();
  });

  test("does NOT cause blank canvas when dropped on terminal pane", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // Open a second note
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();

    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();
    const terminalCenter = await getCenter(page, ".pane-leaf--terminal");

    // Full drag and drop onto terminal pane
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      terminalCenter,
    );

    // App must remain functional — not blank
    await expect(page.locator(".pane-leaf--editor")).toBeVisible();
    await expect(page.locator(".pane-leaf--terminal")).toBeVisible();
    await expect(page.getByTestId("sidebar")).toBeVisible();

    // Editor should still have content
    await expect(page.getByTestId("editor-panel")).toBeVisible();

    await cleanup();
  });
});

test.describe("Drag within editor zone", () => {
  test("drag ghost appears when dragging editor tab", async () => {
    const { page, cleanup } = await launchExoWorkspaceFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();

    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");

    // Drag within editor zone (move to a different position within editor)
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height * 0.8 },
      { drop: false },
    );

    // Drag ghost should be visible
    await expect(page.locator(".drag-ghost")).toBeVisible();

    await page.mouse.up();

    // After release, drag ghost should be gone
    await expect(page.locator(".drag-ghost")).toHaveCount(0);

    await cleanup();
  });
});

test.describe("Within-zone splits", () => {
  test("dropping editor tab on edge of editor pane creates a split", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();
    await expect(page.getByTestId("editor-title")).toHaveText("related-note");

    // Verify we start with 1 editor pane
    const editorPanesBefore = await page.locator(".pane-leaf--editor").count();
    expect(editorPanesBefore).toBe(1);

    // Get the editor tab and pane positions
    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");

    // Drag to the right edge of the editor pane (right 12.5% = right drop zone)
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      { x: editorBox.x + editorBox.width * 0.9, y: editorBox.y + editorBox.height / 2 },
    );

    // Should now have 2 editor panes (split happened)
    await expect(page.locator(".pane-leaf--editor")).toHaveCount(2);

    // Terminal pane should be unaffected
    await expect(page.locator(".pane-leaf--terminal")).toBeVisible();

    await cleanup();
  });

  test("dragging a split terminal tab back to another terminal tab group merges panes", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    await page.evaluate(async () => {
      await window.exo.terminals.create({ kind: "shell" });
    });
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(2);

    const terminalBox = await getBoundingBox(page, ".pane-leaf--terminal");
    const secondTabBox = await page.getByTestId("terminal-tab-shell").nth(1).boundingBox();
    expect(secondTabBox).not.toBeNull();

    await manualDrag(
      page,
      { x: secondTabBox!.x + secondTabBox!.width / 2, y: secondTabBox!.y + secondTabBox!.height / 2 },
      { x: terminalBox.x + terminalBox.width / 2, y: terminalBox.y + terminalBox.height * 0.9 },
    );

    await expect(page.locator(".pane-leaf--terminal")).toHaveCount(2);

    const sourceTabBox = await page.locator(".pane-leaf--terminal").nth(1).getByTestId("terminal-tab-shell").first().boundingBox();
    const targetTabBox = await page.locator(".pane-leaf--terminal").first().getByTestId("terminal-tab-shell").first().boundingBox();
    expect(sourceTabBox).not.toBeNull();
    expect(targetTabBox).not.toBeNull();

    await manualDrag(
      page,
      { x: sourceTabBox!.x + sourceTabBox!.width / 2, y: sourceTabBox!.y + sourceTabBox!.height / 2 },
      { x: targetTabBox!.x + targetTabBox!.width / 2, y: targetTabBox!.y + targetTabBox!.height / 2 },
    );

    await expect(page.locator(".pane-leaf--terminal")).toHaveCount(1);
    await expect(page.locator(".pane-leaf--terminal").first().getByTestId("terminal-tab-shell")).toHaveCount(2);

    await cleanup();
  });
});

test.describe("Cross-zone terminal tab moves", () => {
  test("dragging a terminal tab into the editor canvas creates a terminal pane there", async () => {
    const { page, settingsPath, cleanup } = await launchExoTerminalFixture();

    const terminalTabBox = await page.getByTestId("terminal-tab-shell").first().boundingBox();
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");
    expect(terminalTabBox).not.toBeNull();

    await manualDrag(
      page,
      { x: terminalTabBox!.x + terminalTabBox!.width / 2, y: terminalTabBox!.y + terminalTabBox!.height / 2 },
      { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height / 2 },
    );

    await expect(page.locator(".workspace__body .pane-leaf--editor")).toBeVisible();
    await expect(page.locator(".workspace__body .pane-leaf--terminal")).toHaveCount(1);
    await expect(page.locator(".workspace__body .pane-leaf--terminal").getByTestId("terminal-tab-shell")).toBeVisible();

    const editorTabStripBox = await page.locator(".workspace__body .pane-leaf--editor .tab-strip").first().boundingBox();
    const canvasTerminalHeaderBox = await page.locator(".workspace__body .pane-leaf--terminal .terminal-dock__header").first().boundingBox();
    expect(editorTabStripBox).not.toBeNull();
    expect(canvasTerminalHeaderBox).not.toBeNull();
    expect(Math.abs(editorTabStripBox!.height - canvasTerminalHeaderBox!.height)).toBeLessThanOrEqual(1);

    await expect.poll(async () => {
      const settings = JSON.parse(await readFile(settingsPath, "utf8"));
      return settings.layout?.terminalCollapsed === true && settings.layout?.editorTree
        ? JSON.stringify(settings.layout.editorTree).includes('"kind":"terminal"')
        : false;
    }).toBe(true);

    await page.reload();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator(".workspace__body .pane-leaf--terminal").getByTestId("terminal-tab-shell")).toBeVisible();

    await cleanup();
  });

  test("dragging an editor tab onto a canvas terminal pane splits the shared graph", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    const terminalTabBox = await page.getByTestId("terminal-tab-shell").first().boundingBox();
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");
    expect(terminalTabBox).not.toBeNull();

    await manualDrag(
      page,
      { x: terminalTabBox!.x + terminalTabBox!.width / 2, y: terminalTabBox!.y + terminalTabBox!.height / 2 },
      { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height / 2 },
    );

    await expect(page.locator(".workspace__body .pane-leaf--terminal")).toHaveCount(1);

    const editorTabBox = await page.locator(".workspace__body .pane-leaf--editor .chrome-tab").first().boundingBox();
    const canvasTerminalBox = await page.locator(".workspace__body .pane-leaf--terminal").first().boundingBox();
    expect(editorTabBox).not.toBeNull();
    expect(canvasTerminalBox).not.toBeNull();

    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      { x: canvasTerminalBox!.x + canvasTerminalBox!.width * 0.9, y: canvasTerminalBox!.y + canvasTerminalBox!.height / 2 },
    );

    await expect(page.locator(".workspace__body .pane-leaf--terminal")).toHaveCount(1);
    await expect(page.locator(".workspace__body .pane-leaf--editor")).toHaveCount(2);

    await cleanup();
  });

  test("workspace terminal panes stream input and prune when closed", async () => {
    const { page, cleanup } = await launchExoTerminalFixture({
      env: {
        EXO_SHELL: "/bin/cat",
        EXO_SHELL_ARGS: "",
      },
    });

    const terminalTabBox = await page.getByTestId("terminal-tab-shell").first().boundingBox();
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");
    expect(terminalTabBox).not.toBeNull();

    await manualDrag(
      page,
      { x: terminalTabBox!.x + terminalTabBox!.width / 2, y: terminalTabBox!.y + terminalTabBox!.height / 2 },
      { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height / 2 },
    );

    const workspaceTerminal = page.locator(".workspace__body .pane-leaf--terminal").first();
    await expect(workspaceTerminal).toBeVisible();

    await workspaceTerminal.getByTestId("terminal-surface").click();
    await page.keyboard.type("canvas terminal\n");
    await expect(workspaceTerminal.locator(".xterm-rows")).toContainText("canvas terminal");

    await workspaceTerminal.getByTestId("close-terminal-shell").click();
    await expect(page.locator(".workspace__body .pane-leaf--terminal")).toHaveCount(0);
    await expect(page.locator(".workspace__body .pane-leaf--editor")).toBeVisible();

    await cleanup();
  });
});

test.describe("Explorer file moves", () => {
  test("dragging a folder onto another folder moves it there", async () => {
    const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
      mutable: true,
      prepareWorkspace: async (root) => {
        await mkdir(path.join(root, "notes/test-notes/source-dir"), { recursive: true });
        await mkdir(path.join(root, "notes/test-notes/target-dir"), { recursive: true });
        await writeFile(path.join(root, "notes/test-notes/source-dir/nested.md"), "# Nested\n");
      },
    });

    const source = page.locator(".tree-node--directory", { hasText: "source-dir" }).first();
    const target = page.locator(".tree-node--directory", { hasText: "target-dir" }).first();
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await manualDrag(
      page,
      { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
      { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
    );

    await expect.poll(async () => {
      try {
        await access(path.join(workspaceRoot, "notes/test-notes/target-dir/source-dir/nested.md"));
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
    await expect(page.locator(".tree-node--directory", { hasText: "source-dir" }).first()).toBeVisible();
    await target.click();
    await expect(page.locator(".tree-node--directory", { hasText: "source-dir" })).toHaveCount(0);

    await cleanup();
  });

  test("dragging a folder onto an existing destination shows a conflict dialog", async () => {
    const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
      mutable: true,
      prepareWorkspace: async (root) => {
        await mkdir(path.join(root, "notes/test-notes/source-dir"), { recursive: true });
        await writeFile(path.join(root, "notes/test-notes/source-dir/nested.md"), "# Nested\n");
        await mkdir(path.join(root, "notes/test-notes/target-dir/source-dir"), { recursive: true });
        await writeFile(path.join(root, "notes/test-notes/target-dir/source-dir/existing.md"), "# Existing\n");
      },
    });

    const source = page.locator(".tree-node--directory", { hasText: "source-dir" }).first();
    const target = page.locator(".tree-node--directory", { hasText: "target-dir" }).first();
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await manualDrag(
      page,
      { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
      { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
    );

    await expect(page.getByTestId("workspace-dialog")).toContainText("Destination already exists");
    await expect(page.getByTestId("workspace-dialog")).toContainText("will not merge or overwrite");
    await access(path.join(workspaceRoot, "notes/test-notes/source-dir/nested.md"));
    await access(path.join(workspaceRoot, "notes/test-notes/target-dir/source-dir/existing.md"));

    await cleanup();
  });

  test("dragging a nested folder onto notes whitespace moves it to the root", async () => {
    const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
      mutable: true,
      prepareWorkspace: async (root) => {
        await mkdir(path.join(root, "notes/test-notes/parent-dir/nested-dir"), { recursive: true });
        await writeFile(path.join(root, "notes/test-notes/parent-dir/nested-dir/nested.md"), "# Nested\n");
      },
    });

    const parent = page.locator(".tree-node--directory", { hasText: "parent-dir" }).first();
    await expect(parent).toBeVisible();
    await parent.click();

    const source = page.locator(".tree-node--directory", { hasText: "nested-dir" }).first();
    await expect(source).toBeVisible();

    const sourceBox = await source.boundingBox();
    const notesBox = await page.locator(".sidebar__content--notes").boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(notesBox).not.toBeNull();

    await manualDrag(
      page,
      { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
      { x: notesBox!.x + notesBox!.width / 2, y: notesBox!.y + notesBox!.height - 24 },
    );

    await expect.poll(async () => {
      try {
        await access(path.join(workspaceRoot, "notes/test-notes/nested-dir/nested.md"));
        return true;
      } catch {
        return false;
      }
    }).toBe(true);

    await cleanup();
  });

  test("dragging a nested folder onto a root file moves it to the root", async () => {
    const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
      mutable: true,
      prepareWorkspace: async (root) => {
        await mkdir(path.join(root, "notes/test-notes/parent-dir/nested-dir"), { recursive: true });
        await writeFile(path.join(root, "notes/test-notes/parent-dir/nested-dir/nested.md"), "# Nested\n");
        await writeFile(path.join(root, "notes/test-notes/root-drop-target.md"), "# Root Target\n");
      },
    });

    const parent = page.locator(".tree-node--directory", { hasText: "parent-dir" }).first();
    await expect(parent).toBeVisible();
    await parent.click();

    const source = page.locator(".tree-node--directory", { hasText: "nested-dir" }).first();
    const target = page.locator(".tree-node--file", { hasText: "root-drop-target" }).first();
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await manualDrag(
      page,
      { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 },
      { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
    );

    await expect.poll(async () => {
      try {
        await access(path.join(workspaceRoot, "notes/test-notes/nested-dir/nested.md"));
        return true;
      } catch {
        return false;
      }
    }).toBe(true);

    await cleanup();
  });
});

test.describe("Post-drag app stability", () => {
  test("app remains functional after dragging editor tab anywhere and releasing", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // Open a second note
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();

    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();

    // Drag to multiple positions and release each time
    const targets = [
      await getCenter(page, ".pane-leaf--terminal"),  // over terminal
      await getCenter(page, ".pane-leaf--editor"),     // back to editor
      { x: 100, y: 100 },                              // over sidebar
    ];

    for (const target of targets) {
      await manualDrag(
        page,
        { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
        target,
      );

      // After each drag, app should still be intact
      await expect(page.locator(".pane-leaf--editor")).toBeVisible();
      await expect(page.locator(".pane-leaf--terminal")).toBeVisible();
      await expect(page.getByTestId("sidebar")).toBeVisible();
    }

    await cleanup();
  });

  test("drop zones appear on same-kind panes but NOT on cross-kind panes", async () => {
    const { page, cleanup } = await launchExoTerminalFixture();

    // Open a second note
    await page.getByTestId("workspace-titlebar-connections").click();
    await page.getByTestId("backlinks-panel").getByText("Related Note").click();

    const editorTabBox = await page.locator(".chrome-tab--active").first().boundingBox();

    // Drag editor tab over editor pane — drop zones SHOULD appear (same kind)
    const editorCenter = await getCenter(page, ".pane-leaf--editor");
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      editorCenter,
      { drop: false },
    );

    const leafDropZones = await page.locator(".leaf-drop-zones").count();
    expect(leafDropZones).toBeGreaterThan(0);

    await page.mouse.up();
    await page.waitForTimeout(100);

    // Now drag editor tab over terminal pane — NO drop zones (cross kind)
    const terminalCenter = await getCenter(page, ".pane-leaf--terminal");
    await manualDrag(
      page,
      { x: editorTabBox!.x + editorTabBox!.width / 2, y: editorTabBox!.y + editorTabBox!.height / 2 },
      terminalCenter,
      { drop: false },
    );

    const dropZonesOnTerminal = await page.locator(".leaf-drop-zones").count();
    expect(dropZonesOnTerminal).toBe(0);

    // Also verify no old dock-drop-zones system
    const dockDropZones = await page.locator(".dock-drop-zones").count();
    expect(dockDropZones).toBe(0);

    await page.mouse.up();
    await cleanup();
  });
});
