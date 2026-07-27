import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = path.join(repoRoot, "fixtures/test-workspace");
const mutableFixtureExcludedNames = new Set([
  ".stem",
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

interface LaunchStemFixtureOptions {
  mutable?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  prepareWorkspace?: (workspaceRoot: string) => Promise<void>;
  prepareHome?: (homeRoot: string) => Promise<void>;
  selectFolderPath?: (workspaceRoot: string) => string;
  initialNoteLabel?: string | null;
  configured?: boolean;
  workspaceRootEnv?: boolean;
  runtimeRootEnv?: boolean;
  expectOnboarding?: boolean;
  stripEnvironment?: readonly string[];
  prepareSettings?: (input: { settingsPath: string; userDataRoot: string; workspaceRoot: string }) => Promise<void>;
}

interface StemFixture {
  electronApp: ElectronApplication;
  page: Page;
  workspaceRoot: string;
  settingsPath: string;
  runtimeRoot: string;
  homeRoot: string;
  cleanup: () => Promise<void>;
}

export function launchStemTerminalFixture(options?: LaunchStemFixtureOptions): Promise<StemFixture> {
  return launchStemFixtureForJourney(options, true);
}

export function launchStemWorkspaceFixture(options?: LaunchStemFixtureOptions): Promise<StemFixture> {
  return launchStemFixtureForJourney(options, false);
}

async function launchStemFixtureForJourney(
  options: LaunchStemFixtureOptions | undefined,
  openTerminalSurface: boolean,
): Promise<StemFixture> {
  let workspaceRoot = fixtureRoot;
  let tempRoot: string | null = null;
  const settingsRoot = await mkdtemp(path.join(os.tmpdir(), "stem-settings-"));
  const settingsPath = path.join(settingsRoot, "workspace-settings.json");
  const userDataRoot = await mkdtemp(path.join(os.tmpdir(), "stem-userdata-"));
  const runtimeRoot = path.join(userDataRoot, "runtime");
  const homeRoot = await mkdtemp(path.join(os.tmpdir(), "stem-home-"));
  if (options?.prepareHome) {
    await options.prepareHome(homeRoot);
  }
  if (options?.mutable || options?.prepareWorkspace) {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "stem-fixture-"));
    workspaceRoot = path.join(tempRoot, "test-workspace");
    await copyMutableFixtureWorkspace(fixtureRoot, workspaceRoot);
  }

  if (options?.prepareWorkspace) {
    await options.prepareWorkspace(workspaceRoot);
  }

  if (options?.prepareSettings) {
    await options.prepareSettings({ settingsPath, userDataRoot, workspaceRoot });
  }

  const configured = options?.configured ?? true;
  const workspaceEnv = configured
    ? {
        STEM_NOTE_ROOTS: path.join(workspaceRoot, "notes/test-notes"),
      }
    : {};

  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    STEM_TEST: "1",
    STEM_WORKSPACE_ROOT: workspaceRoot,
    STEM_DEFAULT_TERMINAL_CWD: workspaceRoot,
    STEM_SETTINGS_PATH: settingsPath,
    STEM_USER_DATA_PATH: userDataRoot,
    STEM_RUNTIME_ROOT: runtimeRoot,
    STEM_FORCE_THEME: "dark",
    HOME: homeRoot,
    STEM_SHELL: "/bin/sh",
    STEM_SHELL_ARGS: "-lc,printf 'shell ready\\n'; cat",
    ...(options?.selectFolderPath ? { STEM_TEST_SELECT_FOLDER_PATH: options.selectFolderPath(workspaceRoot) } : {}),
    ...workspaceEnv,
    ...options?.env,
  };
  for (const name of options?.stripEnvironment ?? []) delete launchEnv[name];

  if (options?.workspaceRootEnv === false) {
    delete launchEnv.STEM_WORKSPACE_ROOT;
    delete launchEnv.STEM_DEFAULT_TERMINAL_CWD;
    delete launchEnv.STEM_NOTE_ROOTS;
  }
  if (options?.runtimeRootEnv === false) {
    delete launchEnv.STEM_RUNTIME_ROOT;
  }

  const packagedAppPath = packagedExecutablePath(process.env.STEM_PACKAGED_APP_PATH);
  const electronApp = await electron.launch({
    ...(packagedAppPath ? { executablePath: packagedAppPath } : {}),
    args: packagedAppPath ? [] : [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: options?.cwd ?? repoRoot,
    env: launchEnv,
  });
  const page = electronApp.windows()[0] ?? await electronApp.firstWindow();
  if (!configured && options?.expectOnboarding !== false) {
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
  await expect(page.locator('[data-testid="editor-panel"], [data-testid="editor-empty"]')).toBeVisible();
  if (openTerminalSurface) {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-terminal").click();
    await expect(page.getByTestId("terminal-dock").first()).toBeVisible();
    await page.getByTestId("new-terminal").click();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
  }
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
      await rm(settingsRoot, { recursive: true, force: true });
      await rm(userDataRoot, { recursive: true, force: true });
      await rm(homeRoot, { recursive: true, force: true });
      if (tempRoot) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}

interface RelaunchStemFixtureInput {
  workspaceRoot: string;
  settingsPath: string;
  runtimeRoot: string;
  homeRoot: string;
}

interface RelaunchStemFixtureOptions {
  env?: Record<string, string>;
  cwd?: string;
  configured?: boolean;
  workspaceRootEnv?: boolean;
  runtimeRootEnv?: boolean;
  expectOnboarding?: boolean;
  stripEnvironment?: readonly string[];
}

interface RelaunchedStemFixture {
  electronApp: ElectronApplication;
  page: Page;
  cleanup: () => Promise<void>;
}

export function relaunchStemTerminalFixture(
  previous: RelaunchStemFixtureInput,
  options?: RelaunchStemFixtureOptions,
): Promise<RelaunchedStemFixture> {
  return relaunchStemFixtureForJourney(previous, options, true);
}

export function relaunchStemWorkspaceFixture(
  previous: RelaunchStemFixtureInput,
  options?: RelaunchStemFixtureOptions,
): Promise<RelaunchedStemFixture> {
  return relaunchStemFixtureForJourney(previous, options, false);
}

async function relaunchStemFixtureForJourney(
  previous: RelaunchStemFixtureInput,
  options: RelaunchStemFixtureOptions | undefined,
  openTerminalSurface: boolean,
): Promise<RelaunchedStemFixture> {
  const userDataRoot = path.dirname(previous.runtimeRoot);
  const configured = options?.configured ?? true;
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    STEM_TEST: "1",
    STEM_WORKSPACE_ROOT: previous.workspaceRoot,
    STEM_DEFAULT_TERMINAL_CWD: previous.workspaceRoot,
    STEM_SETTINGS_PATH: previous.settingsPath,
    STEM_USER_DATA_PATH: userDataRoot,
    STEM_RUNTIME_ROOT: previous.runtimeRoot,
    STEM_FORCE_THEME: "dark",
    HOME: previous.homeRoot,
    ...(configured ? {
      STEM_NOTE_ROOTS: path.join(previous.workspaceRoot, "notes/test-notes"),
    } : {}),
    STEM_SHELL: "/bin/sh",
    STEM_SHELL_ARGS: "-lc,printf 'shell ready\\n'; cat",
    ...options?.env,
  };
  for (const name of options?.stripEnvironment ?? []) delete launchEnv[name];

  if (options?.workspaceRootEnv === false) {
    delete launchEnv.STEM_WORKSPACE_ROOT;
    delete launchEnv.STEM_DEFAULT_TERMINAL_CWD;
    delete launchEnv.STEM_NOTE_ROOTS;
  }
  if (options?.runtimeRootEnv === false) {
    delete launchEnv.STEM_RUNTIME_ROOT;
  }

  const packagedAppPath = packagedExecutablePath(process.env.STEM_PACKAGED_APP_PATH);
  const electronApp = await electron.launch({
    ...(packagedAppPath ? { executablePath: packagedAppPath } : {}),
    args: packagedAppPath ? [] : [path.join(repoRoot, "apps/desktop/dist/main/index.js")],
    cwd: options?.cwd ?? repoRoot,
    env: launchEnv,
  });
  const page = electronApp.windows()[0] ?? await electronApp.firstWindow();
  if (options?.expectOnboarding) {
    await expect(page.getByTestId("onboarding")).toBeVisible();
    return {
      electronApp,
      page,
      cleanup: async () => {
        await electronApp.close().catch(() => {});
        await rm(path.dirname(previous.settingsPath), { recursive: true, force: true });
        await rm(userDataRoot, { recursive: true, force: true });
        await rm(previous.homeRoot, { recursive: true, force: true });
      },
    };
  }
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.locator('[data-testid="editor-panel"], [data-testid="editor-empty"]')).toBeVisible();
  if (openTerminalSurface) {
    await page.getByTestId("utility-pane-toggle").click();
    await page.getByTestId("utility-pane-terminal").click();
    await expect(page.getByTestId("terminal-dock").first()).toBeVisible();
    await page.getByTestId("new-terminal").click();
    await expect(page.getByTestId("terminal-tab-shell")).toHaveCount(1);
  }

  return {
    electronApp,
    page,
    cleanup: async () => {
      await electronApp.close().catch(() => {});
      await rm(path.dirname(previous.settingsPath), { recursive: true, force: true });
      await rm(userDataRoot, { recursive: true, force: true });
      await rm(previous.homeRoot, { recursive: true, force: true });
    },
  };
}

function packagedExecutablePath(appPath: string | undefined): string | undefined {
  return appPath?.endsWith(".app")
    ? path.join(appPath, "Contents", "MacOS", "Stem")
    : appPath;
}
