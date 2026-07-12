import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("splits editor panes without creating terminal or preview canvas leaves", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    const source = await page.locator(".tab-strip__tab").first().boundingBox();
    const editor = await page.locator(".workspace-shell__canvas .pane-leaf--editor").first().boundingBox();
    expect(source).not.toBeNull();
    expect(editor).not.toBeNull();

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(editor!.x + editor!.width * 0.88, editor!.y + editor!.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(".workspace-shell__canvas .pane-leaf--editor")).toHaveCount(2);
    await expect(page.locator(".workspace-shell__canvas .pane-leaf--terminal, .workspace-shell__canvas .pane-leaf--browser")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});
