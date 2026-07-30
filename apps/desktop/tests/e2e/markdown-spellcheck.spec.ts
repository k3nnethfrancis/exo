import { expect, test } from "@playwright/test";

import { launchExographWorkspaceFixture } from "../helpers";

test("enables native spellchecking in the Markdown editor", async () => {
  const fixture = await launchExographWorkspaceFixture();

  try {
    await expect(fixture.page.locator(".editor-surface .cm-content")).toHaveAttribute("spellcheck", "true");
  } finally {
    await fixture.cleanup();
  }
});
