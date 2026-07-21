import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("toggles shell panels from the keyboard and exposes compact operator help", async () => {
  const fixture = await launchExoWorkspaceFixture();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  try {
    const explorerToggle = fixture.page.getByTestId("workspace-titlebar-sidebar");
    await expect(explorerToggle).toHaveAttribute("aria-pressed", "true");
    await fixture.page.keyboard.press(`${modifier}+B`);
    await expect(explorerToggle).toHaveAttribute("aria-pressed", "false");
    await fixture.page.keyboard.press(`${modifier}+B`);
    await expect(explorerToggle).toHaveAttribute("aria-pressed", "true");

    const utilityToggle = fixture.page.getByTestId("utility-pane-toggle");
    await expect(utilityToggle).toHaveAttribute("aria-pressed", "false");
    await fixture.page.keyboard.press(`${modifier}+Alt+B`);
    await expect(utilityToggle).toHaveAttribute("aria-pressed", "true");
    await fixture.page.keyboard.press(`${modifier}+Alt+B`);
    await expect(utilityToggle).toHaveAttribute("aria-pressed", "false");

    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await fixture.page.getByTestId("workspace-menu-help").click();
    const help = fixture.page.getByTestId("workspace-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText("Keyboard");
    await expect(help).toContainText("CLI");
    await expect(help).toContainText("exo status");
    await expect(help).toContainText(process.platform === "darwin" ? "⌘ B" : "Ctrl B");
    await fixture.page.keyboard.press("Escape");
    await fixture.page.getByTestId("workspace-menu-toggle").click();
    await expect(fixture.page.getByTestId("workspace-menu-settings")).toBeVisible();
    await expect(fixture.page.getByTestId("workspace-help")).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});
