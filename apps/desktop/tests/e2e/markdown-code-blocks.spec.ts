import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoFixture } from "../helpers";

test("renders fenced code blocks in markdown live preview", async () => {
  const markdownContent = `# Code Block Test

Before.

\`\`\`python
def hello(name: str) -> str:
    return f"hi {name}"  # not-a-tag
\`\`\`

\`\`\`json
{
  "link": "[not a link](target.md)"
}
\`\`\`

\`\`\`
cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover cover
\`\`\`
---

After.
`;

  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/vault/code-block-test.md");
      await writeFile(target, markdownContent, "utf8");
    },
  });

  await page.getByRole("button", { name: /code-block-test/i }).first().click();

  await expect.poll(() => page.locator(".exo-md-line--codeblock").count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator(".exo-md-line--codeblock-start")).toHaveCount(3);
  await expect(page.locator(".exo-md-line--codeblock-end")).toHaveCount(3);
  await expect(page.locator(".exo-md-line--codeblock .exo-md-tag")).toHaveCount(0);
  await expect(page.locator(".exo-md-line--codeblock .exo-md-link")).toHaveCount(0);

  const longCodeLine = page.locator(".exo-md-line--codeblock").filter({ hasText: /^cover cover/ }).first();
  await expect(longCodeLine).toBeVisible();
  await expect(longCodeLine).toHaveCSS("white-space", "pre-wrap");
  await expect.poll(async () => {
    return longCodeLine.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  }).toBe(true);

  const finalCodeLine = page.locator(".exo-md-line--codeblock-end").last();
  const ruleLine = page.locator(".exo-md-line--rule").first();
  await expect(ruleLine).toBeVisible();
  const codeBox = await finalCodeLine.boundingBox();
  const ruleBox = await ruleLine.boundingBox();
  expect(codeBox).not.toBeNull();
  expect(ruleBox).not.toBeNull();
  const gap = ruleBox!.y - (codeBox!.y + codeBox!.height);
  expect(gap).toBeGreaterThan(8);

  await cleanup();
});
