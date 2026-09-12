import { expect, test } from "@playwright/test";
import { launchExographWorkspaceFixture } from "../helpers";

test("Settings contains keyboard focus, respects child Escape, and restores the menu opener", async () => {
  const fixture = await launchExographWorkspaceFixture({ mutable: true });
  const { page } = fixture;
  try {
    const menu = page.getByTestId("workspace-menu-toggle");
    await menu.click();
    await page.getByTestId("workspace-menu-settings").click();
    const dialog = page.getByRole("dialog", { name: "Workspace Settings", exact: true });
    const close = page.getByTestId("workspace-settings-close");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(close).toBeFocused();
    // Pending structural changes provide the last Apply control from the report.
    await page.getByTestId("workspace-settings-workspace-root").fill(`${fixture.workspaceRoot}/pending-root`);
    await page.getByTestId("workspace-settings-tab-terminal").click();
    const font = page.getByTestId("workspace-settings-terminal-font-size");
    await font.focus();
    await font.press("Tab");
    await expect(page.getByTestId("workspace-settings-apply")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("workspace-settings-apply")).toBeFocused();

    // A child recorder/popover can consume its own first Escape.
    await font.focus();
    await font.evaluate(element => element.addEventListener("keydown", event => {
      if ((event as KeyboardEvent).key === "Escape") event.preventDefault();
    }, { once: true }));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
    // Closing through Escape preserves the existing non-structural-only path.
    expect(await page.evaluate(async () => (await window.exograph.workspace.getSettings()).settings)).toMatchObject({ workspaceRoot: fixture.workspaceRoot });
  } finally {
    await fixture.cleanup();
  }
});
