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
      const target = path.join(workspaceRoot, "notes/test-notes/rule-test.md");
      await writeFile(target, markdownContent, "utf8");
    },
  });

  await page.getByRole("button", { name: /rule-test/i }).first().click();

  await expect(page.locator(".exo-md-line--rule")).toHaveCount(1);
  await expect(page.locator(".exo-md-line--rule .exo-md-syntax-hidden")).toContainText("___");
  await expect(page.locator(".exo-md-line--rule")).toHaveCSS("border-top-style", "solid");

  await cleanup();
});

test("continues and exits markdown bullets in live preview", async () => {
  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/list-edit-test.md");
      await writeFile(target, "# List Edit Test\n\n- account strategy\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /list-edit-test/i }).first().click();
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const target = view.state.doc.toString().indexOf("- account strategy") + "- account strategy".length;
    view.dispatch({ selection: { anchor: target } });
    view.focus();
  });

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toBe("# List Edit Test\n\n- account strategy\n- \n");

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toBe("# List Edit Test\n\n- account strategy\n\n");

  await cleanup();
});

test("continues and exits markdown task list items in live preview", async () => {
  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/task-list-edit-test.md");
      await writeFile(target, "# Task List Edit Test\n\n- [x] follow up\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /task-list-edit-test/i }).first().click();
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const target = view.state.doc.toString().indexOf("- [x] follow up") + "- [x] follow up".length;
    view.dispatch({ selection: { anchor: target } });
    view.focus();
  });

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toBe("# Task List Edit Test\n\n- [x] follow up\n- [ ] \n");

  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toBe("# Task List Edit Test\n\n- [x] follow up\n\n");

  await cleanup();
});

test("Tab and Enter exit wikilinks to a following space", async () => {
  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/wikilink-edit-test.md");
      await writeFile(target, "# Wikilink Edit Test\n\nDiscuss [[customer-name]]today\nNext [[account-name]] step\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /wikilink-edit-test/i }).first().click();
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const pos = view.state.doc.toString().indexOf("[[customer-name]]") + "[[customer-name".length;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  });
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toContain("Discuss [[customer-name]] today");

  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const pos = view.state.doc.toString().indexOf("[[account-name]]") + "[[account-name]]".length;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  });
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toContain("Next [[account-name]] step");

  await cleanup();
});

test("suggests existing note targets while typing wikilinks", async () => {
  const { page, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const notesRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(path.join(notesRoot, "wikilink-suggest-test.md"), "# Wikilink Suggest Test\n\n", "utf8");
      await writeFile(path.join(notesRoot, "customer-alpha.md"), "# Customer Alpha\n", "utf8");
      await writeFile(path.join(notesRoot, "customer-beta.md"), "# Customer Beta\n", "utf8");
      await writeFile(path.join(notesRoot, "customer-gamma.md"), "# Customer Gamma\n", "utf8");
      await writeFile(path.join(notesRoot, "customer-delta.md"), "# Customer Delta\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /wikilink-suggest-test/i }).first().click();
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });

  await page.keyboard.type("[[cus");
  await expect(page.getByTestId("wikilink-suggestions")).toBeVisible();
  await expect(page.locator(".wikilink-suggestions__item")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toContain("[[customer-alpha]]");

  await page.keyboard.type("\n[[no-such-existing-note");
  await expect(page.getByTestId("wikilink-suggestions")).toHaveCount(0);

  await cleanup();
});
