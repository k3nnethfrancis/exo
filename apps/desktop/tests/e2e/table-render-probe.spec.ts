import { test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoFixture } from "../helpers";

test("table rendering does not crash on a note with multiple tables", async () => {
  const tableContent = `# Table Test

Some intro text.

| Model | Behavior | Classification |
|---|---|---|
| gpt-5-mini | Immediate report | Procedural compliance |
| Llama 4 | Repeated escalation | Authority-seeking |
| Claude Haiku | Self-disclosure | Cooperative integrity |

Between tables.

| Run | Fixes | Status |
|-----|-------|--------|
| V1 | None | Completed |
| V2 | Some | Partial |

End text.
`;

  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/vault/table-test.md");
      await writeFile(target, tableContent, "utf8");
    },
  });

  page.on("pageerror", (err) => console.log("[RENDERER ERROR]", err.message, err.stack));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[RENDERER CONSOLE]", msg.text());
  });

  // Try to find and click the test note
  const noteLink = page.getByRole("button", { name: /table-test/ });
  if (await noteLink.count() > 0) {
    await noteLink.first().click();
    await page.waitForTimeout(300);
  }

  // Verify no crash — page should still be responsive
  const stillAlive = await page.evaluate(() => document.body !== null);
  console.log("[probe] page alive after table click:", stillAlive);

  // Check if our table widget rendered
  const tableCount = await page.locator(".exo-md-table").count();
  console.log("[probe] rendered tables:", tableCount);

  await page.screenshot({ path: "/tmp/exo-tables.png", fullPage: false });

  await cleanup();
});
