import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { launchExoWorkspaceFixture } from "../helpers";

test("renders underscore thematic breaks in markdown live preview", async () => {
  const markdownContent = `# Rule Test

Above.

___

Below.
`;

  const { page, cleanup } = await launchExoWorkspaceFixture({
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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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

test("renders ordered-list markers at the text size and vertical center", async ({}, testInfo) => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/ordered-list-rendering.md");
      await writeFile(target, "# Ordered list\n\n1. First item\n2. Second item\n", "utf8");
    },
  });

  try {
    await page.getByRole("button", { name: /ordered-list-rendering/i }).first().click();
    const firstItem = page.locator(".exo-md-line--list-ordered").first();

    await expect.poll(() => firstItem.evaluate((line) => {
      const lineStyle = window.getComputedStyle(line);
      const markerStyle = window.getComputedStyle(line, "::before");
      return {
        content: markerStyle.content,
        fontSize: markerStyle.fontSize,
        lineFontSize: lineStyle.fontSize,
        top: markerStyle.top,
        paddingRight: markerStyle.paddingRight,
        boxSizing: markerStyle.boxSizing,
        fontWeight: markerStyle.fontWeight,
      };
    })).toEqual({
      content: '"1."',
      fontSize: "16px",
      lineFontSize: "16px",
      top: "0px",
      paddingRight: "5px",
      boxSizing: "border-box",
      fontWeight: "500",
    });
    await page.screenshot({ path: testInfo.outputPath("ordered-list-markers.png") });
  } finally {
    await cleanup();
  }
});

test("continues and exits markdown task list items in live preview", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
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

test("Tab and Enter exit wikilinks without adding whitespace", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
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
    .toContain("Discuss [[customer-name]]today");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.selection.main.head ?? -1;
      }),
    )
    .toBe("# Wikilink Edit Test\n\nDiscuss [[customer-name]]".length);

  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const pos = view.state.doc.toString().indexOf("[[account-name]]") + "[[account-name".length;
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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.selection.main.head ?? -1;
      }),
    )
    .toBe("# Wikilink Edit Test\n\nDiscuss [[customer-name]]today\nNext [[account-name]]".length);

  await cleanup();
});

test("suggests existing note targets while typing wikilinks", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
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
  await expect(page.getByTestId("wikilink-suggestions")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        const view = content?.cmView?.view;
        if (!view) {
          return -1;
        }
        return view.state.selection.main.head;
      }),
    )
    .toBe("# Wikilink Suggest Test\n\n[[customer-alpha]]".length);

  await page.keyboard.type("\n[[no-such-existing-note");
  await expect(page.getByTestId("wikilink-suggestions")).toHaveCount(0);

  await cleanup();
});

test("keeps wikilink completion overlays outside editor clipping", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (workspaceRoot) => {
      const notesRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(path.join(notesRoot, "short-wikilink-popup.md"), "# Short Wikilink Popup\n\n", "utf8");
      await writeFile(path.join(notesRoot, "goals.md"), "# Goals\n", "utf8");
      await writeFile(path.join(notesRoot, "governance.md"), "# Governance\n", "utf8");
      await writeFile(path.join(notesRoot, "goose.md"), "# Goose\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /short-wikilink-popup/i }).first().click();
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

  await page.keyboard.type("[[go");
  await expect(page.getByTestId("wikilink-suggestions")).toBeVisible();
  await expect(page.locator(".wikilink-suggestions__item")).toHaveCount(3);
  await expect
    .poll(() =>
      page.getByTestId("wikilink-suggestions").evaluate((node) => {
        const popup = node.getBoundingClientRect();
        let current = node.parentElement;
        while (current) {
          const style = window.getComputedStyle(current);
          const clips = [style.overflow, style.overflowX, style.overflowY].some((value) => value === "hidden" || value === "clip");
          if (clips) {
            const rect = current.getBoundingClientRect();
            if (popup.bottom > rect.bottom || popup.right > rect.right || popup.left < rect.left || popup.top < rect.top) {
              return false;
            }
          }
          current = current.parentElement;
        }
        return true;
      }),
    )
    .toBe(true);

  await cleanup();
});

test("lets Enter add a line above a first-line wikilink", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    initialNoteLabel: null,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/top-line-wikilink.md");
      await writeFile(target, "[[goals]]\n", "utf8");
      await writeFile(path.join(workspaceRoot, "notes/test-notes/goals.md"), "# Goals\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /top-line-wikilink/i }).first().click();
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: 0 } });
    view.focus();
  });

  await expect(page.getByTestId("wikilink-suggestions")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.doc.toString() ?? "";
      }),
    )
    .toBe("\n[[goals]]\n");

  await cleanup();
});

test("keeps generated graph references outside editable list layout", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const notesRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(path.join(notesRoot, "source-ref.md"), "See [[refs-list-target]].\n", "utf8");
      await writeFile(path.join(notesRoot, "refs-list-target.md"), "# Refs List Target\n\n- \n", "utf8");
    },
  });

  await page.getByRole("button", { name: /refs-list-target/i }).first().click();
  const referencesSection = page.locator("section.markdown-graph-references");
  await expect(referencesSection).toBeVisible();
  await expect
    .poll(() =>
      referencesSection.evaluate((node) => ({
        editable: node.getAttribute("contenteditable"),
        linePaddingLeft: window.getComputedStyle(node.closest(".cm-line") ?? node).paddingLeft,
        bulletContent: window.getComputedStyle(node.closest(".cm-line") ?? node, "::before").content,
      })),
    )
    .toEqual({ editable: "false", linePaddingLeft: "0px", bulletContent: "none" });

  await cleanup();
});

test("keeps cursor and shortcut selections out of rendered list markers", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      const target = path.join(workspaceRoot, "notes/test-notes/list-cursor-boundaries.md");
      await writeFile(target, "# List Cursor Boundaries\n\nBefore\n- first item\n- second item\n", "utf8");
    },
  });

  await page.getByRole("button", { name: /list-cursor-boundaries/i }).first().click();
  await page.locator(".cm-content").click();

  const positions = await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const doc = view.state.doc.toString();
    return {
      firstMarkerStart: doc.indexOf("- first item"),
      firstTextStart: doc.indexOf("- first item") + "- ".length,
      secondMarkerStart: doc.indexOf("- second item"),
      secondTextStart: doc.indexOf("- second item") + "- ".length,
      secondLineEnd: doc.indexOf("- second item") + "- second item".length,
    };
  });

  await page.evaluate(({ firstMarkerStart }) => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: firstMarkerStart } });
    view.focus();
  }, positions);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.selection.main.head ?? -1;
      }),
    )
    .toBe(positions.firstTextStart);

  await page.evaluate(({ secondLineEnd }) => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: secondLineEnd } });
    view.focus();
  }, positions);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+ArrowLeft" : "Control+Shift+ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        const selection = content?.cmView?.view?.state.selection.main;
        return selection ? { anchor: selection.anchor, head: selection.head } : null;
      }),
    )
    .toEqual({ anchor: positions.secondLineEnd, head: positions.secondTextStart });

  await page.evaluate(({ secondTextStart }) => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({ selection: { anchor: secondTextStart } });
    view.focus();
  }, positions);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
        return content?.cmView?.view?.state.selection.main.head ?? -1;
      }),
    )
    .toBe(positions.secondMarkerStart + 1);

  await cleanup();
});
