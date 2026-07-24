import { expect, test } from "@playwright/test";

import { launchExoWorkspaceFixture } from "../helpers";

test("enables native spellchecking in the Markdown editor", async () => {
  const fixture = await launchExoWorkspaceFixture();

  try {
    await expect(fixture.page.locator(".editor-surface .cm-content")).toHaveAttribute("spellcheck", "true");
  } finally {
    await fixture.cleanup();
  }
});
