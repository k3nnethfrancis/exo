import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoFixture } from "../helpers";

test("renders underscore thematic breaks in markdown live preview", async () => {
  const markdownContent = `# Rule Test

Above.

___

Below.
`;

  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/shoshin-codex/rule-test.md");
      await writeFile(target, markdownContent, "utf8");
    },
  });

  await page.getByRole("button", { name: /rule-test/i }).first().click();

  await expect(page.locator(".exo-md-line--rule")).toHaveCount(1);
  await expect(page.locator(".exo-md-line--rule .exo-md-syntax-hidden")).toContainText("___");
  await expect(page.locator(".exo-md-line--rule")).toHaveCSS("border-top-style", "solid");

  await cleanup();
});
