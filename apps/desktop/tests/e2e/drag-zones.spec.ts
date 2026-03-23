/**
 * Drag zone behavior tests.
 *
 * Rules:
 * 1. Three columns: explorer | editor pane | terminal pane
 * 2. You can drag tabs within the same zone to split that zone
 * 3. You CANNOT drag editor/notes tabs into the terminal zone
 * 4. You CAN drag terminal tabs into the editor zone
 * 5. No drag operation should ever produce a blank canvas
 */

import { test, expect, type Page } from "@playwright/test";
import { launchExoFixture } from "../helpers";

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
    const { page, cleanup } = await launchExoFixture();

    // All three zones visible
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator(".pane-leaf--editor")).toBeVisible();
    await expect(page.locator(".pane-leaf--terminal")).toBeVisible();

    // Editor is to the left of terminal
    const editorBox = await getBoundingBox(page, ".pane-leaf--editor");
    const terminalBox = await getBoundingBox(page, ".pane-leaf--terminal");
    expect(editorBox.x).toBeLessThan(terminalBox.x);

    await cleanup();
  });
});

test.describe("Drag editor tab over terminal pane", () => {
  test("does NOT produce drop zones on terminal pane", async () => {
    const { page, cleanup } = await launchExoFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("inspector-toggle").click();
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
    const { page, cleanup } = await launchExoFixture();

    // Open a second note
    await page.getByTestId("inspector-toggle").click();
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
    const { page, cleanup } = await launchExoFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("inspector-toggle").click();
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
    const { page, cleanup } = await launchExoFixture();

    // Open a second note so we have a tab to drag
    await page.getByTestId("inspector-toggle").click();
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
});

test.describe("Post-drag app stability", () => {
  test("app remains functional after dragging editor tab anywhere and releasing", async () => {
    const { page, cleanup } = await launchExoFixture();

    // Open a second note
    await page.getByTestId("inspector-toggle").click();
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
    const { page, cleanup } = await launchExoFixture();

    // Open a second note
    await page.getByTestId("inspector-toggle").click();
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
