import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";

import { launchExoFixture } from "../helpers";

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

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

test("opens a browser preview pane in the workspace", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.locator('[data-testid="terminal-rail"] [data-testid="launch-browser"]')).toHaveCount(0);
  await expect(page.locator('.sidebar__rail [data-testid="launch-browser"]')).toBeVisible();
  await page.getByTestId("launch-browser").click();
  await expect(page.getByTestId("browser-pane")).toBeVisible();
  await expect(page.getByTestId("browser-url-input")).toHaveValue("about:blank");
  await expect(page.getByText("Enter a local URL to preview.")).toBeVisible();

  await page.getByTestId("browser-url-input").fill("localhost:4321");
  await page.getByTestId("browser-load-url").click();
  await expect(page.getByTestId("browser-url-input")).toHaveValue("http://localhost:4321");
  await expect(page.getByTestId("browser-webview")).toHaveAttribute("src", "http://localhost:4321");
  await expect(page.locator(".pane-leaf--browser")).toBeVisible();

  await cleanup();
});

test("opens project files and creates note branches", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({ mutable: true });

  await page.getByTestId("project-roots-toggle").click();
  await page.getByRole("button", { name: "src" }).click();
  await page.getByTestId("sidebar").getByRole("button", { name: "demo.ts" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("demo.ts");
  await expect(page.getByTestId("properties-panel")).toContainText("Project file");
  await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "export const demo = 'saved';\n",
      },
    });
  });
  await expect(page.getByTestId("editor-save-status")).toHaveText("Unsaved");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
  await expect.poll(async () => readFile(path.join(workspaceRoot, "projects/sample-project/src/demo.ts"), "utf8")).toContain("saved");
  await page.getByTestId("sidebar").getByRole("button", { name: "README" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("README");
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: "\n\nSaved from Exo.",
      },
    });
  });
  await expect(page.getByTestId("editor-save-status")).toHaveText("Unsaved");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
  await expect.poll(async () => readFile(path.join(workspaceRoot, "projects/sample-project/README.md"), "utf8")).toContain("Saved from Exo.");

  await page.getByTestId("sidebar-search-toggle").click();
  await page.getByTestId("sidebar-search-input").fill("focus-note");
  await page.getByTestId("sidebar-search-pane").getByRole("button", { name: /focus-note/i }).first().click();
  await page.getByTestId("sidebar").getByRole("button", { name: "focus-note" }).click();
  await page.getByTestId("branch-selector").selectOption("__create__");
  await expect(page.getByTestId("branch-selector")).toHaveValue(/-looms\/1\.md$/);
  await expect(page.getByTestId("branch-selector").locator("option")).toHaveCount(3);

  await cleanup();
});

test("shows changed project files in the project drawer", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    env: {
      EXO_SHELL: "/bin/pwd",
      EXO_SHELL_ARGS: "",
    },
    prepareWorkspace: async (workspaceRoot) => {
      const projectRoot = path.join(workspaceRoot, "projects/sample-project");
      spawnSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      spawnSync("git", ["config", "user.email", "exo@example.test"], { cwd: projectRoot, stdio: "ignore" });
      spawnSync("git", ["config", "user.name", "Exo Test"], { cwd: projectRoot, stdio: "ignore" });
      await writeFile(path.join(projectRoot, "src/demo.ts"), "export const stable = true;\nexport const demo = 'original';\n");
      spawnSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
      spawnSync("git", ["commit", "-m", "fixture"], { cwd: projectRoot, stdio: "ignore" });
    },
  });

  const projectRoot = path.join(workspaceRoot, "projects/sample-project");
  await page.evaluate(async (cwd) => {
    const session = await window.exo.terminals.create({ kind: "shell", cwd });
    return session.id;
  }, projectRoot);
  await page.evaluate(async (cwd) => {
    const session = await window.exo.terminals.create({ kind: "shell", cwd });
    return session.id;
  }, projectRoot);
  await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(3);
  await writeFile(path.join(projectRoot, "src/demo.ts"), "export const stable = true;\nexport const demo = 'changed';\n");

  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-changes")).toContainText("src/demo.ts");
  await expect(page.getByTestId("project-changes")).toContainText(":2");
  await expect(page.getByTestId("project-changes").locator(".project-change__agent")).toHaveCount(0);
  await expect(page.locator('[data-testid^="terminal-session-changes-"]')).toHaveCount(0);
  await expect(page.getByTestId("statusbar-changes")).toHaveText("1 change");
  await page.getByTestId("statusbar-changes").click();
  await expect(page.getByTestId("editor-title")).toHaveText("demo.ts");
  await expect.poll(() => activeEditorLine(page)).toBe(2);
  await page.getByTestId("project-changes").getByRole("button", { name: /src\/demo\.ts/ }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("demo.ts");
  await expect.poll(() => activeEditorLine(page)).toBe(2);

  await cleanup();
});

async function activeEditorLine(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      return null;
    }
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
}

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
  await directories.nth(0).click({ button: "right" });
  await page.getByText("New Terminal").click();
  await expect(page.getByTestId("terminal-tab-shell").last()).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const sessions = await window.exo.terminals.list();
        const latest = sessions.at(-1);
        return latest ? await window.exo.terminals.read(latest.id) : "";
      }),
    )
    .toContain("src");

  await cleanup();
});

test("shows terminals created outside renderer controls", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/pwd",
      EXO_SHELL_ARGS: "",
    },
  });

  const initialTabs = await page.getByTestId("terminal-tab-shell").count();
  await page.evaluate(async () => {
    await window.exo.terminals.create({ kind: "shell" });
  });

  await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(initialTabs + 1);
  await expect(page.getByTestId("terminal-tab-shell").last()).toBeVisible();

  await cleanup();
});

test("passes Exo instruction overlays to launched terminal agents", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    env: {
      EXO_CLAUDE_COMMAND: "/bin/sh",
      EXO_CLAUDE_ARGS: "-lc,printf 'EXO_INSTRUCTIONS=%s\\n' \"$EXO_INSTRUCTIONS\"; test -f \"$EXO_INSTRUCTIONS\" && grep -m1 'Exo Runtime Context' \"$EXO_INSTRUCTIONS\"; printf 'EXO_WORKSPACE_ROOT=%s\\n' \"$EXO_WORKSPACE_ROOT\"; printf 'EXO_PROJECT_ROOTS=%s\\n' \"$EXO_PROJECT_ROOTS\"; sleep 10",
    },
  });
  const projectRoot = path.join(workspaceRoot, "projects/sample-project");
  const sessionId = await page.evaluate(async (cwd) => {
    const session = await window.exo.terminals.create({ kind: "claude", cwd });
    return session.id;
  }, projectRoot);

  await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), sessionId)).toContain("EXO_INSTRUCTIONS=");
  const buffer = await page.evaluate((id) => window.exo.terminals.read(id), sessionId);
  expect(buffer).toContain("Exo Runtime Context");
  expect(buffer).toContain(`EXO_WORKSPACE_ROOT=${workspaceRoot}`);
  expect(buffer).toContain(projectRoot);

  const sessions = await page.evaluate(() => window.exo.terminals.list());
  const claude = sessions.find((session) => session.id === sessionId);
  expect(claude?.instructionOverlayPath).toContain(path.join(".exo", "instructions", "projects"));
  await expect.poll(async () => readFile(claude?.instructionOverlayPath ?? "", "utf8")).toContain("sample-project");

  await cleanup();
});

test("expands and collapses the project roots drawer", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--collapsed/);
  await expect(page.getByTestId("project-roots-panel")).toHaveCount(0);
  await page.getByTestId("project-roots-toggle").click();
  await expect(page.getByTestId("project-roots-drawer")).toHaveClass(/snap-drawer--expanded/);
  await expect(page.getByTestId("project-roots-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "src" })).toBeVisible();
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

test("collapses the terminal pane after closing the last terminal", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("close-terminal-shell").click();
  await expect(page.getByTestId("terminal-expand")).toBeVisible();
  await expect(page.locator(".pane-leaf--terminal")).toHaveCount(0);

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
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
  });

  await page.getByTestId("workspace-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-note-roots")).toContainText("test-notes");
  await page.getByTestId("workspace-settings-tab-index").click();
  await expect(page.getByTestId("workspace-settings-index-mode")).toHaveValue("off");
  await expect(page.getByTestId("workspace-settings-dialog")).toContainText("Local QMD Index");
  await page.getByTestId("workspace-settings-tab-terminal").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toContainText("Live terminal scrollback");
  await expect(page.getByTestId("workspace-settings-terminal-history-mode").locator("option:checked")).toHaveText("Maximum");
  await expect(page.getByTestId("workspace-settings-terminal-history-mode")).toHaveValue("full");
  await page.getByTestId("workspace-settings-terminal-history-mode").selectOption("custom");
  await expect(page.getByTestId("workspace-settings-terminal-history-lines")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-dialog")).toContainText("Scrollback lines");
  await expect(page.getByTestId("workspace-settings-terminal-transcript-retention")).toHaveValue("forever");
  await expect(page.getByTestId("workspace-settings-terminal-streaming-mode")).toHaveValue("visible");

  await cleanup();
});

test("opens workspace settings with partial agent context discovery errors", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
    prepareWorkspace: async (workspaceRoot) => {
      await mkdir(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"));
    },
  });

  try {
    await page.getByTestId("workspace-settings").click();
    await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-note-roots")).toContainText("test-notes");
    await page.getByTestId("workspace-settings-tab-agents").click();
    await expect(page.getByTestId("agent-context-settings")).toContainText("Agent config");
    await expect(page.getByTestId("agent-context-partial-errors")).toContainText("Some agent context data could not be loaded");
    await expect(page.getByTestId("agent-context-partial-errors")).toContainText("sample-project / AGENTS.md");
    await page.getByTestId("agent-context-open-manager").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await expect(page.getByTestId("agent-context-manager-partial-errors")).toContainText("sample-project / AGENTS.md");
    await expect(page.getByTestId("agent-context-composer")).toContainText("Unified instructions");
    await expect(page.getByTestId("agent-context-file-list")).toContainText("Error");
  } finally {
    await cleanup();
  }
});

test("opens agent config editor when managed config preload API is unavailable", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
      EXO_TEST_OMIT_MANAGED_CONFIG_API: "1",
    },
  });

  try {
    await page.getByTestId("workspace-settings").click();
    await page.getByTestId("workspace-settings-tab-agents").click();
    await expect(page.getByTestId("agent-context-partial-errors")).toContainText("Managed config editor is unavailable");
    await expect(page.getByTestId("workspace-settings-dialog")).not.toContainText("is not a function");
    await page.getByTestId("agent-context-open-manager").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await expect(page.getByTestId("agent-context-manager-partial-errors")).toContainText("latest preload bridge");
    await expect(page.getByTestId("agent-managed-config-editor")).toContainText("Select a managed config");
  } finally {
    await cleanup();
  }
});

test("keeps long agent context errors separate from narrow manager controls", async () => {
  const { electronApp, page, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
  });

  try {
    const longError = [
      "managed agent config files:",
      "window.exo.workspace.listAgentManagedConfigFiles is not a function after a stale preload bridge restart",
      "/very/long/workspace/path/with/provider/config/.mcp.json",
      "restart Exo to reload the preload bundle before editing managed configs",
    ].join(" ");
    await electronApp.evaluate(({ ipcMain }, errorMessage) => {
      ipcMain.removeHandler("workspace:list-agent-managed-config-files");
      ipcMain.handle("workspace:list-agent-managed-config-files", async () => {
        throw new Error(errorMessage);
      });
    }, longError);

    await page.getByTestId("workspace-settings").click();
    await page.getByTestId("workspace-settings-tab-agents").click();
    await page.getByTestId("agent-context-open-manager").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await page.setViewportSize({ width: 720, height: 720 });
    await expect(page.getByTestId("agent-context-manager-partial-errors")).toContainText("stale preload bridge restart");
    await expect(page.getByTestId("agent-context-composer")).toContainText("Unified instructions");

    const errorBox = await page.getByTestId("agent-context-manager-partial-errors").boundingBox();
    const controlsBox = await page.getByTestId("agent-context-scope-controls").boundingBox();
    expect(errorBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(boxesOverlap(errorBox!, controlsBox!)).toBe(false);
  } finally {
    await cleanup();
  }
});

test("edits agent context files from workspace settings", async () => {
  const { page, workspaceRoot, homeRoot, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      await writeFile(
        path.join(workspaceRoot, "notes/test-notes/AGENTS.md"),
        "- Always run tests before finishing.\n- Use npm for scripts.\n",
        "utf8",
      );
      await writeFile(
        path.join(workspaceRoot, "projects/sample-project/AGENTS.md"),
        "# Existing project context\n- Always run tests before finishing.\n- Use pnpm for scripts.\n",
        "utf8",
      );
    },
  });

  await page.getByTestId("workspace-settings").click();
  await page.getByTestId("workspace-settings-tab-agents").click();
  await expect(page.getByTestId("agent-context-settings")).toBeVisible();
  await expect(page.getByTestId("agent-context-settings")).toContainText("Agent config");
  await expect(page.getByTestId("agent-context-settings")).toContainText("Instruction outputs");
  await page.getByTestId("agent-context-open-manager").click();
  await expect(page.getByTestId("agent-context-manager")).toBeVisible();
  await expect(page.getByTestId("agent-context-manager")).not.toContainText("Provider outputs");
  await expect(page.getByTestId("agent-context-history-toggle")).toBeVisible();
  await expect(page.getByTestId("agent-instruction-overlay-preview")).toContainText("Generated overlay");
  const unifiedEditorBox = await page.getByTestId("agent-context-unified-editor").boundingBox();
  expect(unifiedEditorBox).not.toBeNull();
  expect(unifiedEditorBox!.height).toBeGreaterThan(100);
  await expect(page.getByTestId("agent-context-adapters")).toContainText("AGENTS.md");
  await expect(page.getByTestId("agent-context-adapters")).toContainText("CLAUDE.md");
  await page.getByTestId("agent-context-adapter-file-name").fill("soul.md");
  await page.getByTestId("agent-context-adapter-label").fill("Soul compatibility");
  await page.getByTestId("agent-context-adapter-add").click();
  await expect(page.getByTestId("agent-context-adapters-status")).toContainText("Instruction outputs updated");
  await expect(page.getByTestId("agent-context-adapters")).toContainText("soul.md");
  await page.getByTestId("agent-managed-config-summary").click();
  await expect(page.getByTestId("agent-managed-config-list")).toContainText(".mcp.json");
  await page.getByRole("button", { name: /sample-project \/ \.mcp\.json/i }).click();
  await expect(page.getByTestId("agent-mcp-editor")).toBeVisible();
  const providerEditorBox = await page.getByTestId("agent-context-editor").boundingBox();
  const managedConfigBox = await page.getByTestId("agent-managed-config-editor").boundingBox();
  expect(providerEditorBox).not.toBeNull();
  expect(managedConfigBox).not.toBeNull();
  expect(boxesOverlap(providerEditorBox!, managedConfigBox!)).toBe(false);
  await page.getByTestId("agent-mcp-server-name").fill("exo");
  await page.getByTestId("agent-mcp-server-command").fill("node");
  await page.getByTestId("agent-mcp-server-args").fill("packages/mcp/bin/exo-mcp.mjs");
  await page.getByTestId("agent-mcp-server-env").fill("EXO_MCP_AUTOSTART=1");
  await page.getByTestId("agent-mcp-server-save").click();
  await expect(page.getByTestId("agent-managed-config-status")).toContainText("Config saved");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/.mcp.json"), "utf8"),
  ).toContain('"mcpServers"');
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/.mcp.json"), "utf8"),
  ).toContain('"EXO_MCP_AUTOSTART": "1"');
  await page.getByTestId("agent-instruction-overlay-preview").locator("summary").click();
  await expect(page.getByTestId("agent-instruction-overlay-body")).toContainText("Exo Runtime Context");
  await expect(page.getByTestId("agent-instruction-overlay-body")).toContainText("sample-project");
  await expect.poll(async () => readFile(path.join(workspaceRoot, ".exo/instructions/global.md"), "utf8")).toContain("Attached Project Roots");
  const projectOverlayFiles = await readdir(path.join(workspaceRoot, ".exo/instructions/projects"));
  expect(projectOverlayFiles.some((file) => file.endsWith(".md"))).toBeTruthy();
  await page.getByRole("button", { name: /sample-project \/ AGENTS\.md/i }).click();
  await expect(page.getByTestId("agent-context-editor")).toHaveValue(/Existing project context/);
  await expect(page.getByTestId("agent-context-signals")).toContainText("Duplicate");
  await expect(page.getByTestId("agent-context-signals")).toContainText("Package manager mismatch");
  await page.getByTestId("agent-context-insert-exo-snippet").click();
  await expect(page.getByTestId("agent-context-editor")).toHaveValue(/Exo Workspace Tools/);
  await page.getByTestId("agent-context-save").click();
  await expect(page.getByTestId("agent-context-status")).toContainText("Saved");

  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("exo project-roots list");

  await page.getByTestId("agent-context-scope-selected").click();
  await page.getByTestId("agent-context-target-project-sample-project-project").check();
  await expect(page.getByTestId("agent-context-write-summary")).toContainText("1 scope");
  await page.getByTestId("agent-context-unified-editor").fill("Use unified project context.");
  await page.getByTestId("agent-context-save-unified").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");

  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/CLAUDE.md"), "utf8"),
  ).toContain("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/soul.md"), "utf8"),
  ).toContain("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Existing project context");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).not.toContain("Attached Project Roots");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("exo:managed:start");

  await page.getByTestId("agent-context-unified-editor").fill("Use updated unified project context.");
  await page.getByTestId("agent-context-save-unified").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Use updated unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).not.toContain("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Existing project context");
  await page.getByTestId("agent-context-history-toggle").click();
  await expect(page.getByTestId("agent-context-history-popover")).toBeVisible();
  await expect(page.getByTestId("agent-context-history-list")).toBeVisible();
  await expect(page.getByTestId("agent-context-history-entry").first()).toContainText("Updated managed body");
  await page.getByTestId("agent-context-toggle-diff").click();
  await expect(page.getByTestId("agent-context-history-diff")).toContainText("- Use unified project context.");
  await expect(page.getByTestId("agent-context-history-diff")).toContainText("+ Use updated unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, ".exo/agent-context-history/history.jsonl"), "utf8"),
  ).toContain("Use unified project context.");
  await page.getByTestId("agent-context-restore-history").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");
  await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Use unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).not.toContain("Use updated unified project context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/soul.md"), "utf8"),
  ).not.toContain("Use updated unified project context.");
  await expect(access(path.join(workspaceRoot, "notes/test-notes/CLAUDE.md"))).rejects.toThrow();
  await expect(access(path.join(homeRoot, ".claude/CLAUDE.md"))).rejects.toThrow();

  await page.getByTestId("agent-context-target-project-sample-project-project").uncheck();
  await page.getByTestId("agent-context-target-notes-test-notes-notes").check();
  await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue("");
  await page.getByTestId("agent-context-unified-editor").fill("Use unified notes context.");
  await page.getByTestId("agent-context-save-unified").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "notes/test-notes/CLAUDE.md"), "utf8"),
  ).toContain("Use unified notes context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"), "utf8"),
  ).toContain("Use unified notes context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "notes/test-notes/soul.md"), "utf8"),
  ).toContain("Use unified notes context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Use unified project context.");
  await page.getByTestId("agent-context-target-project-sample-project-project").check();
  await expect(page.getByTestId("agent-context-write-summary")).toContainText("2 scopes");
  await page.getByTestId("agent-context-unified-editor").fill("Use shared selected context.");
  await page.getByTestId("agent-context-save-unified").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"), "utf8"),
  ).toContain("Use shared selected context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"), "utf8"),
  ).toContain("Use shared selected context.");

  await page.getByTestId("agent-context-scope-global").click();
  await page.getByTestId("agent-context-unified-editor").fill("Use unified global context.");
  await page.getByTestId("agent-context-save-unified").click();
  await expect(page.getByTestId("agent-context-unified-status")).toContainText("Provider files written");
  await expect.poll(async () => readFile(path.join(homeRoot, ".claude/CLAUDE.md"), "utf8")).toContain("Use unified global context.");
  await expect.poll(async () => readFile(path.join(homeRoot, ".codex/AGENTS.md"), "utf8")).toContain("Use unified global context.");
  await expect.poll(async () => readFile(path.join(homeRoot, "soul.md"), "utf8")).toContain("Use unified global context.");
  await expect.poll(async () =>
    readFile(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"), "utf8"),
  ).toContain("Use shared selected context.");

  await page.getByTestId("agent-context-manager-close").click();
  await page.getByTestId("workspace-settings").click();
  await page.getByTestId("workspace-settings-tab-agents").click();
  await expect(page.getByTestId("agent-context-settings")).toContainText("Instruction outputs");
  await page.getByTestId("agent-context-open-manager").click();
  await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue("Use unified global context.");
  await page.getByTestId("agent-context-scope-selected").click();
  await page.getByTestId("agent-context-target-project-sample-project-project").check();
  await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue("Use shared selected context.");
  await expect(page.getByRole("button", { name: /Global \/ CLAUDE\.md/i })).toContainText("Existing");
  await expect(page.getByRole("button", { name: /test-notes \/ CLAUDE\.md/i })).toContainText("Existing");
  await expect(page.getByRole("button", { name: /sample-project \/ CLAUDE\.md/i })).toContainText("Existing");
  await expect(page.getByRole("button", { name: /sample-project \/ soul\.md/i })).toContainText("Existing");

  await cleanup();
});

test("switch workspace opens the workspace picker", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("workspace-settings").click();
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByTestId("onboarding")).toContainText("Select workspace");
  await expect(page.getByTestId("workspace-picker-item").first()).toContainText("test-notes");
  await expect(page.getByTestId("workspace-picker-open")).toBeEnabled();
  await page.getByTestId("workspace-picker-new").click();
  await expect(page.getByTestId("onboarding")).toContainText("New workspace");
  await expect(page.getByTestId("onboarding-choose-notes")).toBeVisible();

  await cleanup();
});

test("shows first-run notes setup before the app shell", async () => {
  const { page, cleanup } = await launchExoFixture({ configured: false });

  await expect(page.getByTestId("onboarding")).toContainText("Select workspace");
  await expect(page.getByTestId("workspace-picker-empty")).toContainText("No workspaces yet.");
  await expect(page.getByTestId("workspace-picker-new")).toBeVisible();
  await expect(page.getByTestId("workspace-picker-open")).toBeDisabled();
  await page.getByTestId("workspace-picker-new").click();
  await expect(page.getByTestId("onboarding")).toContainText("New workspace");
  await expect(page.getByTestId("onboarding")).toContainText("Default terminal");
  await expect(page.getByTestId("onboarding")).toContainText("Knowledge index");
  await expect(page.getByTestId("onboarding-notes-folder")).toContainText("No notes folder selected.");
  await expect(page.getByTestId("onboarding-continue")).toBeDisabled();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);

  await cleanup();
});

test("collapses and reopens the workspace rail", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("sidebar-collapse").click();
  await expect(page.getByTestId("sidebar-expand")).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("button", { name: "focus-note" })).toHaveCount(0);

  await page.getByTestId("sidebar-expand").click();
  await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
  await expect(page.getByTestId("sidebar-search-toggle")).toBeVisible();

  await cleanup();
});

test("shows editor and terminal panes side by side", async () => {
  const { page, cleanup } = await launchExoFixture();

  await expect(page.locator(".pane-leaf--editor")).toBeVisible();
  await expect(page.locator(".pane-leaf--terminal")).toBeVisible();
  await expect(page.locator(".workspace__body > .pane-split-resizer")).toBeVisible();
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

test("keeps large terminal bursts available above the visible viewport", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS:
        "-c,i=1; while [ $i -le 900 ]; do printf 'scrollback-%03d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' \"$i\"; i=$((i+1)); done; sleep 30",
    },
  });

  await expect(page.locator(".xterm-rows")).toContainText("scrollback-900");
  await expect(page.locator(".xterm-rows")).not.toContainText("scrollback-001");

  await page.getByTestId("terminal-surface").hover();
  await page.mouse.wheel(0, -50000);

  await expect(page.locator(".xterm-rows")).toContainText("scrollback-001");

  await cleanup();
});

test("keeps app terminal buffer above the legacy 12k cap", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS:
        "-c,sleep 0.2; i=1; while [ $i -le 220 ]; do printf 'buffer-%03d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' \"$i\"; i=$((i+1)); done; sleep 30",
    },
  });

  await expect(page.locator(".xterm-rows")).toContainText("buffer-220");
  const buffer = await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    return sessions[0] ? window.exo.terminals.read(sessions[0].id) : "";
  });

  expect(buffer.length).toBeGreaterThan(12_000);
  expect(buffer).toContain("buffer-001");

  await cleanup();
});

test("renders agent terminal streams without corrupting scrollback", async () => {
  test.skip(spawnSync("tmux", ["-V"], { stdio: "ignore" }).status !== 0, "tmux is required for agent history");

  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_CLAUDE_COMMAND: "/bin/sh",
      EXO_CLAUDE_ARGS:
        "-c,i=1; while [ $i -le 140 ]; do printf 'agent-scrollback-%03d\\n' \"$i\"; i=$((i+1)); done; sleep 30",
    },
  });

  try {
    await page.getByTestId("launch-claude").click();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await expect(page.locator(".xterm-rows")).toContainText("agent-scrollback-140");

    const buffer = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      const claude = sessions.find((session) => session.kind === "claude");
      return claude ? window.exo.terminals.read(claude.id) : "";
    });
    expect(buffer).toContain("agent-scrollback-140");

    await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      await Promise.all(sessions.filter((session) => session.kind === "claude").map((session) => window.exo.terminals.kill(session.id)));
    });
  } finally {
    await cleanup();
  }
});

test("does not feed xterm device responses back into terminal input", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    if (!sessions[0]) {
      throw new Error("Missing terminal session.");
    }
    await window.exo.terminals.write(sessions[0].id, "\x1b[>c");
  });
  await page.waitForTimeout(300);

  const buffer = await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    return sessions[0] ? window.exo.terminals.read(sessions[0].id) : "";
  });
  expect(buffer).not.toContain("0;276;0c");
  expect(buffer).not.toContain("\x1b[>0;");

  await cleanup();
});

test("keeps list guides aligned with the visible bullet lanes", async () => {
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
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
        const bulletStyle = getComputedStyle(line, "::before");
        const bulletLeft = Number.parseFloat(bulletStyle.left);
        const bulletWidth = Number.parseFloat(bulletStyle.width);
        const hasBullet = bulletStyle.content !== "none" && Number.isFinite(bulletLeft) && Number.isFinite(bulletWidth);
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
          if (parent && !parent.classList.contains("exo-md-list-prefix")) {
            textNode = node;
            break;
          }
        }

        if (textNode) {
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(1, textNode.textContent?.length ?? 1));
        }

        const lineRect = line.getBoundingClientRect();
        const textRect = textNode ? range.getBoundingClientRect() : null;

        return {
          text: line.textContent?.trim() ?? "",
          depth,
          guideXs,
          bulletCenterX: hasBullet ? bulletLeft + bulletWidth / 2 : null,
          bulletRightX: hasBullet ? bulletLeft + bulletWidth : null,
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

test("toggles markdown task checkboxes from live preview", async () => {
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Tasks\n\n- [ ] Pull IRS SOI ZIP Code\n- [x] test\n`,
      );
    },
  });

  async function editorText() {
    return page.evaluate(() => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) {
        throw new Error("Unable to resolve CodeMirror view");
      }
      return view.state.doc.toString();
    });
  }

  await expect(page.locator(".exo-md-checkbox")).toHaveCount(2);
  await page.locator(".exo-md-checkbox").first().click();
  await expect.poll(editorText).toContain("- [x] Pull IRS SOI ZIP Code");

  await page.locator(".exo-md-checkbox").nth(1).click();
  await expect.poll(editorText).toContain("- [ ] test");

  await cleanup();
});

test("keeps list text aligned when editing a bullet marker", async () => {
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Probe\n\n- journal\n  - today\n  - \n`,
      );
    },
  });

  async function setCursorOnLineContaining(text: string, offset: number) {
    await page.evaluate(({ lineText, nextOffset }) => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) {
        throw new Error("Unable to resolve CodeMirror view");
      }
      let line = null;
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const candidate = view.state.doc.line(lineNumber);
        if (candidate.text === lineText) {
          line = candidate;
          break;
        }
      }
      if (!line) {
        for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
          const candidate = view.state.doc.line(lineNumber);
          if (candidate.text.includes(lineText)) {
            line = candidate;
            break;
          }
        }
      }
      if (!line) {
        throw new Error(`Unable to find ${lineText} line in CodeMirror state`);
      }
      view.dispatch({ selection: { anchor: line.from + nextOffset }, scrollIntoView: true });
      view.focus();
    }, { lineText: text, nextOffset: offset });
  }

  async function lineMetrics(text: string) {
    return page.evaluate((lineText) => {
      const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"))
        .find((element) => element.textContent?.includes(lineText));
      if (!line) {
        throw new Error(`Unable to find ${lineText} line`);
      }

      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent?.closest(".exo-md-syntax-hidden, .exo-md-list-prefix")) {
            return NodeFilter.FILTER_SKIP;
          }
          return node.textContent?.includes(lineText) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      const textNode = walker.nextNode() as Text | null;
      if (!textNode) {
        throw new Error(`Unable to find ${lineText} text node`);
      }

      const start = textNode.textContent?.indexOf(lineText) ?? 0;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 1);

      const lineRect = line.getBoundingClientRect();
      const textRect = range.getBoundingClientRect();
      return {
        raw: line.classList.contains("exo-md-line--list-raw"),
        rawMarkerText: line.querySelector(".exo-md-list-marker-raw")?.textContent ?? null,
        hasBullet: line.classList.contains("exo-md-line--list") && !line.classList.contains("exo-md-line--list-raw"),
        textLeftX: textRect.left - lineRect.left,
      };
    }, text);
  }

  async function cursorLocation() {
    return page.evaluate(() => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) {
        throw new Error("Unable to resolve CodeMirror view");
      }
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      return {
        lineText: line.text,
        offset: pos - line.from,
      };
    });
  }

  await setCursorOnLineContaining("today", 5);
  const preview = await lineMetrics("today");
  expect(preview.raw).toBe(false);
  expect(preview.hasBullet).toBe(true);

  await setCursorOnLineContaining("today", 3);
  const raw = await lineMetrics("today");
  expect(raw.raw).toBe(true);
  expect(raw.rawMarkerText).toBe("-");
  expect(raw.hasBullet).toBe(false);
  expect(Math.abs(raw.textLeftX - preview.textLeftX)).toBeLessThanOrEqual(3);

  await setCursorOnLineContaining("today", 4);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(cursorLocation).toEqual({ lineText: "  - today", offset: 3 });
  await expect.poll(async () => (await lineMetrics("today")).rawMarkerText).toBe("-");

  await page.keyboard.press("ArrowLeft");
  await expect.poll(cursorLocation).toEqual({ lineText: "  - today", offset: 2 });

  await page.keyboard.press("ArrowLeft");
  await expect.poll(cursorLocation).toEqual({ lineText: "- journal", offset: 9 });

  await page.keyboard.press("ArrowRight");
  await expect.poll(cursorLocation).toEqual({ lineText: "  - today", offset: 2 });
  await page.keyboard.press("ArrowRight");
  await expect.poll(cursorLocation).toEqual({ lineText: "  - today", offset: 3 });
  await page.keyboard.press("ArrowRight");
  await expect.poll(cursorLocation).toEqual({ lineText: "  - today", offset: 4 });

  await setCursorOnLineContaining("  - ", 3);
  await expect(page.locator(".cm-line .exo-md-list-marker-raw")).toHaveText("-");

  await setCursorOnLineContaining("  - ", 4);
  await page.keyboard.type("draft");
  const insertedLine = await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      if (line.text.includes("draft")) {
        return line.text;
      }
    }
    return "";
  });
  expect(insertedLine).toBe("  - draft");
  await expect(page.locator(".cm-line").filter({ hasText: /draft/ })).toContainText("draft");

  await cleanup();
});

test("keeps the inspector pinned while long notes scroll", async () => {
  const longDocument = Array.from({ length: 120 }, (_, index) => `- line ${index + 1}`).join("\n");
  const longFixture = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
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
