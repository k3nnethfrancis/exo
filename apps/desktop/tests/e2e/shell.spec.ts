import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

import { launchExoFixture, relaunchExoFixture } from "../helpers";
import { expectTerminalRenderHistoryStable, expectTerminalRenderStable, latencySummary, waitForTerminalText } from "../terminalQuality";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fakeAgentPath = path.join(repoRoot, "apps/desktop/tests/fixtures/fake-terminal-agent.mjs");

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

async function readFirstTerminalOfKind(page: import("@playwright/test").Page, kind: "shell" | "claude" | "codex") {
  return page.evaluate(async (terminalKind) => {
    const sessions = await window.exo.terminals.list();
    const session = sessions.find((candidate) => candidate.kind === terminalKind);
    return session ? window.exo.terminals.read(session.id) : "";
  }, kind);
}

async function pageShellSession(page: import("@playwright/test").Page) {
  const shell = await page.evaluate(async () => {
    const sessions = await window.exo.terminals.list();
    return sessions.find((session) => session.kind === "shell") ?? null;
  });
  if (!shell) {
    throw new Error("Expected shell terminal session");
  }
  return shell;
}

function killTmuxAttachClients(tmuxSessionName: string): number {
  const processList = spawnSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  if (processList.status !== 0) {
    throw new Error(processList.stderr || "Failed to list processes.");
  }
  const escapedSessionName = tmuxSessionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attachPattern = new RegExp(`\\btmux\\s+attach-session\\s+-t\\s+${escapedSessionName}\\b`);
  const pids = processList.stdout
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match && attachPattern.test(match[2]) ? Number(match[1]) : null;
    })
    .filter((pid): pid is number => pid !== null && pid !== process.pid);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The attach client may have exited between process listing and termination.
    }
  }
  return pids.length;
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

test.describe.configure({ mode: "parallel" });

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
  await expect.poll(async () => {
    const sessions = await page.evaluate(() => window.exo.terminals.list());
    const claude = sessions.find((session) => session.kind === "claude");
    return claude ? page.evaluate((id) => window.exo.terminals.read(id), claude.id) : "";
  }).toContain("claude ready");

  await page.getByTestId("launch-codex").click();
  await expect(page.getByTestId("terminal-tab-codex")).toBeVisible();
  await expect.poll(async () => {
    const sessions = await page.evaluate(() => window.exo.terminals.list());
    const codex = sessions.find((session) => session.kind === "codex");
    return codex ? page.evaluate((id) => window.exo.terminals.read(id), codex.id) : "";
  }).toContain("codex ready");

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
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
  await expect(page.getByTestId("toggle-markdown-mode")).toBeVisible();
  await expect(page.getByTestId("toggle-properties")).toHaveCount(0);
  await expect(page.locator(".editor-surface--code")).toHaveCount(0);
  await expect(page.locator(".editor-surface--live-preview")).toBeVisible();
  await expect(page.locator(".exo-md-line--h1", { hasText: "Exo Demo Project" })).toBeVisible();
  await page.getByTestId("toggle-markdown-mode").click();
  await expect(page.locator(".editor-surface--live-preview")).toHaveCount(0);
  await expect(page.getByTestId("editor-panel")).toContainText("# Exo Demo Project");
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
  await expect(page.getByTestId("editor-title")).toHaveText("focus-note");
  await page.getByTestId("branch-selector").selectOption("__create__");
  await expect(page.getByTestId("branch-selector")).toHaveValue(/-looms\/1\.md$/);
  await expect(page.getByTestId("branch-selector").locator("option")).toHaveCount(3);

  await cleanup();
});

test("creates, renames, and deletes notes from the explorer", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({ mutable: true });
  const notesRoot = path.join(workspaceRoot, "notes/test-notes");
  const createdPath = path.join(notesRoot, "mutation-qa.md");
  const renamedPath = path.join(notesRoot, "mutation-renamed.md");

  await page.getByTestId("sidebar-new-note").click();
  await expect(page.getByTestId("workspace-dialog")).toBeVisible();
  await page.getByTestId("workspace-dialog-input").fill("mutation-qa.md");
  await page.getByTestId("workspace-dialog-confirm").click();
  await expect(page.getByTestId("editor-title")).toHaveText("mutation-qa");
  await expect.poll(async () => readFile(createdPath, "utf8")).toBe("");

  await page.getByTestId("sidebar").getByRole("button", { name: "mutation-qa" }).click({ button: "right" });
  await page.getByText("Rename").click();
  await page.getByTestId("workspace-dialog-input").fill("mutation-renamed.md");
  await page.getByTestId("workspace-dialog-confirm").click();
  await expect(page.getByTestId("editor-title")).toHaveText("mutation-renamed");
  await expect.poll(async () => readFile(renamedPath, "utf8")).toBe("");
  await expect(access(createdPath)).rejects.toThrow();

  await page.getByTestId("sidebar").getByRole("button", { name: "mutation-renamed" }).click({ button: "right" });
  await page.getByText("Delete").click();
  await page.getByTestId("workspace-dialog-confirm").click();
  await expect(access(renamedPath)).rejects.toThrow();

  await cleanup();
});

test("handles global save and daily-note keybindings", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({ mutable: true });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const focusNotePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
  const now = new Date();
  const dailyName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: "\n\nSaved with keybinding.",
      },
    });
  });
  await expect(page.getByTestId("editor-save-status")).toHaveText("Unsaved");
  await page.keyboard.press(`${modifier}+S`);
  await expect(page.getByTestId("editor-save-status")).toHaveText("Saved");
  await expect.poll(async () => readFile(focusNotePath, "utf8")).toContain("Saved with keybinding.");

  await page.keyboard.press(`${modifier}+N`);
  await expect(page.getByTestId("editor-title")).toHaveText(dailyName);
  await expect.poll(async () => readFile(path.join(workspaceRoot, "notes/test-notes", `${dailyName}.md`), "utf8")).toBe("");

  await cleanup();
});

test("suppresses generated daily-note titles but preserves explicit H1s", async () => {
  const generatedDailyName = "2026-06-14";
  const explicitDailyName = "2026-06-15";
  const explicitNormalName = "explicit-heading";
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const noteRoot = path.join(workspaceRoot, "notes/test-notes");
      await writeFile(path.join(noteRoot, `${generatedDailyName}.md`), `# ${generatedDailyName}\n\nToday has notes.\n`);
      await writeFile(path.join(noteRoot, `${explicitDailyName}.md`), "# Daily Review\n\nThis heading is authored.\n");
      await writeFile(path.join(noteRoot, `${explicitNormalName}.md`), "# Explicit Heading\n\nThis heading is authored.\n");
    },
    initialNoteLabel: null,
  });

  const sidebar = page.getByTestId("sidebar");

  await sidebar.getByRole("button", { name: generatedDailyName }).click();
  await expect(page.getByTestId("editor-title")).toHaveText(generatedDailyName);
  await expect(page.locator(".exo-md-line--h1", { hasText: generatedDailyName })).toHaveCount(0);
  await expect(page.getByTestId("editor-panel")).toContainText("Today has notes.");
  await expect(page.getByTestId("toggle-markdown-mode")).toBeVisible();
  await expect(page.getByTestId("editor-save")).toBeVisible();
  await expect(page.getByTestId("editor-save-status")).toBeVisible();
  await page.getByTestId("toggle-properties").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();

  await sidebar.getByRole("button", { name: explicitDailyName }).click();
  await expect(page.locator(".exo-md-line--h1", { hasText: "Daily Review" })).toBeVisible();

  await sidebar.getByRole("button", { name: explicitNormalName }).click();
  await expect(page.locator(".exo-md-line--h1", { hasText: "Explicit Heading" })).toBeVisible();

  await cleanup();
});

test("shows changed project files in the project drawer", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    mutable: true,
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "-lc,pwd; cat",
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
  await expect(page.getByTestId("project-changes")).toHaveCount(0);
  const changedFolder = page.getByTestId("project-roots-panel").getByRole("button", { name: /src, collapsed folder, 1 file changed/ });
  await expect(changedFolder).toBeVisible();
  await expect(changedFolder.locator(".tree-node__dirty-badge")).toHaveText("1");
  await changedFolder.click();
  const changedFile = page.getByTestId("project-roots-panel").getByRole("button", { name: /demo\.ts, file, M changed, first changed line 2/ });
  await expect(changedFile).toBeVisible();
  await expect(changedFile.locator(".tree-node__dirty-badge")).toHaveText("M");
  await expect(page.locator('[data-testid^="terminal-session-changes-"]')).toHaveCount(0);
  await expect(page.getByTestId("statusbar-changes")).toHaveText("1 change");
  await page.getByTestId("statusbar-changes").click();
  await expect(page.getByTestId("editor-title")).toHaveText("demo.ts");
  await expect.poll(() => activeEditorLine(page)).toBe(2);
  await changedFile.click();
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
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "-lc,pwd; cat",
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
  expect(claude?.instructionOverlayPath).toContain(path.join("instructions", "projects"));
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

  await page.getByTestId("editor-panel").click();
  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("after editor");
  await expect(page.getByTestId("terminal-surface")).toContainText("hello exoafter editor");

  await cleanup();
});

test("does not rehydrate an already rendered terminal when focusing its active tab", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  await page.getByTestId("terminal-surface").click();
  await page.keyboard.type("stable terminal viewport");
  await expect(page.locator(".xterm-rows")).toContainText("stable terminal viewport");

  await page.evaluate(() => {
    const originalRead = window.exo.terminals.read;
    let readCount = 0;
    window.exo.terminals.read = ((...args: Parameters<typeof originalRead>) => {
      readCount += 1;
      return originalRead(...args);
    }) as typeof originalRead;
    Object.defineProperty(window, "__exoTerminalReadCount", {
      configurable: true,
      value: () => readCount,
    });
  });

  await page.getByTestId("terminal-tab-shell").click();
  await page.waitForTimeout(150);

  const readCount = await page.evaluate(() => (window as unknown as { __exoTerminalReadCount: () => number }).__exoTerminalReadCount());
  expect(readCount).toBe(0);

  await cleanup();
});

test("measures terminal input echo latency against p50 and p90 targets", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  try {
    await page.getByTestId("terminal-surface").click();
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const marker = `exo-latency-${index}-${Date.now()}`;
      const startedAt = performance.now();
      await page.keyboard.type(`${marker}\n`);
      await waitForTerminalText(page, marker);
      samples.push(performance.now() - startedAt);
    }

    const summary = latencySummary(samples);
    expect(summary.p50, `terminal echo latency summary: ${JSON.stringify(summary)}`).toBeLessThan(75);
    expect(summary.p90, `terminal echo latency summary: ${JSON.stringify(summary)}`).toBeLessThan(150);
  } finally {
    await cleanup();
  }
});

test("keeps terminal input latency within targets while another terminal streams output", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "",
    },
  });

  try {
    const activeShellId = await page.evaluate(async () => {
      const shell = (await window.exo.terminals.list()).find((session) => session.kind === "shell");
      if (!shell) {
        throw new Error("No shell terminal found");
      }
      return shell.id;
    });

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type("cat\n");
    await page.evaluate(async () => {
      const streamingShell = await window.exo.terminals.create({ kind: "shell" });
      await window.exo.terminals.write(
        streamingShell.id,
        "i=1; while [ $i -le 260 ]; do printf 'stream-latency-%03d\\n' \"$i\"; i=$((i+1)); sleep 0.01; done\n",
      );
    });
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(2);
    await expect.poll(async () => {
      const sessions = await page.evaluate(() => window.exo.terminals.list());
      const streamingShell = sessions.find((session) => session.kind === "shell" && session.id !== activeShellId);
      return streamingShell ? page.evaluate((id) => window.exo.terminals.read(id), streamingShell.id) : "";
    }).toContain("stream-latency-010");

    await page.getByTestId("terminal-tab-shell").first().click();
    await waitForTerminalText(page, "cat");

    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const marker = `exo-stream-latency-${index}-${Date.now()}`;
      const startedAt = performance.now();
      await page.keyboard.type(`${marker}\n`);
      await waitForTerminalText(page, marker);
      samples.push(performance.now() - startedAt);
    }

    const summary = latencySummary(samples);
    expect(summary.p50, `streaming terminal latency summary: ${JSON.stringify(summary)}`).toBeLessThan(100);
    expect(summary.p90, `streaming terminal latency summary: ${JSON.stringify(summary)}`).toBeLessThan(250);
  } finally {
    await cleanup();
  }
});

test("runs deterministic fake agent terminal QA without live inference", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_CLAUDE_COMMAND: process.execPath,
      EXO_CLAUDE_ARGS: `${fakeAgentPath},--claude`,
    },
  });

  try {
    await page.getByTestId("launch-claude").click();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await expect.poll(async () => readFirstTerminalOfKind(page, "claude")).toContain("FAKE_CLAUDE_READY");
    await page.getByTestId("terminal-tab-claude").click();
    await waitForTerminalText(page, "fake-agent-scrollback-080");

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type("hello deterministic agent\n");
    await waitForTerminalText(page, "FAKE_AGENT_INPUT hello deterministic agent");

    await page.getByTestId("terminal-tab-shell").click();
    await page.getByTestId("terminal-tab-claude").click();
    await waitForTerminalText(page, "FAKE_AGENT_PROMPT ready for input");
  } finally {
    await cleanup();
  }
});

test("reattaches a fake Claude terminal after renderer reload and accepts first focused input", async () => {
  const beforeReloadInput = `before reload ${Date.now()}`;
  const afterReloadInput = `after reload ${Date.now()}`;
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_CLAUDE_COMMAND: process.execPath,
      EXO_CLAUDE_ARGS: `${fakeAgentPath},--claude`,
    },
    initialNoteLabel: null,
  });

  try {
    await page.getByTestId("launch-claude").click();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await waitForTerminalText(page, "FAKE_AGENT_PROMPT ready for input");

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(`${beforeReloadInput}\n`);
    await waitForTerminalText(page, `FAKE_AGENT_INPUT ${beforeReloadInput}`);

    const claudeId = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      const claude = sessions.find((session) => session.kind === "claude");
      if (!claude) {
        throw new Error("No Claude terminal found");
      }
      return claude.id;
    });

    await page.reload();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("terminal-rail")).toBeVisible();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await waitForTerminalText(page, `FAKE_AGENT_INPUT ${beforeReloadInput}`);

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(`${afterReloadInput}\n`);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), claudeId)).toContain(
      `FAKE_AGENT_INPUT ${afterReloadInput}`,
    );
    await waitForTerminalText(page, `FAKE_AGENT_INPUT ${afterReloadInput}`);
  } finally {
    await cleanup();
  }
});

test("keeps fake Claude render stable and interactive while preview is open", async () => {
  const input = `preview render input ${Date.now()}`;
  const afterReloadInput = `preview reload input ${Date.now()}`;
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_CLAUDE_COMMAND: process.execPath,
      EXO_CLAUDE_ARGS: `${fakeAgentPath},--claude,--render-stability`,
    },
    initialNoteLabel: null,
  });

  try {
    await page.getByTestId("launch-browser").click();
    await expect(page.getByTestId("browser-pane")).toBeVisible();
    await page.getByTestId("launch-claude").click();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await expect.poll(async () => readFirstTerminalOfKind(page, "claude")).toContain("wrapped prompt marker");
    await waitForTerminalText(page, "wrapped prompt marker");
    await waitForTerminalText(page, "FAKE_AGENT_PROMPT ready for input");
    await expectTerminalRenderStable(page);
    await expectTerminalRenderHistoryStable(page);

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(`${input}\n`);
    await waitForTerminalText(page, `FAKE_AGENT_INPUT ${input}`);
    await expectTerminalRenderStable(page);
    await expectTerminalRenderHistoryStable(page);

    await page.reload();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await waitForTerminalText(page, "FAKE_AGENT_PROMPT ready for input");
    await expectTerminalRenderStable(page);
    await expectTerminalRenderHistoryStable(page);
    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(`${afterReloadInput}\n`);
    await waitForTerminalText(page, `FAKE_AGENT_INPUT ${afterReloadInput}`);
    await expectTerminalRenderStable(page);
    await expectTerminalRenderHistoryStable(page);
  } finally {
    await cleanup();
  }
});

test("keeps terminal interactive after large output, tab switches, and semantic sends", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "",
      EXO_CLAUDE_COMMAND: "/bin/sh",
      EXO_CLAUDE_ARGS:
        "-c,i=1; while [ $i -le 140 ]; do printf 'agent-scrollback-%03d\\n' \"$i\"; i=$((i+1)); done; sleep 5",
    },
  });

  try {
    const shellId = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      const shell = sessions.find((session) => session.kind === "shell");
      if (!shell) {
        throw new Error("No shell terminal found");
      }
      return shell.id;
    });

    await page.evaluate(async (id) => {
      await window.exo.terminals.write(
        id,
        "python3 - <<'PY'\nfor i in range(1500): print(f'qa-line-{i}')\nPY\n",
      );
    }, shellId);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shellId)).toContain("qa-line-1499");

    await page.getByTestId("launch-shell").click();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(2);
    await page.getByTestId("terminal-tab-shell").first().click();
    await expect(page.getByTestId("terminal-surface")).toContainText("qa-line-1499");
    await page.getByTestId("terminal-tab-shell").last().click();
    await page.getByTestId("terminal-tab-shell").first().click();
    await expect(page.getByTestId("terminal-surface")).toContainText("qa-line-1499");

    await page.evaluate(async (id) => {
      await window.exo.terminals.sendMessage(id, "printf 'semantic qa: %s\\n' 'one   two'", true);
    }, shellId);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shellId)).toContain("semantic qa: one   two");

    await page.getByTestId("launch-claude").click();
    await expect(page.getByTestId("terminal-tab-claude")).toBeVisible();
    await expect(page.locator(".xterm-rows")).toContainText("agent-scrollback-140");
    const agentBuffer = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      const claude = sessions.find((session) => session.kind === "claude");
      return claude ? window.exo.terminals.read(claude.id) : "";
    });
    expect(agentBuffer).toContain("agent-scrollback-140");

    const sessions = await page.evaluate(() => window.exo.terminals.list());
    const diagnostics = await page.evaluate(() => window.exo.terminals.diagnostics());
    expect(JSON.stringify(sessions)).not.toContain("tmux");
    expect(JSON.stringify(sessions)).not.toContain("transport");
    expect(JSON.stringify(diagnostics)).not.toContain("transport");
    expect(diagnostics.every((diagnostic) => diagnostic.runtime === "tmux")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.tmuxSessionName.startsWith("exo-"))).toBe(true);
  } finally {
    await cleanup();
  }
});

test("collapses the terminal pane after closing the last terminal", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("close-terminal-shell").click();
  await expect(page.getByTestId("terminal-expand")).toBeVisible();
  await expect(page.locator(".pane-leaf--terminal")).toHaveCount(0);

  await cleanup();
});

test("reattaches a tmux-backed shell after app relaunch", async () => {
  const beforeRelaunchMarker = `before-relaunch-${Date.now()}`;
  const shellEnv = {
    EXO_SHELL: "/bin/sh",
    EXO_SHELL_ARGS: "-lc,while IFS= read -r line; do printf 'persist:%s\\n' \"$line\"; done",
  };
  const fixture = await launchExoFixture({ env: shellEnv, initialNoteLabel: null });
  let relaunched: Awaited<ReturnType<typeof relaunchExoFixture>> | null = null;

  try {
    const shell = await pageShellSession(fixture.page);
    await fixture.page.evaluate(
      async ({ id, marker }) => {
        await window.exo.terminals.sendMessage(id, marker, true);
      },
      { id: shell.id, marker: beforeRelaunchMarker },
    );
    await expect.poll(async () => fixture.page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain(
      `persist:${beforeRelaunchMarker}`,
    );

    await fixture.electronApp.close();
    relaunched = await relaunchExoFixture(fixture, { env: shellEnv });

    await expect.poll(async () => relaunched?.page.evaluate(() => window.exo.terminals.list()) ?? []).toEqual([
      expect.objectContaining({
        id: shell.id,
        kind: "shell",
        status: "running",
      }),
    ]);
    await expect(relaunched.page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect.poll(async () => relaunched?.page.evaluate((id) => window.exo.terminals.read(id), shell.id) ?? "").toContain(
      `persist:${beforeRelaunchMarker}`,
    );
    await expect(
      relaunched.page.locator(".xterm-rows"),
      "tmux history should be visible immediately after relaunch, before any new input",
    ).toContainText(`persist:${beforeRelaunchMarker}`);
    await relaunched.page.evaluate(async (id) => {
      await window.exo.terminals.sendMessage(id, "after-relaunch", true);
    }, shell.id);
    await expect.poll(async () => relaunched?.page.evaluate((id) => window.exo.terminals.read(id), shell.id) ?? "").toContain("persist:after-relaunch");

    const diagnostics = await relaunched.page.evaluate(() => window.exo.terminals.diagnostics());
    expect(diagnostics[0]).toMatchObject({
      runtime: "tmux",
      bridgeStatus: "attached",
      tmuxSessionName: expect.stringMatching(/^exo-/),
    });
  } finally {
    if (relaunched) {
      await relaunched.cleanup();
    } else {
      await fixture.cleanup();
    }
  }
});

test("hydrates single-tab tmux terminal history after renderer reload before input", async () => {
  const beforeReloadMarker = `before-reload-${Date.now()}`;
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "-lc,while IFS= read -r line; do printf 'persist:%s\\n' \"$line\"; done",
    },
    initialNoteLabel: null,
  });

  try {
    const shell = await pageShellSession(page);
    await page.evaluate(
      async ({ id, marker }) => {
        await window.exo.terminals.sendMessage(id, marker, true);
      },
      { id: shell.id, marker: beforeReloadMarker },
    );
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain(
      `persist:${beforeReloadMarker}`,
    );

    await page.reload();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("terminal-rail")).toBeVisible();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain(
      `persist:${beforeReloadMarker}`,
    );
    await expect(
      page.locator(".xterm-rows"),
      "single-tab tmux history should render after reload without tab switching or input",
    ).toContainText(`persist:${beforeReloadMarker}`);

    await page.evaluate(async (id) => {
      await window.exo.terminals.sendMessage(id, "after-reload", true);
    }, shell.id);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain("persist:after-reload");
  } finally {
    await cleanup();
  }
});

test("shows a reconnect action when the tmux attach bridge exits", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "",
    },
    initialNoteLabel: null,
  });

  try {
    const shell = await pageShellSession(page);
    const diagnostic = await page.evaluate(async (id) => {
      const diagnostics = await window.exo.terminals.diagnostics();
      return diagnostics.find((candidate) => candidate.id === id) ?? null;
    }, shell.id);
    if (!diagnostic?.tmuxSessionName) {
      throw new Error("Expected shell terminal to expose a tmux session name in diagnostics.");
    }

    const killed = killTmuxAttachClients(diagnostic.tmuxSessionName);
    expect(killed, `Expected to kill tmux attach client for ${diagnostic.tmuxSessionName}`).toBeGreaterThan(0);
    await expect.poll(async () => page.evaluate(async (id) => {
      const diagnostics = await window.exo.terminals.diagnostics();
      const current = diagnostics.find((candidate) => candidate.id === id);
      return current ? `${current.bridgeStatus}:${current.health}` : "";
    }, shell.id)).toBe("detached:unhealthy");

    await expect(page.getByTestId("terminal-reconnect")).toBeVisible();
    await page.getByTestId("terminal-reconnect").click();
    await expect.poll(async () => page.evaluate(async (id) => {
      const diagnostics = await window.exo.terminals.diagnostics();
      const current = diagnostics.find((candidate) => candidate.id === id);
      return current ? `${current.bridgeStatus}:${current.paneStatus}` : "";
    }, shell.id)).toBe("attached:alive");

    await page.evaluate(async (id) => {
      await window.exo.terminals.write(id, "printf 'after-reconnect-ui\\n'\n");
    }, shell.id);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain("after-reconnect-ui");
  } finally {
    await cleanup();
  }
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
  await expect(page.getByTestId("workspace-settings-dialog")).toContainText("Live terminal scrollback lines");
  await expect(page.getByTestId("workspace-settings-terminal-history-lines")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-terminal-history-lines")).toHaveValue("100000");
  await page.getByTestId("workspace-settings-terminal-history-lines").fill("250000");
  await expect(page.getByTestId("workspace-settings-terminal-history-lines")).toHaveValue("250000");
  await expect(page.getByTestId("workspace-settings-terminal-transcript-retention")).toHaveValue("forever");
  await expect(page.getByTestId("workspace-settings-terminal-read-tail-chars")).toHaveValue("20000");
  await expect(page.getByTestId("workspace-settings-terminal-max-read-tail-chars")).toHaveValue("200000");
  await expect(page.getByTestId("workspace-settings-terminal-input-coalesce-ms")).toHaveValue("40");
  await expect(page.getByTestId("workspace-settings-terminal-unresponsive-threshold-ms")).toHaveValue("10000");
  await expect(page.getByTestId("workspace-settings-terminal-idle-threshold-ms")).toHaveValue("120000");
  await expect(page.getByTestId("workspace-settings-dialog")).not.toContainText("Agent streaming");
  await expect(page.getByTestId("workspace-settings-dialog")).not.toContainText("Agent terminal transport");

  await cleanup();
});

test("keeps the command server available while the window is hidden", async () => {
  const { electronApp, page, runtimeRoot, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });

  const hidden = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.hide();
    return !window.isVisible();
  });
  expect(hidden).toBe(true);

  const serverInfo = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number };
  const statusResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/status`);
  expect(statusResponse.ok).toBe(true);
  await expect(statusResponse.json()).resolves.toMatchObject({
    workspace: expect.objectContaining({ workspaceRoot: expect.any(String) }),
  });

  const terminals = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals`).then((response) => response.json()) as Array<{ id: string; kind: string }>;
  const shell = terminals.find((terminal) => terminal.kind === "shell");
  expect(shell).toBeTruthy();
  const messageResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals/${shell!.id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hidden window qa", submit: true }),
  });
  expect(messageResponse.ok).toBe(true);
  await expect.poll(async () => {
    const tailResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals/${shell!.id}/tail`);
    const body = await tailResponse.json() as { tail?: string };
    return body.tail ?? "";
  }).toContain("hidden window qa");

  const showResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(showResponse.ok).toBe(true);
  await expect.poll(async () =>
    electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
  ).toBe(true);
  await expect(page.getByTestId("sidebar")).toBeVisible();

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("command:open-settings", { section: "terminal" });
  });
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  await expect(page.getByTestId("workspace-settings-tab-terminal")).toHaveClass(/dialog-tabs__button--active/);

  await cleanup();
});

test("supports CLI and MCP agent control while the window is hidden", async () => {
  const { electronApp, runtimeRoot, workspaceRoot, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
  });
  const cliEnv: Record<string, string> = {
    ...stringEnv(process.env),
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    EXO_RUNTIME_ROOT: runtimeRoot,
    EXO_WORKSPACE_ROOT: workspaceRoot,
    EXO_NOTE_ROOTS: path.join(workspaceRoot, "notes/test-notes"),
    EXO_PROJECT_ROOTS: path.join(workspaceRoot, "projects/sample-project"),
  };

  try {
    const hidden = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.hide();
      return !window.isVisible();
    });
    expect(hidden).toBe(true);

    const status = runExoCli(["status"], cliEnv);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(workspaceRoot);

    const agents = runExoCli(["agents", "list"], cliEnv);
    expect(agents.status).toBe(0);

    const createdAgent = runExoCli(["agents", "create", "shell", workspaceRoot], cliEnv);
    expect(createdAgent.status).toBe(0);
    const shellId = (JSON.parse(createdAgent.stdout) as { id: string }).id;
    expect(shellId).toMatch(/^term-\d+$/);

    const cliMessage = `hidden cli qa ${Date.now()}`;
    const send = runExoCli(["agents", "send", shellId!, cliMessage], cliEnv);
    expect(send.status).toBe(0);
    await expect.poll(() => runExoCli(["agents", "read", shellId!, "--tail", "2000"], cliEnv).stdout).toContain(cliMessage);

    const mcpClient = await createMcpJsonRpcClient(cliEnv);

    try {
      await expect(mcpClient.listTools()).resolves.toEqual([
        "close_preview",
        "create_agent",
        "focus_preview",
        "interrupt_agent",
        "list_agents",
        "open_preview",
        "read_agent",
        "read_document",
        "search",
        "send_agent_message",
        "terminate_agent",
        "workspace_status",
      ]);
      const workspaceStatus = await mcpClient.callTool("workspace_status", {});
      expect(JSON.stringify(workspaceStatus.structuredContent)).toContain("\"indexStatus\"");

      const mcpAgents = await mcpClient.callTool("list_agents", {});
      expect(JSON.stringify(mcpAgents.structuredContent)).toContain(shellId!);

      const mcpMessage = `hidden mcp qa ${Date.now()}`;
      const mcpCreated = await mcpClient.callTool("create_agent", { kind: "shell", cwd: workspaceRoot });
      const mcpShellId = ((mcpCreated.structuredContent as { agent?: { id?: string } }).agent?.id);
      expect(mcpShellId).toMatch(/^term-\d+$/);

      const mcpSend = await mcpClient.callTool("send_agent_message", { agentId: mcpShellId, message: mcpMessage, submit: true });
      expect(JSON.stringify(mcpSend.structuredContent)).toContain("\"delivery\":\"sent\"");

      await expect.poll(async () => {
        const read = await mcpClient.callTool("read_agent", { agentId: shellId, tailChars: 2000, clean: true });
        return JSON.stringify(read.structuredContent);
      }).toContain(cliMessage);
      await expect.poll(async () => {
        const read = await mcpClient.callTool("read_agent", { agentId: mcpShellId, tailChars: 2000, clean: true });
        return JSON.stringify(read.structuredContent);
      }).toContain(mcpMessage);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${mcpClient.stderr()}`);
    } finally {
      mcpClient.close();
    }
  } finally {
    await cleanup();
  }
});

function runExoCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(path.join(repoRoot, "bin/exo"), args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function createMcpJsonRpcClient(env: Record<string, string>) {
  const child = spawn("pnpm", ["exec", "tsx", "packages/mcp/src/index.ts"], {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    let newlineIndex = stdout.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdout.slice(0, newlineIndex).trim();
      stdout = stdout.slice(newlineIndex + 1);
      newlineIndex = stdout.indexOf("\n");
      if (!line) {
        continue;
      }
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof message.id !== "number") {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) {
        continue;
      }
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", (code, signal) => {
    const error = new Error(`MCP process exited with code ${code ?? "null"} signal ${signal ?? "null"}.\n${stderr}`);
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  });

  function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId;
    nextId += 1;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out.\n${stderr}`));
      }, 15_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "exo-hidden-window-e2e", version: "0.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  return {
    listTools: async () => {
      const result = await request("tools/list", {});
      const tools = (result as { tools?: Array<{ name?: string }> }).tools ?? [];
      return tools.map((tool) => String(tool.name)).sort();
    },
    callTool: (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }),
    close: () => {
      child.kill();
    },
    stderr: () => stderr,
  };
}

test("opens agent config editor with partial agent instruction discovery errors", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
    prepareWorkspace: async (workspaceRoot) => {
      await mkdir(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"));
    },
  });

  try {
    await page.getByTestId("workspace-settings").click();
    await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
    await expect(page.getByTestId("workspace-settings-tab-agents")).toHaveCount(0);
    await expect(page.getByTestId("workspace-settings-dialog").locator(".dialog-tabs__button")).toHaveCount(4);
    const settingsLayout = await page.getByTestId("workspace-settings-dialog").evaluate((dialog) => {
      const overlay = document.querySelector<HTMLElement>('[data-testid="workspace-settings-overlay"]');
      const tabs = dialog.querySelector<HTMLElement>(".dialog-tabs");
      const lastTab = dialog.querySelector<HTMLElement>(".dialog-tabs__button:last-child");
      return {
        backdropFilter: overlay ? getComputedStyle(overlay).backdropFilter : "",
        lastTabRight: lastTab?.getBoundingClientRect().right ?? 0,
        tabsRight: tabs?.getBoundingClientRect().right ?? 0,
        width: dialog.getBoundingClientRect().width,
      };
    });
    expect(settingsLayout.width).toBeGreaterThanOrEqual(680);
    expect(settingsLayout.backdropFilter === "" || settingsLayout.backdropFilter === "none").toBe(true);
    expect(settingsLayout.tabsRight - settingsLayout.lastTabRight).toBeLessThanOrEqual(6);
    await page.getByTestId("workspace-settings-close").click();
    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await expect(page.getByTestId("agent-context-manager").locator(".dialog-tabs__button")).toHaveCount(3);
    await expect(page.getByTestId("agent-context-manager-partial-errors")).toContainText("Notes AGENTS.md");
    await expect(page.getByTestId("agent-context-manager-body")).toContainText("Scope");
  } finally {
    await cleanup();
  }
});

test("keeps long agent instruction errors separate from narrow manager controls", async () => {
  const { electronApp, page, cleanup } = await launchExoFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
  });

  try {
    const longError = [
      "agent instructions:",
      "failed to inspect a very long provider instruction path after a stale preload bridge restart",
      "/very/long/workspace/path/with/provider/instructions/AGENTS.md",
      "restart Exo to reload the preload bundle before editing agent instructions",
    ].join(" ");
    await electronApp.evaluate(({ ipcMain }, errorMessage) => {
      ipcMain.removeHandler("workspace:get-agent-instruction-config");
      ipcMain.handle("workspace:get-agent-instruction-config", async () => {
        throw new Error(errorMessage);
      });
    }, longError);

    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await page.setViewportSize({ width: 720, height: 720 });
    await expect(page.getByTestId("agent-context-manager-partial-errors")).toContainText("stale preload bridge restart");

    const errorBox = await page.getByTestId("agent-context-manager-partial-errors").boundingBox();
    const controlsBox = await page.getByTestId("agent-context-scope-controls").boundingBox();
    expect(errorBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(boxesOverlap(errorBox!, controlsBox!)).toBe(false);
  } finally {
    await cleanup();
  }
});

test("syncs global and exocortex agent instruction files from workspace settings", async () => {
  const { page, workspaceRoot, homeRoot, cleanup } = await launchExoFixture({
    mutable: true,
    prepareWorkspace: async (workspaceRoot) => {
      await writeFile(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"), "# Notes agents\nUse notes AGENTS source.\n", "utf8");
      await writeFile(path.join(workspaceRoot, "notes/test-notes/CLAUDE.md"), "# Notes claude\nUse notes CLAUDE source.\n", "utf8");
    },
  });

  try {
    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await expect(page.getByTestId("agent-context-manager")).not.toContainText("soul.md");
    await expect(page.getByTestId("agent-context-manager")).not.toContainText("Managed config editor");

    const editorBox = await page.getByTestId("agent-context-unified-editor").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.height).toBeGreaterThan(240);
    await page.getByTestId("agent-context-unified-editor").fill(Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"));
    await expect.poll(async () =>
      page.getByTestId("agent-context-unified-editor").evaluate((node) => {
        const textarea = node as HTMLTextAreaElement;
        textarea.scrollTop = textarea.scrollHeight;
        return textarea.scrollTop;
      }),
    ).toBeGreaterThan(0);

    await page.getByTestId("agent-config-load-template").click();
    await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue(/Exo Agent Instructions/);
    await page.getByTestId("agent-context-unified-editor").fill("Use unified global context.");
    await page.getByTestId("agent-context-save-unified").click();
    await expect(page.getByTestId("agent-context-unified-status")).toContainText("aligned");
    await expect.poll(async () => readFile(path.join(homeRoot, ".codex/AGENTS.md"), "utf8")).toBe("Use unified global context.\n");
    await expect.poll(async () => readFile(path.join(homeRoot, ".claude/CLAUDE.md"), "utf8")).toBe("Use unified global context.\n");
    await expect(access(path.join(homeRoot, "soul.md"))).rejects.toThrow();

    await page.getByTestId("agent-context-scope-exocortex").click();
    await expect(page.getByTestId("agent-config-status")).toContainText("Different");
    await expect(page.getByTestId("agent-config-divergence")).toContainText("AGENTS.md and CLAUDE.md are different");
    await page.getByTestId("agent-config-use-claude").click();
    await expect(page.getByTestId("agent-context-unified-editor")).toHaveValue(/Use notes CLAUDE source/);
    await page.getByTestId("agent-context-unified-editor").fill("Use unified notes context.");
    await page.getByTestId("agent-context-save-unified").click();
    await expect(page.getByTestId("agent-context-unified-status")).toContainText("aligned");
    await expect.poll(async () => readFile(path.join(workspaceRoot, "notes/test-notes/AGENTS.md"), "utf8")).toBe("Use unified notes context.\n");
    await expect.poll(async () => readFile(path.join(workspaceRoot, "notes/test-notes/CLAUDE.md"), "utf8")).toBe("Use unified notes context.\n");
    await expect(access(path.join(workspaceRoot, "notes/test-notes/soul.md"))).rejects.toThrow();
    await expect(access(path.join(workspaceRoot, "projects/sample-project/AGENTS.md"))).rejects.toThrow();
  } finally {
    await cleanup();
  }
});

test("manages harness skill files from the agent config editor", async () => {
  const { page, homeRoot, cleanup } = await launchExoFixture({ mutable: true });
  const skillRoot = path.join(homeRoot, ".claude", "skills", "qa-skill");
  const skillFile = path.join(skillRoot, "SKILL.md");

  try {
    await mkdir(skillRoot, { recursive: true });
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(skillFile, "# QA Skill\n\nInitial body.\n", "utf8");
    await writeFile(path.join(skillRoot, "references", "example.md"), "# Example\n", "utf8");

    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await page.getByTestId("agent-config-tab-skills").click();
    await expect(page.getByTestId("agent-skills-manager")).toContainText("QA Skill");
    await expect(page.getByTestId("agent-skills-manager")).toContainText("claude · global · enabled");
    await expect(page.getByTestId("agent-skill-files").locator(".agent-skills__file").first()).toHaveText("SKILL.md");
    await expect(page.getByTestId("agent-skill-file-references")).toHaveText(/▾ references/);
    await expect(page.getByTestId("agent-skill-file-references/example.md")).toBeVisible();
    await page.getByTestId("agent-skill-file-references").click();
    await expect(page.getByTestId("agent-skill-file-references")).toHaveText(/▸ references/);
    await expect(page.getByTestId("agent-skill-file-references/example.md")).toHaveCount(0);
    await expect(page.getByTestId("agent-skill-file-editor")).toHaveValue(/Initial body/);

    await page.getByTestId("agent-skill-file-editor").fill("# QA Skill\n\nEdited body.\n");
    await page.getByTestId("agent-skill-save-file").click();
    await expect.poll(async () => readFile(skillFile, "utf8")).toBe("# QA Skill\n\nEdited body.\n");

    await page.getByTestId("agent-skill-toggle-enabled").click();
    await expect(page.getByTestId("agent-skills-manager")).toContainText("claude · global · disabled");
    await expect(access(skillFile)).rejects.toThrow();

    await page.getByTestId("agent-skill-toggle-enabled").click();
    await expect(page.getByTestId("agent-skills-manager")).toContainText("claude · global · enabled");
    await expect.poll(async () => readFile(skillFile, "utf8")).toBe("# QA Skill\n\nEdited body.\n");
  } finally {
    await cleanup();
  }
});

test("shows missing Pi backend status and hides unconfigured Hermes launchers", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_PI_COMMAND: "/bin/sh",
      EXO_PI_LABEL: "Custom Pi build",
    },
  });

  try {
    await expect(page.getByTestId("launch-pi")).toHaveCount(0);
    await expect(page.getByTestId("launch-hermes")).toHaveCount(0);

    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await page.getByTestId("agent-config-tab-harnesses").click();

    await expect(page.getByTestId("agent-harness-pi")).toContainText("Custom Pi build");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("Missing dependency");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("Launch unavailable");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("Pi inference backend: Missing");
    await expect(page.getByTestId("agent-harness-hermes")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("shows a configured generic Pi-compatible launcher when backend config exists", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_PI_COMMAND: "/bin/sh",
      EXO_PI_LABEL: "Custom Pi build",
      EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
    },
  });

  try {
    await expect(page.getByTestId("launch-pi")).toBeVisible();

    await page.getByTestId("open-agent-config").click();
    await page.getByTestId("agent-config-tab-harnesses").click();

    await expect(page.getByTestId("agent-harness-pi")).toContainText("Configured");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("Launchable");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("Pi inference backend: Configured");
    await expect(page.getByTestId("agent-harness-pi")).toContainText("http://127.0.0.1:8080");
  } finally {
    await cleanup();
  }
});

test("syncs a git skill source and installs a library skill copy", async () => {
  const { page, workspaceRoot, homeRoot, cleanup } = await launchExoFixture({ mutable: true });
  const sourceRepo = path.join(workspaceRoot, "skill-source");
  const librarySkillRoot = path.join(sourceRepo, "skills", "library-skill");
  const installedSkillFile = path.join(homeRoot, ".claude", "skills", "library-skill", "SKILL.md");

  try {
    await mkdir(librarySkillRoot, { recursive: true });
    await writeFile(path.join(librarySkillRoot, "SKILL.md"), "# Library Skill\n\nUse safely.\n", "utf8");
    runGit(sourceRepo, ["init"]);
    runGit(sourceRepo, ["config", "user.email", "exo@example.com"]);
    runGit(sourceRepo, ["config", "user.name", "Exo Test"]);
    runGit(sourceRepo, ["add", "."]);
    runGit(sourceRepo, ["commit", "-m", "init skills"]);

    await page.getByTestId("open-agent-config").click();
    await expect(page.getByTestId("agent-context-manager")).toBeVisible();
    await page.getByTestId("agent-config-tab-sources").click();
    await page.getByTestId("agent-skill-source-url").fill(sourceRepo);
    await page.getByTestId("agent-skill-source-add").click();
    await expect(page.getByTestId("agent-skill-sources")).toContainText("Library Skill");
    await expect(page.getByTestId("agent-skill-install-target")).toHaveValue("claude:global");
    await page.getByTestId("agent-library-skill-install").click();
    await expect(page.getByTestId("agent-skill-sources")).toContainText("Skill installed");
    await expect.poll(async () => readFile(installedSkillFile, "utf8")).toBe("# Library Skill\n\nUse safely.\n");
  } finally {
    await cleanup();
  }
});

test("switch workspace opens the workspace picker", async () => {
  const { page, cleanup } = await launchExoFixture();

  await page.getByTestId("workspace-settings").click();
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByTestId("onboarding")).toContainText("Select workspace");
  await expect(page.getByTestId("workspace-picker-item").first()).toContainText("test-notes");
  await expect(page.getByTestId("workspace-picker-open")).toBeEnabled();
  await page.getByTestId("workspace-picker-new").click();
  await expect(page.getByTestId("onboarding")).toContainText("Choose notes folder");
  await expect(page.getByTestId("onboarding-choose-notes")).toBeVisible();

  await cleanup();
});

test("shows first-run notes setup before the app shell", async () => {
  const { page, cleanup } = await launchExoFixture({ configured: false });

  await expect(page.getByTestId("onboarding")).toContainText("Open notes folder");
  await expect(page.getByTestId("workspace-picker")).toHaveCount(0);
  await expect(page.getByTestId("workspace-picker-open")).toHaveCount(0);
  await expect(page.getByTestId("onboarding")).toContainText("Default terminal");
  await expect(page.getByTestId("onboarding")).toContainText("Knowledge index");
  await expect(page.getByTestId("onboarding-notes-folder")).toContainText("No notes folder selected.");
  await expect(page.getByTestId("onboarding-continue")).toBeDisabled();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);

  await cleanup();
});

test("shows first-run setup from a packaged-style launch without workspace env", async () => {
  const { page, cleanup } = await launchExoFixture({
    configured: false,
    cwd: "/",
    workspaceRootEnv: false,
    runtimeRootEnv: false,
  });

  await expect(page.getByTestId("onboarding")).toContainText("Open notes folder");
  await expect(page.getByTestId("workspace-picker-open")).toHaveCount(0);
  const model = await page.evaluate(() => window.exo.workspace.getModel());
  expect(model.workspaceRoot).not.toBe("/");

  await cleanup();
});

test("opens an existing notes folder from first-run setup", async () => {
  const fixtureWorkspaceRoot = path.join(repoRoot, "fixtures/test-workspace");
  const notesFolder = path.join(fixtureWorkspaceRoot, "notes/test-notes");
  const { page, cleanup, workspaceRoot } = await launchExoFixture({
    configured: false,
    env: {
      EXO_TEST_SELECT_FOLDER_PATH: notesFolder,
    },
  });
  const expectedTerminalCwd = path.join(workspaceRoot, "notes");

  await page.getByTestId("onboarding-choose-notes").click();
  await expect(page.getByTestId("onboarding-notes-folder")).toContainText(notesFolder);
  await expect(page.getByTestId("onboarding-terminal-folder")).toContainText(expectedTerminalCwd);

  await page.getByTestId("onboarding-continue").click();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-rail")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.exo.workspace.getSettings()))
    .toMatchObject({
      noteRoots: [notesFolder],
      defaultTerminalCwd: expectedTerminalCwd,
    });

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

  try {
    await expect(page.locator(".xterm-rows")).toContainText("scrollback-900");
    await expect(page.locator(".xterm-rows")).not.toContainText("scrollback-001");

    await page.getByTestId("terminal-surface").hover();
    await page.mouse.wheel(0, -50000);

    await expect.poll(async () => page.locator(".xterm-rows").innerText()).toMatch(/scrollback-(00[1-9]|0[1-9][0-9]|[12][0-9]{2})-/);
  } finally {
    await cleanup();
  }
});

test("keeps app terminal tail above the legacy 12k cap", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS:
        "-c,sleep 0.2; i=1; while [ $i -le 220 ]; do printf 'buffer-%03d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' \"$i\"; i=$((i+1)); done; sleep 5",
    },
  });

  try {
    await expect(page.locator(".xterm-rows")).toContainText("buffer-220");
    const buffer = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      return sessions[0] ? window.exo.terminals.read(sessions[0].id) : "";
    });

    expect(buffer.length).toBeGreaterThan(12_000);
    expect(buffer).toContain("buffer-001");
  } finally {
    await cleanup();
  }
});

test("renders emoji-heavy terminal output without replacement glyph corruption", async () => {
  const { page, cleanup } = await launchExoFixture({
    env: {
      EXO_SHELL: process.execPath,
      EXO_SHELL_ARGS: '-e,process.stdout.write("── 🙂 terminal-border\\n"+"🙂".repeat(20000)+"\\nterminal-emoji-end\\n");setInterval(()=>{},1000)',
    },
  });

  try {
    await expect(page.locator(".xterm-rows")).toContainText("terminal-emoji-end");
    const buffer = await page.evaluate(async () => {
      const sessions = await window.exo.terminals.list();
      return sessions[0] ? window.exo.terminals.read(sessions[0].id) : "";
    });
    expect(buffer).toContain("── 🙂 terminal-border");
    await expect(page.locator(".xterm-rows")).not.toContainText("�");
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

test("outdents blank list continuation lines in live preview", async () => {
  const { page, cleanup } = await launchExoFixture({
    prepareWorkspace: async (workspaceRoot) => {
      const notePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
      await writeFile(
        notePath,
        `---\ntitle: Focus Note\n---\n\n# Probe\n\n- working on\n  - transformation workshop\n  - evals deck/blog post\n  \nnotes\n`,
      );
    },
  });

  async function setCursorOnExactLine(text: string, offset: number) {
    await page.evaluate(({ lineText, nextOffset }) => {
      const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
      const view = content?.cmView?.view;
      if (!view) {
        throw new Error("Unable to resolve CodeMirror view");
      }
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        if (line.text === lineText) {
          view.dispatch({ selection: { anchor: line.from + nextOffset }, scrollIntoView: true });
          view.focus();
          return;
        }
      }
      throw new Error(`Unable to find exact line ${JSON.stringify(lineText)}`);
    }, { lineText: text, nextOffset: offset });
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

  await setCursorOnExactLine("  ", 2);
  const blankLineClassList = await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as (HTMLElement & { cmView?: { view?: any } }) | null;
    const view = content?.cmView?.view;
    if (!view) {
      throw new Error("Unable to resolve CodeMirror view");
    }
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const lineIndex = line.number - 1;
    const element = document.querySelectorAll<HTMLElement>(".cm-line")[lineIndex];
    return Array.from(element?.classList ?? []);
  });
  expect(blankLineClassList).not.toContain("exo-md-line--list-continuation");

  await page.keyboard.press("Enter");
  await expect.poll(cursorLocation).toEqual({ lineText: "", offset: 0 });

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
