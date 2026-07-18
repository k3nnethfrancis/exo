import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("finds and opens a note from the titlebar without opening Explorer", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  try {
    await page.getByTestId("workspace-titlebar-sidebar").click();
    await expect(page.getByTestId("workspace-titlebar-sidebar")).toHaveAttribute("aria-pressed", "false");

    const search = page.getByTestId("workspace-search-input");
    await search.fill("agent-memory");

    const popover = page.getByTestId("workspace-search-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("button", { name: /agent-memory/i })).toBeVisible();
    await expect(page.getByTestId("workspace-titlebar-sidebar")).toHaveAttribute("aria-pressed", "false");

    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId("workspace-titlebar-sidebar")).toHaveAttribute("aria-pressed", "false");

    await search.fill("agent-memory");
    await popover.getByRole("button", { name: /agent-memory/i }).click();
    await expect(page.getByTestId("editor-title")).toHaveText("agent-memory");
    await expect(search).toHaveValue("");
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId("workspace-titlebar-sidebar")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanup();
  }
});
