import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "fixtures/test-workspace");
const execFileAsync = promisify(execFile);
const mutableFixtureExcludedNames = new Set([
  ".exo",
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);

export function shouldCopyMutableFixturePath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(sourceRoot, sourcePath);
  if (!relativePath || relativePath === ".") {
    return true;
  }
  return !relativePath.split(path.sep).some((part) => mutableFixtureExcludedNames.has(part));
}

export async function copyMutableFixtureWorkspace(sourceRoot: string, targetRoot: string): Promise<void> {
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopyMutableFixturePath(sourceRoot, sourcePath),
  });
}

export async function launchExoFixture(options?: {
  mutable?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  prepareWorkspace?: (workspaceRoot: string) => Promise<void>;
  initialNoteLabel?: string | null;
  configured?: boolean;
  workspaceRootEnv?: boolean;
  runtimeRootEnv?: boolean;
}): Promise<{
  electronApp: ElectronApplication;
  page: Page;
  workspaceRoot: string;
  settingsPath: string;
  runtimeRoot: string;
  homeRoot: string;
  cleanup: () => Promise<void>;
}> {
  let workspaceRoot = fixtureRoot;
  let tempRoot: string | null = null;
  const settingsRoot = await mkdtemp(path.join(os.tmpdir(), "exo-settings-"));
  const settingsPath = path.join(settingsRoot, "workspace-settings.json");
  const userDataRoot = await mkdtemp(path.join(os.tmpdir(), "exo-userdata-"));
  const runtimeRoot = path.join(userDataRoot, "runtime");
  const homeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-home-"));
  if (options?.mutable || options?.prepareWorkspace) {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-fixture-"));
    workspaceRoot = path.join(tempRoot, "test-workspace");
    await copyMutableFixtureWorkspace(fixtureRoot, workspaceRoot);
  }

  if (options?.prepareWorkspace) {
    await options.prepareWorkspace(workspaceRoot);
  }

  const configured = options?.configured ?? true;
  const workspaceEnv = configured
    ? {
        EXO_NOTE_ROOTS: path.join(workspaceRoot, "notes/test-notes"),
        EXO_PROJECT_ROOTS: path.join(workspaceRoot, "projects/sample-project"),
      }
    : {};

  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    EXO_TEST: "1",
    EXO_WORKSPACE_ROOT: workspaceRoot,
    EXO_DEFAULT_TERMINAL_CWD: workspaceRoot,
    EXO_SETTINGS_PATH: settingsPath,
    EXO_USER_DATA_PATH: userDataRoot,
    EXO_RUNTIME_ROOT: runtimeRoot,
    EXO_FORCE_THEME: "dark",
    HOME: homeRoot,
    EXO_SHELL: "/bin/sh",
    EXO_SHELL_ARGS: "-lc,printf 'shell ready\\n'; cat",
    EXO_CLAUDE_COMMAND: "/bin/sh",
    EXO_CLAUDE_ARGS: "-lc,printf 'claude ready\\n'; cat",
    EXO_CODEX_COMMAND: "/bin/sh",
    EXO_CODEX_ARGS: "-lc,printf 'codex ready\\n'; cat",
    ...workspaceEnv,
    ...options?.env,
  };

  if (options?.workspaceRootEnv === false) {
    delete launchEnv.EXO_WORKSPACE_ROOT;
    delete launchEnv.EXO_DEFAULT_TERMINAL_CWD;
    delete launchEnv.EXO_NOTE_ROOTS;
    delete launchEnv.EXO_PROJECT_ROOTS;
  }
  if (options?.runtimeRootEnv === false) {
    delete launchEnv.EXO_RUNTIME_ROOT;
  }

  const electronApp = await electron.launch({
    args: [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: options?.cwd ?? repoRoot,
    env: launchEnv,
  });
  const page = electronApp.windows()[0] ?? await electronApp.firstWindow();
  if (!configured) {
    await expect(page.getByTestId("onboarding")).toBeVisible();
    return {
      electronApp,
      page,
      workspaceRoot,
      settingsPath,
      runtimeRoot,
      homeRoot,
      cleanup: async () => {
        await electronApp.close().catch(() => {});
        await cleanupFixtureTmuxSessions(runtimeRoot);
        await rm(settingsRoot, { recursive: true, force: true });
        await rm(userDataRoot, { recursive: true, force: true });
        await rm(homeRoot, { recursive: true, force: true });
        if (tempRoot) {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
    };
  }

  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-rail")).toBeVisible();
  if (options?.initialNoteLabel !== null) {
    const initialNoteLabel = options?.initialNoteLabel ?? "focus-note";
    const noteButton = page.getByRole("button", { name: initialNoteLabel });
    await noteButton.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await noteButton.count() > 0) {
      await noteButton.click();
      await expect(page.getByTestId("editor-title")).toHaveText(initialNoteLabel);
    }
  }

  return {
    electronApp,
    page,
    workspaceRoot,
    settingsPath,
    runtimeRoot,
    homeRoot,
    cleanup: async () => {
      await electronApp.close().catch(() => {});
      await cleanupFixtureTmuxSessions(runtimeRoot);
      await rm(settingsRoot, { recursive: true, force: true });
      await rm(userDataRoot, { recursive: true, force: true });
      await rm(homeRoot, { recursive: true, force: true });
      if (tempRoot) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

export async function relaunchExoFixture(
  previous: {
    workspaceRoot: string;
    settingsPath: string;
    runtimeRoot: string;
    homeRoot: string;
  },
  options?: {
    env?: Record<string, string>;
  },
): Promise<{
  electronApp: ElectronApplication;
  page: Page;
  cleanup: () => Promise<void>;
}> {
  const userDataRoot = path.dirname(previous.runtimeRoot);
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    EXO_TEST: "1",
    EXO_WORKSPACE_ROOT: previous.workspaceRoot,
    EXO_DEFAULT_TERMINAL_CWD: previous.workspaceRoot,
    EXO_SETTINGS_PATH: previous.settingsPath,
    EXO_USER_DATA_PATH: userDataRoot,
    EXO_RUNTIME_ROOT: previous.runtimeRoot,
    EXO_FORCE_THEME: "dark",
    HOME: previous.homeRoot,
    EXO_NOTE_ROOTS: path.join(previous.workspaceRoot, "notes/test-notes"),
    EXO_PROJECT_ROOTS: path.join(previous.workspaceRoot, "projects/sample-project"),
    EXO_SHELL: "/bin/sh",
    EXO_SHELL_ARGS: "-lc,printf 'shell ready\\n'; cat",
    EXO_CLAUDE_COMMAND: "/bin/sh",
    EXO_CLAUDE_ARGS: "-lc,printf 'claude ready\\n'; cat",
    EXO_CODEX_COMMAND: "/bin/sh",
    EXO_CODEX_ARGS: "-lc,printf 'codex ready\\n'; cat",
    ...options?.env,
  };

  const electronApp = await electron.launch({
    args: [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: repoRoot,
    env: launchEnv,
  });
  const page = electronApp.windows()[0] ?? await electronApp.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("editor-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-rail")).toBeVisible();

  return {
    electronApp,
    page,
    cleanup: async () => {
      await electronApp.close().catch(() => {});
      await cleanupFixtureTmuxSessions(previous.runtimeRoot);
      await rm(path.dirname(previous.settingsPath), { recursive: true, force: true });
      await rm(userDataRoot, { recursive: true, force: true });
      await rm(previous.homeRoot, { recursive: true, force: true });
    },
  };
}

async function cleanupFixtureTmuxSessions(runtimeRoot: string): Promise<void> {
  const registryPath = path.join(runtimeRoot, "terminal-sessions.json");
  let parsed: { sessions?: Array<{ tmuxSessionName?: unknown }> };
  try {
    parsed = JSON.parse(await readFile(registryPath, "utf8")) as typeof parsed;
  } catch {
    return;
  }

  const names = new Set(
    (parsed.sessions ?? [])
      .map((session) => session.tmuxSessionName)
      .filter((name): name is string => typeof name === "string" && name.startsWith("exo-")),
  );
  await Promise.all(
    Array.from(names).map((name) =>
      execFileAsync("tmux", ["kill-session", "-t", name]).catch(() => {
        // Tests may close after a terminal has already exited or after tmux is unavailable.
      }),
    ),
  );
}
