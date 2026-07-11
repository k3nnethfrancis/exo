import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

import {
  launchExoTerminalFixture,
  launchExoWorkspaceFixture,
} from "../helpers";
import {
  latencySummary,
  waitForTerminalInputEnabled,
  waitForTerminalText,
} from "../terminalQuality";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function expectTestIdsDoNotOverlap(page: import("@playwright/test").Page, firstTestId: string, secondTestId: string) {
  const firstBox = await page.getByTestId(firstTestId).boundingBox();
  const secondBox = await page.getByTestId(secondTestId).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(boxesOverlap(firstBox!, secondBox!)).toBe(false);
}

async function expectStableOuterFrame(
  locator: import("@playwright/test").Locator,
  before: { width: number; height: number },
) {
  const after = await locator.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before.height)).toBeLessThanOrEqual(1);
}

async function cycleAppearanceTo(page: import("@playwright/test").Page, targetMode: "system" | "light" | "dark") {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentMode = await page.locator("html").getAttribute("data-appearance-mode");
    if (currentMode === targetMode) {
      return;
    }

    if (!(await page.getByTestId("workspace-appearance").isVisible().catch(() => false))) {
      await page.getByTestId("workspace-menu-button").click();
    }
    await page.getByTestId("workspace-appearance").click();
  }

  throw new Error(`Unable to reach appearance mode ${targetMode}.`);
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

async function dragBy(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator, delta: { x: number; y: number }) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(start.x + (delta.x * step) / 8, start.y + (delta.y * step) / 8);
    await expect(page.locator(".xterm-rows")).toContainText("preview-first-input");
  }
  await page.mouse.up();
  await page.waitForTimeout(50);
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

test.describe.configure({ mode: "parallel" });


test("boots the shell, opens notes, and manages terminal tabs", async () => {
  const { page, cleanup } = await launchExoTerminalFixture();

  await expect(page.getByTestId("editor-title")).toHaveText("focus-note");
  await expect(page.getByTestId("editor-panel")).toContainText("Linked references:");
  await expect(page.getByTestId("editor-panel")).toContainText("agent-memory");
  await expect(page.getByTestId("editor-panel")).toContainText("#research");
  await page.getByTestId("toggle-markdown-mode").click();
  await expect(page.getByTestId("editor-panel")).toContainText("[[agent-memory]]");

  await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();
  await expect(page.getByTestId("side-panel-terminal-rail")).toBeVisible();
  await expect(page.locator('[data-testid="launch-claude"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="launch-codex"]')).toHaveCount(0);
  await expect.poll(async () =>
    page.evaluate(async () => (await window.exo.terminals.list()).map((session) => session.kind)),
  ).toEqual(["shell"]);

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

test("shows a visible BrowserWindow on startup", async () => {
  const { electronApp, page, cleanup } = await launchExoWorkspaceFixture();

  const openWindows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).length,
  );

  expect(openWindows).toBeGreaterThan(0);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();

  await cleanup();
});

test("opens a browser preview pane in the workspace", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  await expect(page.locator('[data-testid="terminal-rail"] [data-testid="launch-browser"]')).toHaveCount(0);
  await expect(page.locator('.sidebar__rail [data-testid="launch-browser"]')).toHaveCount(0);
  await expect(page.getByTestId("exo-side-panel")).not.toBeVisible();
  await page.getByTestId("side-panel-toggle").click();
  await expect(page.getByTestId("exo-side-panel")).toBeVisible();
  await page.getByTestId("side-panel-browser-rail").click();
  await expect(page.getByTestId("browser-pane")).toBeVisible();
  await expect(page.getByTestId("browser-url-input")).toHaveValue("about:blank");
  await expect(page.getByText("Enter a local or localhost URL to preview.")).toBeVisible();

  await page.getByTestId("browser-url-input").fill("localhost:4321");
  await page.getByTestId("browser-load-url").click();
  await expect(page.getByTestId("browser-url-input")).toHaveValue("http://localhost:4321/");
  await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", "http://localhost:4321/");
  await expect(page.locator(".pane-leaf--browser")).toBeVisible();

  await cleanup();
});

test("creates, renames, and deletes notes from the explorer", async () => {
  const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({
    prepareWorkspace: async (root) => {
      await mkdir(path.join(root, "notes/test-notes/mutation-dir"), { recursive: true });
    },
  });
  const notesRoot = path.join(workspaceRoot, "notes/test-notes");
  const mutationDirectoryPath = path.join(notesRoot, "mutation-dir");
  const createdPath = path.join(mutationDirectoryPath, "mutation-qa.md");
  const renamedPath = path.join(mutationDirectoryPath, "mutation-renamed.md");

  const mutationDirectory = page.locator(".tree-node--directory", { hasText: "mutation-dir" }).first();
  await mutationDirectory.click();
  await mutationDirectory.click({ button: "right" });
  await page.getByRole("button", { name: "New File" }).click();
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
  const { page, workspaceRoot, cleanup } = await launchExoWorkspaceFixture({ mutable: true });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const focusNotePath = path.join(workspaceRoot, "notes/test-notes/focus-note.md");
  const now = new Date();
  const dailyName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  await expect(page.getByTestId("exo-side-panel")).not.toBeVisible();
  await expect(page.getByTestId("terminal-dock")).not.toBeVisible();

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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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

test("shows terminals created outside renderer controls", async () => {
  const { page, cleanup } = await launchExoTerminalFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "-lc,pwd; cat",
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

test("matches system appearance by default and supports light mode override", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
    await waitForTerminalInputEnabled(page);
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

    await page.locator(`[data-tab-item-id="${activeShellId}"]`).click();
    await waitForTerminalInputEnabled(page);

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

test("keeps /bin/cat terminal input visible while a loaded preview is focused and resized", async () => {
  const previewFirstInput = "preview-first-input";
  const previewReturnInput = "preview-return-input";
  const previewResizeInput = "preview-resize-input";
  const { page, cleanup, workspaceRoot } = await launchExoTerminalFixture({
    prepareWorkspace: async (root) => {
      await writeFile(
        path.join(root, "preview-terminal-focus.html"),
        "<!doctype html><html><body><button autofocus>preview loaded</button><p>terminal focus regression</p></body></html>",
      );
    },
    env: {
      EXO_SHELL: "/bin/cat",
      EXO_SHELL_ARGS: "",
    },
    initialNoteLabel: null,
  });

  try {
    const shell = await pageShellSession(page);
    await page.getByTestId("side-panel-browser-rail").click();
    await page.getByTestId("browser-url-input").fill(`file://${path.join(workspaceRoot, "preview-terminal-focus.html")}`);
    await page.getByTestId("browser-load-url").click();
    await expect(page.getByTestId("browser-preview-frame")).toHaveAttribute("src", /^file:\/\/.*preview-terminal-focus\.html$/);

    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(previewFirstInput);
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(previewFirstInput);

    await page.getByTestId("browser-pane").click();
    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(previewReturnInput);
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(previewReturnInput);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id))
      .toContain(previewReturnInput);

    await dragBy(page, page.locator(".exo-side-panel-surface .pane-split-resizer--vertical").first(), { x: -160, y: 0 });
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id))
      .toContain(previewReturnInput);
    await page.getByTestId("terminal-surface").click();
    await page.keyboard.type(previewResizeInput);
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(previewFirstInput);
    await expect(page.locator(".xterm-rows")).toContainText(previewReturnInput);
    await expect(page.locator(".xterm-rows")).toContainText(previewResizeInput);
  } finally {
    await cleanup();
  }
});

test("keeps terminal interactive after large output, tab switches, and semantic sends", async () => {
  const { page, cleanup } = await launchExoTerminalFixture({
    env: {
      EXO_SHELL: "/bin/sh",
      EXO_SHELL_ARGS: "",
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

    await page.getByTestId("side-panel-terminal-rail").click();
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

    const sessions = await page.evaluate(() => window.exo.terminals.list());
    expect(JSON.stringify(sessions)).not.toContain("tmux");
    expect(JSON.stringify(sessions)).not.toContain("transport");
  } finally {
    await cleanup();
  }
});

test("removes the last terminal session without hiding the workspace", async () => {
  const { page, cleanup } = await launchExoTerminalFixture();

  await page.getByTestId("close-terminal-shell").click();
  await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(0);
  await expect(page.getByTestId("terminal-surface")).toHaveCount(0);
  await expect(page.locator(".pane-leaf--editor")).toBeVisible();
  await expect(page.getByTestId("side-panel-toggle")).toBeVisible();

  await cleanup();
});

test("replays bounded terminal history after renderer reload before input", async () => {
  const beforeReloadMarker = `before-reload-${Date.now()}`;
  const { page, cleanup } = await launchExoTerminalFixture({
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
    await page.getByTestId("side-panel-toggle").click();
    await expect(page.getByTestId("side-panel-terminal-rail")).toBeVisible();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain(
      `persist:${beforeReloadMarker}`,
    );
    await expect(
      page.locator(".xterm-rows"),
      "terminal history should render after reload without tab switching or input",
    ).toContainText(`persist:${beforeReloadMarker}`);

    await page.evaluate(async (id) => {
      await window.exo.terminals.sendMessage(id, "after-reload", true);
    }, shell.id);
    await expect.poll(async () => page.evaluate((id) => window.exo.terminals.read(id), shell.id)).toContain("persist:after-reload");
  } finally {
    await cleanup();
  }
});

test("lets you close editor tabs", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("backlinks-panel").getByText("Related Note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("related-note");
  await page.getByLabel("Close related-note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("focus-note");

  await cleanup();
});

test("renders inspector content when expanded", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  await page.getByTestId("inspector-toggle").click();

  await expect(page.getByTestId("inspector-panel")).toContainText("Backlinks");
  await expect(page.getByTestId("inspector-panel")).toContainText(/Related Note|\[\[agent-memory\]\]|#research/);
  await expect(page.getByTestId("graph-neighborhood-panel")).toContainText("Neighborhood");
  await expect(page.getByTestId("graph-neighborhood")).toContainText("agent-memory");
  await expect(page.getByTestId("graph-neighborhood")).toContainText("research");

  await cleanup();
});

test("opens workspace settings from the sidebar", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
  });

  await expect(page.getByTestId("exo-side-panel")).not.toBeVisible();
  await expect(page.getByTestId("terminal-dock")).not.toBeVisible();
  await page.getByTestId("workspace-menu-button").click();
  await page.getByTestId("workspace-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  const settingsFrame = await page.getByTestId("workspace-settings-dialog").boundingBox();
  expect(settingsFrame).not.toBeNull();
  await expect(page.getByTestId("workspace-settings-note-roots")).toContainText("test-notes");
  await page.screenshot({ path: "/tmp/exo-workspace-settings-workspace.png", fullPage: false });
  await page.getByTestId("workspace-settings-tab-index").click();
  await expectStableOuterFrame(page.getByTestId("workspace-settings-dialog"), settingsFrame!);
  await expect(page.getByTestId("workspace-settings-index-mode")).toHaveValue("off");
  await expect(page.getByTestId("workspace-settings-dialog")).toContainText("Core search + QMD advanced provider");
  await page.screenshot({ path: "/tmp/exo-workspace-settings-index.png", fullPage: false });
  await page.getByTestId("workspace-settings-close").click();
  await expect(page.getByTestId("workspace-settings-dialog")).not.toBeVisible();
  await expect(page.getByTestId("terminal-dock")).not.toBeVisible();

  await cleanup();
});

test("keeps workspace settings frame stable across tabs", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    env: {
      EXO_INDEX_ENABLED: "0",
      EXO_INDEX_MODE: "off",
      EXO_INDEXED_ROOTS: "[]",
    },
  });

  await page.getByTestId("workspace-menu-button").click();
  await page.getByTestId("workspace-settings").click();
  await expect(page.getByTestId("workspace-settings-dialog")).toBeVisible();
  const settingsFrame = await page.getByTestId("workspace-settings-dialog").boundingBox();
  expect(settingsFrame).not.toBeNull();

  for (const section of ["index", "appearance", "terminal", "workspace"]) {
    await page.getByTestId(`workspace-settings-tab-${section}`).click();
    await expectStableOuterFrame(page.getByTestId("workspace-settings-dialog"), settingsFrame!);
  }

  await page.screenshot({ path: "/tmp/exo-issue-32-settings-tabs.png", fullPage: false });
  await cleanup();
});

test("keeps the command server available while the window is hidden", async () => {
  const { electronApp, page, runtimeRoot, cleanup } = await launchExoTerminalFixture({
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

  const serverInfo = JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number; token: string };
  const headers = { "x-exo-command-token": serverInfo.token };
  const unauthorizedStatus = await fetch(`http://127.0.0.1:${serverInfo.port}/status`);
  expect(unauthorizedStatus.status).toBe(401);
  const statusResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/status`, { headers });
  expect(statusResponse.ok).toBe(true);
  await expect(statusResponse.json()).resolves.toMatchObject({
    workspace: expect.objectContaining({ workspaceRoot: expect.any(String) }),
  });

  const terminals = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals`, { headers }).then((response) => response.json()) as Array<{ id: string; kind: string }>;
  const shell = terminals.find((terminal) => terminal.kind === "shell");
  expect(shell).toBeTruthy();
  const messageResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals/${shell!.id}/message`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hidden window qa", submit: true }),
  });
  expect(messageResponse.ok).toBe(true);
  await expect.poll(async () => {
    const tailResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/terminals/${shell!.id}/tail`, { headers });
    const body = await tailResponse.json() as { tail?: string };
    return body.tail ?? "";
  }).toContain("hidden window qa");

  const showResponse = await fetch(`http://127.0.0.1:${serverInfo.port}/show`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
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
  await expect(page.getByTestId("workspace-settings-tab-terminal")).toHaveClass(/settings-nav__button--active/);

  await cleanup();
});

test("supports CLI terminal control while the window is hidden", async () => {
  const { electronApp, runtimeRoot, workspaceRoot, cleanup } = await launchExoTerminalFixture({
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

    const terminals = runExoCli(["terminals", "list"], cliEnv);
    expect(terminals.status).toBe(0);

    const createdTerminal = runExoCli(["terminals", "create", "shell", workspaceRoot], cliEnv);
    expect(createdTerminal.status).toBe(0);
    const shellId = (JSON.parse(createdTerminal.stdout) as { id: string }).id;
    expect(shellId).toMatch(/^term-\d+$/);

    const cliMessage = `hidden cli qa ${Date.now()}`;
    const send = runExoCli(["terminals", "send", shellId!, cliMessage], cliEnv);
    expect(send.status).toBe(0);
    await expect.poll(() => runExoCli(["terminals", "read", shellId!, "--lines", "2000"], cliEnv).stdout).toContain(cliMessage);
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


test("switch workspace opens the workspace picker", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  await page.getByTestId("workspace-menu-button").click();
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
  const { page, cleanup } = await launchExoWorkspaceFixture({
    configured: false,
    cwd: "/",
    workspaceRootEnv: false,
    runtimeRootEnv: false,
  });

  await expect(page.getByTestId("onboarding")).toContainText("Open notes folder");
  await expect(page.getByTestId("workspace-picker")).toHaveCount(0);
  await expect(page.getByTestId("workspace-picker-open")).toHaveCount(0);
  await expect(page.getByTestId("onboarding")).toContainText("Default terminal");
  await expect(page.getByTestId("onboarding")).not.toContainText("Advanced search provider");
  await expect(page.getByTestId("onboarding-notes-folder")).toContainText("No notes folder selected.");
  await expect(page.getByTestId("onboarding-continue")).toBeDisabled();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);

  await cleanup();
});

test("shows first-run setup from a packaged-style launch without workspace env", async () => {
  const { page, cleanup, settingsPath } = await launchExoWorkspaceFixture({
    configured: false,
    cwd: "/",
    workspaceRootEnv: false,
    runtimeRootEnv: false,
  });

  await expect(page.getByTestId("onboarding")).toContainText("Open notes folder");
  await expect(page.getByTestId("workspace-picker-open")).toHaveCount(0);
  const model = await page.evaluate(() => window.exo.workspace.getModel());
  expect(model.workspaceRoot).not.toBe("/");
  expect(model.noteRoots).toEqual([]);
  expect(existsSync(settingsPath)).toBe(false);
  expect(existsSync(path.join(path.dirname(settingsPath), "onboarding-notes"))).toBe(false);

  await cleanup();
});

test("opens an existing notes folder from first-run setup", async () => {
  const fixtureWorkspaceRoot = path.join(repoRoot, "fixtures/test-workspace");
  const notesFolder = path.join(fixtureWorkspaceRoot, "notes/test-notes");
  const { page, cleanup, workspaceRoot } = await launchExoWorkspaceFixture({
    configured: false,
    cwd: "/",
    workspaceRootEnv: false,
    runtimeRootEnv: false,
    env: {
      EXO_TEST_SELECT_FOLDER_PATH: notesFolder,
    },
  });
  const expectedTerminalCwd = path.join(workspaceRoot, "notes");

  const firstRunFrame = await page.getByTestId("onboarding-card").boundingBox();
  expect(firstRunFrame).not.toBeNull();
  await page.getByTestId("onboarding-choose-notes").click();
  await expectStableOuterFrame(page.getByTestId("onboarding-card"), firstRunFrame!);
  await expect(page.getByTestId("onboarding-notes-folder")).toContainText(notesFolder);
  await expect(page.getByTestId("onboarding-terminal-folder")).toContainText(expectedTerminalCwd);

  await page.getByTestId("onboarding-continue").click();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await page.getByTestId("side-panel-toggle").click();
  await expect(page.getByTestId("side-panel-terminal-rail")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.exo.workspace.getSetupState()))
    .toMatchObject({
      complete: true,
      onboardingComplete: true,
      onboarding: {
        status: "complete",
        phase: "done",
      },
    });
  await expect.poll(async () => page.evaluate(() => window.exo.workspace.getSettings()))
    .toMatchObject({
      settings: {
        noteRoots: [notesFolder],
        defaultTerminalCwd: expectedTerminalCwd,
      },
    });

  await cleanup();
});

test("collapses and reopens the workspace explorer", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture();

  await page.getByTestId("sidebar-collapse").click();
  await expect(page.getByTestId("sidebar-expand")).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("button", { name: "focus-note" })).toHaveCount(0);
  const expandBox = await page.getByTestId("sidebar-expand").boundingBox();
  const tabBox = await page.locator(".tab-strip__tab").first().boundingBox();
  expect(expandBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(tabBox!.x).toBeGreaterThan(expandBox!.x + expandBox!.width + 12);

  await page.getByTestId("sidebar-expand").click();
  await expect(page.getByTestId("sidebar-collapse")).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("button", { name: "focus-note" })).toBeVisible();

  await cleanup();
});

test("shows the editor beside the right-side terminal surface", async () => {
  const { page, cleanup } = await launchExoTerminalFixture();

  await expect(page.locator(".pane-leaf--editor")).toBeVisible();
  await expect(page.locator(".exo-side-panel-surface .pane-leaf--terminal")).toBeVisible();
  await expect(page.locator(".workspace__body > .pane-split-resizer")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-shell")).toBeVisible();
  await expect(page.getByTestId("side-panel-terminal-rail")).toBeVisible();

  await cleanup();
});

test("accepts terminal keyboard input in pane tree", async () => {
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoTerminalFixture({
    env: {
      EXO_SHELL: process.execPath,
      EXO_SHELL_ARGS: '-e,process.stdout.write("── 🙂 terminal-border\\n"+"🙂".repeat(20000)+"\\nterminal-emoji-end\\n");process.stdin.resume()',
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
  const { page, cleanup } = await launchExoTerminalFixture({
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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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
  await expect.poll(cursorLocation).toMatchObject({ lineText: "  - today" });
  await expect.poll(async () => (await lineMetrics("today")).hasBullet).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(cursorLocation).toMatchObject({ lineText: "  - today" });
  await expect.poll(async () => (await lineMetrics("today")).hasBullet).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(cursorLocation).toMatchObject({ lineText: "  - today" });

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
  const { page, cleanup } = await launchExoWorkspaceFixture({
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
  const longFixture = await launchExoWorkspaceFixture({
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
