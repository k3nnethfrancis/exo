import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

async function cycleAppearanceTo(page: import("@playwright/test").Page, targetMode: "system" | "light" | "dark") {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentMode = await page.locator("html").getAttribute("data-appearance-mode");
    if (currentMode === targetMode) {
      return;
    }

    await page.getByTestId("appearance-cycle").click();
  }

  throw new Error(`Unable to reach appearance mode ${targetMode}.`);
}

test("boots the shell, opens notes, and manages terminal tabs", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("editor-title")).toHaveText("focus-note");
  await expect(page.getByTestId("editor-panel")).toContainText("Linked references:");
  await expect(page.getByTestId("editor-panel")).toContainText("agent-memory");
  await expect(page.getByTestId("editor-panel")).toContainText("#research");
  await page.getByTestId("toggle-markdown-mode").click();
  await expect(page.getByTestId("editor-panel")).toContainText("[[agent-memory]]");

  await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();

  await page.getByTestId("launch-claude").click();
  await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();

  await page.getByTestId("launch-codex").click();
  await expect(page.getByTestId("terminal-tab-codex")).toBeVisible();

  await page.getByTestId("terminal-tab-shell").dblclick();
  await expect(page.getByTestId("terminal-dock")).toBeVisible();

  await page.getByTestId("inspector-toggle").click();
  await expect(page.locator('[data-testid="tags-panel"] .tag-pill').first()).toBeVisible();
  await page.locator('[data-testid="tags-panel"] .tag-pill').first().click();
  await expect(page.getByTestId("tag-results")).toBeVisible();

  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("related-note");

  await cleanup();
});

test.skip("renders markdown decorations immediately when switching notes", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_WORKSPACE_ROOT: "/Users/kenneth/Desktop/lab",
      EXO_NOTE_ROOTS: "/Users/kenneth/Desktop/lab/notes/shoshin-codex",
      EXO_PROJECT_ROOTS: "/Users/kenneth/Desktop/lab/projects",
      EXO_DEFAULT_TERMINAL_CWD: "/Users/kenneth/Desktop/lab",
      EXO_FORCE_THEME: "light",
    },
    initialNoteLabel: null,
  });

  // Click CLAUDE note if visible, scrolling the sidebar if needed
  const claudeButton = page.getByRole("button", { name: "CLAUDE" });
  await claudeButton.scrollIntoViewIfNeeded().catch(() => {});
  await claudeButton.click({ timeout: 5000 });

  await expect.poll(async () => page.locator(".exo-md-line--heading").count()).toBeGreaterThan(1);
  await expect.poll(async () => page.locator(".exo-md-list-prefix").count()).toBeGreaterThan(0);

  await page.getByRole("button", { name: "2026-03-13" }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole("button", { name: "2026-03-13" }).click();
  await expect.poll(async () => page.locator(".exo-md-line--heading").count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator(".exo-md-list-prefix").count()).toBeGreaterThan(0);

  await cleanup();
});

test("shows a visible BrowserWindow on startup", async () => {
  const { electronApp, page, cleanup } = await launchExoFixture();

  const openWindows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length,
  );

  expect(openWindows).toBeGreaterThan(0);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();

  await cleanup();
});

test("opens project files and creates note branches", async () => {
  const { page, cleanup } = await launchExoFixture({ mutable: true });

  await page.getByTestId("project-roots-toggle").click();
  await page.getByRole("button", { name: "exo-demo" }).click();
  await page.getByRole("button", { name: "src" }).click({ button: "right" });
  await expect(page.getByText("New File")).toBeVisible();
  await page.getByText("New File").click();
  await page.getByTestId("workspace-dialog-input").fill("scratch.ts");
  await page.getByTestId("workspace-dialog-confirm").click();

  await page.getByTestId("workspace-search").fill("scratch.ts");
  await page.getByTestId("search-results").getByRole("button", { name: /scratch\.ts/i }).first().click();
  await expect(page.getByTestId("editor-title")).toHaveText("scratch.ts");
  await expect(page.getByTestId("properties-panel")).toContainText("Project file");

  await page.getByTestId("workspace-search").fill("");
  await page.getByTestId("sidebar").getByRole("button", { name: "focus-note" }).click();
  await page.getByTestId("branch-selector").selectOption("__create__");
  await expect(page.getByTestId("branch-selector")).toHaveValue(/-looms\/1\.md$/);
  await expect(page.getByTestId("branch-selector").locator("option")).toHaveCount(3);

  await cleanup();
});

test("opens a new terminal from a project folder context menu", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/pwd",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-panel")).toBeVisible();
  const directories = page.getByTestId("project-roots-panel").locator(".tree-node--directory");
  await directories.nth(0).click();
  await directories.nth(1).click({ button: "right" });
  await page.getByText("New Terminal").click();
  await expect(page.getByTestId("terminal-tab-shell").last()).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText(/exo-demo\/src|src/);

  await cleanup();
});

test("expands and collapses the project roots drawer", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--expanded/);
  await expect(page.getByTestId("project-roots-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "exo-demo" })).toBeVisible();
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);

  await cleanup();
});

test("matches system appearance by default and supports light mode override", async () => {
  const { page, cleanup } = await launchExoFixture();
  const systemTheme = await page.evaluate(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await cycleAppearanceTo(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-appearance-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await cycleAppearanceTo(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-appearance-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await cycleAppearanceTo(page, "system");
  await expect(page.locator("html")).toHaveAttribute("data-appearance-mode", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", systemTheme);

  await cleanup();
});

test("accepts terminal keyboard input", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });


  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("hello exo");
  await expect(page.getByTestId("terminal-surface")).toContainText("hello exo");

  await cleanup();
});

test("shows empty terminal dock after closing the last terminal", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("close-terminal-shell").click();
  await expect(page.getByTestId("terminal-dock")).toHaveClass(/terminal-dock--empty/);

  await cleanup();
});

test("lets you close editor tabs", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("related-note");
  await page.getByLabel("Close related-note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("focus-note");

  await cleanup();
});

test("renders inspector content when expanded", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("inspector-toggle").click();

  await expect(page.getByTestId("inspector-panel")).toContainText("Backlinks");
  await expect(page.getByTestId("inspector-panel")).toContainText(/Related Note|\[\[agent-memory\]\]|#research/);

  await cleanup();
});

test("opens workspace settings from the sidebar", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("workspace-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-note-roots")).toContainText("shoshin-codex");

  await cleanup();
});

test("collapses and reopens the workspace rail", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("sidebar-collapse").click();
  await expect(page.getByTestId("sidebar-expand")).toBeVisible();
  await expect(page.getByTestId("workspace-search")).toHaveCount(0);

  await page.getByTestId("sidebar-expand").click();
  await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
  await expect(page.getByTestId("workspace-search")).toBeVisible();

  await cleanup();
});

test("shows editor and terminal panes side by side", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.locator(".pane-leaf--editor")).toBeVisible();
  await expect(page.locator(".pane-leaf--terminal")).toBeVisible();
  await expect(page.locator(".pane-split-resizer")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();
  await expect(page.getByTestId("terminal-rail")).toBeVisible();

  await cleanup();
});

test("accepts terminal keyboard input in pane tree", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("hello from exo");
  await expect(page.locator(".xterm-rows")).toContainText("hello from exo");

  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("\nsecond line");
  await expect(page.locator(".xterm-rows")).toContainText("second line");

  await cleanup();
});

test("keeps list guides aligned with the visible bullet lanes", async () => {
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/shoshin-codex/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Probe\n\n- top item\n  - child item\n    - grandchild item\n  - sibling child\n    continuation line\n`,
      );
    },
  });

  const metrics = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll<HTMLElement>(".cm-line.exo-md-line--list-start, .cm-line.exo-md-line--list-continuation"));

    return lines
      .map((line) => {
        const depth = Number(line.dataset.exoListDepth ?? "0");
        const guideXs = (line.dataset.exoGuideXs ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map(Number);
        const bullet = line.querySelector<HTMLElement>(".exo-md-list-bullet") ?? line.querySelector<HTMLElement>(".exo-md-fold-toggle");
        const range = document.createRange();
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.textContent && node.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          },
        });
        let textNode: Text | null = null;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const parent = node.parentElement;
          if (parent && !parent.classList.contains("exo-md-list-prefix") && !parent.classList.contains("exo-md-list-bullet")) {
            textNode = node;
            break;
          }
        }

        if (textNode) {
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(1, textNode.textContent?.length ?? 1));
        }

        const lineRect = line.getBoundingClientRect();
        const bulletRect = bullet?.getBoundingClientRect();
        const textRect = textNode ? range.getBoundingClientRect() : null;

        return {
          text: line.textContent?.trim() ?? "",
          depth,
          guideXs,
          bulletCenterX: bulletRect ? bulletRect.left - lineRect.left + bulletRect.width / 2 : null,
          bulletRightX: bulletRect ? bulletRect.right - lineRect.left : null,
          textLeftX: textRect ? textRect.left - lineRect.left : null,
        };
      })
      .filter((line) => line.text.length > 0);
  });

  const topItem = metrics.find((entry) => entry.text.includes("top item"));
  const childItem = metrics.find((entry) => entry.text.includes("child item"));
  const grandchildItem = metrics.find((entry) => entry.text.includes("grandchild item"));
  const siblingItem = metrics.find((entry) => entry.text.includes("sibling child"));
  const continuationLine = metrics.find((entry) => entry.text.includes("continuation line"));

  expect(topItem?.bulletCenterX).not.toBeNull();
  expect(childItem?.bulletCenterX).not.toBeNull();
  expect(grandchildItem?.bulletCenterX).not.toBeNull();
  expect(siblingItem?.bulletCenterX).not.toBeNull();
  expect(continuationLine?.guideXs.length).toBe(1);

  expect(Math.abs((childItem?.guideXs[0] ?? 0) - (topItem?.bulletCenterX ?? 0))).toBeLessThanOrEqual(1.5);
  expect(Math.abs((grandchildItem?.guideXs[0] ?? 0) - (topItem?.bulletCenterX ?? 0))).toBeLessThanOrEqual(1.5);
  expect(Math.abs((grandchildItem?.guideXs[1] ?? 0) - (childItem?.bulletCenterX ?? 0))).toBeLessThanOrEqual(1.5);
  expect(Math.abs((continuationLine?.guideXs[0] ?? 0) - (topItem?.bulletCenterX ?? 0))).toBeLessThanOrEqual(1.5);

  expect(Math.round((topItem?.textLeftX ?? 0) - (topItem?.bulletRightX ?? 0))).toBeLessThanOrEqual(8);
  expect(Math.round((childItem?.textLeftX ?? 0) - (childItem?.bulletRightX ?? 0))).toBeLessThanOrEqual(8);

  await cleanup();
});

test("keeps the inspector pinned while long notes scroll", async () => {
  const longDocument = Array.from({ length: 120 }, (_, index) => `- line ${index + 1}`).join("\n");
  const longFixture = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/shoshin-codex/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Long note\n\n${longDocument}\n`,
      );
    },
  });

  await longFixture.page.getByTestId("inspector-toggle").click();
  const before = await longFixture.page.getByTestId("inspector-panel").boundingBox();
  await longFixture.page.locator(".editor-surface .cm-scroller").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => longFixture.page.locator(".editor-surface .cm-scroller").evaluate((element) => Math.round(element.scrollTop)))
    .toBeGreaterThan(100);
  const after = await longFixture.page.getByTestId("inspector-panel").boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);

  await longFixture.cleanup();
});
