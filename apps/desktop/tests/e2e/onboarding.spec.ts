import { _electron as electron, expect, test } from "@playwright/test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDefaultClaudeAgentCommand,
  createDefaultCodexAgentCommand,
} from "@exo/core/default-agent-command";
import { saveWorkspaceSettings, type WorkspaceSettings } from "@exo/core";

import { launchExoWorkspaceFixture, relaunchExoWorkspaceFixture } from "../helpers";

const customClaudeCommand = "/bin/echo claude-clean-state";
const customCodexCommand = "/bin/echo codex-clean-state";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

for (const activeFileState of ["missing", "invalid"] as const) {
  test(`shows onboarding when active settings are ${activeFileState} and a registry Workspace survives`, async () => {
    const { page, cleanup } = await launchExoWorkspaceFixture({
      configured: false,
      cwd: "/",
      workspaceRootEnv: false,
      runtimeRootEnv: false,
      prepareSettings: async ({ settingsPath, userDataRoot, workspaceRoot }) => {
        await saveWorkspaceSettings(workspaceSettings(path.join(workspaceRoot, "notes", "test-notes")), {
          EXO_SETTINGS_PATH: settingsPath,
          EXO_USER_DATA_PATH: userDataRoot,
        });
        if (activeFileState === "missing") {
          await rm(settingsPath);
        } else {
          await writeFile(settingsPath, "{ invalid", "utf8");
        }
      },
    });

    await expect(page.getByTestId("onboarding")).toContainText("Choose a wiki");
    await expect(page.getByTestId("workspace-picker-item")).toHaveCount(1);
    await expect(page.getByTestId("sidebar")).toHaveCount(0);

    await cleanup();
  });
}

test("opens valid persisted settings without a fixture Workspace bypass", async () => {
  const { page, cleanup } = await launchExoWorkspaceFixture({
    configured: false,
    expectOnboarding: false,
    workspaceRootEnv: false,
    runtimeRootEnv: false,
    prepareSettings: async ({ settingsPath, userDataRoot, workspaceRoot }) => {
      await saveWorkspaceSettings(workspaceSettings(path.join(workspaceRoot, "notes", "test-notes")), {
        EXO_SETTINGS_PATH: settingsPath,
        EXO_USER_DATA_PATH: userDataRoot,
      });
    },
  });

  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.getByTestId("sidebar")).toBeVisible();

  await cleanup();
});

test("a cancelled folder choice leaves first-run state empty and writes nothing", async () => {
  const { page, cleanup, settingsPath } = await launchExoWorkspaceFixture({
    configured: false,
    cwd: "/",
    workspaceRootEnv: false,
    runtimeRootEnv: false,
    env: { EXO_TEST_SELECT_FOLDER_CANCEL: "1" },
  });

  await page.getByTestId("onboarding-choose-notes").click();

  await expect(page.getByTestId("onboarding-notes-folder")).toContainText("No main wiki selected.");
  await expect(page.getByTestId("onboarding-continue")).toBeDisabled();
  await expect(readOptional(settingsPath)).resolves.toBeNull();

  await cleanup();
});

test("keeps MCP and CLI setup independent without touching real provider state", async () => {
  const { page, cleanup, homeRoot } = await launchExoWorkspaceFixture({
    configured: false,
    mutable: true,
    workspaceRootEnv: false,
    runtimeRootEnv: false,
    env: { PATH: "/usr/bin:/bin" },
    selectFolderPath: (workspaceRoot) => path.join(workspaceRoot, "notes", "test-notes"),
    prepareHome: prepareFakeProviderHome,
  });

  await page.getByTestId("onboarding-choose-notes").click();
  await page.getByTestId("onboarding-continue").click();
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  await expect(page.getByText("MCP for tools. CLI for shells.")).toBeVisible();
  await expect(page.getByText("MCP setup never changes the CLI.")).toBeVisible();
  // CLI inspection is asynchronous; wait for the deliberately fake existing
  // command before taking the control snapshot for the MCP-isolation check.
  await expect(page.locator(".onboarding-cli-installation")).toContainText("Existing command kept");
  const cliStateBefore = await page.locator(".onboarding-cli-installation").innerText();

  await page.locator(".onboarding-provider-menu__item").filter({ hasText: "Codex" }).click();
  await page.getByRole("button", { name: "Install MCP" }).click();

  await expect(page.getByText("Added Exo MCP to Claude.")).toBeVisible();
  await expect.poll(() => readOptional(path.join(homeRoot, "claude-mcp.log"))).toContain("mcp\nadd\n--scope\nuser\nexo");
  expect(await page.locator(".onboarding-cli-installation").innerText()).toBe(cliStateBefore);

  await cleanup();
});

test("persists an explicit Note Root and edited recommended Commands across restart", async () => {
  const first = await launchExoWorkspaceFixture({
    configured: false,
    mutable: true,
    workspaceRootEnv: false,
    selectFolderPath: (workspaceRoot) => path.join(workspaceRoot, "notes", "test-notes"),
  });
  const selectedNoteRoot = path.join(first.workspaceRoot, "notes", "test-notes");

  await first.page.getByTestId("onboarding-choose-notes").click();
  await first.page.getByTestId("onboarding-continue").click();
  await first.page.getByRole("button", { name: "Set up CLI agents" }).click();
  const claudeInput = first.page.getByRole("textbox", { name: "Claude command" });
  const codexInput = first.page.getByRole("textbox", { name: "Codex command" });
  await expect(claudeInput).toHaveValue(/claude -p/);
  await expect(codexInput).toHaveValue(/codex exec/);
  expect((await claudeInput.boundingBox())?.width ?? 0).toBeGreaterThan(600);
  await claudeInput.fill(customClaudeCommand);
  await codexInput.fill(customCodexCommand);
  await first.page.getByRole("button", { name: "Open Exo" }).click();

  await expect(first.page.getByTestId("sidebar")).toBeVisible();
  const firstSettings = JSON.parse(await readFile(first.settingsPath, "utf8")) as WorkspaceSettings;
  expect(firstSettings.noteRoots).toEqual([selectedNoteRoot]);
  expect(firstSettings.agentCommands?.map((command) => command.command)).toEqual([customClaudeCommand, customCodexCommand]);
  await first.electronApp.close();

  const restarted = await relaunchExoWorkspaceFixture(first, {
    configured: false,
    workspaceRootEnv: false,
  });
  await expect(restarted.page.getByTestId("onboarding")).toHaveCount(0);
  await expect(restarted.page.getByTestId("sidebar")).toBeVisible();
  await expect.poll(async () => restarted.page.evaluate(() => window.exo.workspace.getSettings()))
    .toMatchObject({
      settings: {
        noteRoots: [selectedNoteRoot],
        agentCommands: [
          expect.objectContaining({ handle: "claude", command: customClaudeCommand }),
          expect.objectContaining({ handle: "codex", command: customCodexCommand }),
        ],
      },
    });

  await restarted.electronApp.close();
  await first.cleanup();
});

test("completes and restarts the real packaged first-run journey", async () => {
  const appBundle = process.env.EXO_PACKAGED_APP_PATH;
  test.skip(!appBundle, "Set EXO_PACKAGED_APP_PATH to a built Exo.app to run packaged first-run proof.");
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-packaged-onboarding-"));
  const userDataRoot = path.join(root, "user-data");
  const runtimeRoot = path.join(root, "runtime");
  const homeRoot = path.join(root, "home");
  const noteRoot = path.join(root, "wiki");
  const evidenceRoot = process.env.EXO_GATE_A_EVIDENCE_DIR
    ?? path.join(repoRoot, "artifacts", "gate-a-onboarding-package");
  await Promise.all([mkdir(userDataRoot, { recursive: true }), mkdir(runtimeRoot, { recursive: true }), mkdir(noteRoot, { recursive: true }), mkdir(evidenceRoot, { recursive: true })]);
  await writeFile(path.join(noteRoot, "welcome.md"), "# Welcome\n\nPackaged first-run fixture.\n", "utf8");
  await prepareFakeProviderHome(homeRoot);
  const executablePath = appBundle!.endsWith(".app")
    ? path.join(appBundle!, "Contents", "MacOS", "Exo")
    : appBundle!;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeRoot,
    PATH: "/usr/bin:/bin",
    EXO_TEST: "1",
    EXO_USER_DATA_PATH: userDataRoot,
    EXO_SETTINGS_PATH: path.join(userDataRoot, "workspace-settings.json"),
    EXO_RUNTIME_ROOT: runtimeRoot,
    EXO_TEST_SELECT_FOLDER_PATH: noteRoot,
    EXO_FORCE_THEME: "light",
  };

  let firstApp;
  let restartedApp;
  try {
    firstApp = await electron.launch({ executablePath, cwd: "/", env });
    const page = firstApp.windows()[0] ?? await firstApp.firstWindow();
    await expect(page.getByTestId("onboarding")).toContainText("Choose your main wiki");
    await page.screenshot({ path: path.join(evidenceRoot, "01-packaged-choose-wiki.png"), fullPage: true });
    await page.getByTestId("onboarding-choose-notes").click();
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
    await expect(page.locator(".onboarding-cli-installation")).not.toContainText("Contents/Resources");
    await page.screenshot({ path: path.join(evidenceRoot, "02-packaged-agent-access.png"), fullPage: true });
    await page.locator(".onboarding-provider-menu__item").filter({ hasText: "Codex" }).click();
    await page.getByRole("button", { name: "Install MCP" }).click();
    await expect(page.getByText("Added Exo MCP to Claude.")).toBeVisible();
    await expect.poll(() => readOptional(path.join(homeRoot, "claude-mcp.log"))).toContain("mcp\nadd\n--scope\nuser\nexo");
    await expect(readOptional(path.join(homeRoot, "codex-mcp.log"))).resolves.toBeNull();
    await page.getByRole("button", { name: "Set up CLI agents" }).click();
    await page.getByRole("textbox", { name: "Claude command" }).fill(customClaudeCommand);
    await page.getByRole("textbox", { name: "Codex command" }).fill(customCodexCommand);
    await page.screenshot({ path: path.join(evidenceRoot, "03-packaged-commands.png"), fullPage: true });
    await page.getByRole("button", { name: "Open Exo" }).click();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await page.screenshot({ path: path.join(evidenceRoot, "04-packaged-workspace.png"), fullPage: true });
    await firstApp.close();
    firstApp = undefined;

    restartedApp = await electron.launch({ executablePath, cwd: "/", env });
    const restartedPage = restartedApp.windows()[0] ?? await restartedApp.firstWindow();
    await expect(restartedPage.getByTestId("onboarding")).toHaveCount(0);
    await expect(restartedPage.getByTestId("sidebar")).toBeVisible();
    await expect.poll(async () => restartedPage.evaluate(() => window.exo.workspace.getSettings()))
      .toMatchObject({
        settings: {
          noteRoots: [noteRoot],
          agentCommands: [
            expect.objectContaining({ command: customClaudeCommand }),
            expect.objectContaining({ command: customCodexCommand }),
          ],
        },
      });
    await restartedPage.screenshot({ path: path.join(evidenceRoot, "05-packaged-restart.png"), fullPage: true });
  } finally {
    await restartedApp?.close().catch(() => undefined);
    await firstApp?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

function workspaceSettings(noteRoot: string): WorkspaceSettings {
  return {
    workspaceRoot: noteRoot,
    defaultTerminalCwd: path.dirname(noteRoot),
    noteRoots: [noteRoot],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    searchEngine: "filesystem",
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
    agentCommands: [createDefaultClaudeAgentCommand(), createDefaultCodexAgentCommand()],
  };
}

async function prepareFakeProviderHome(homeRoot: string): Promise<void> {
  const bin = path.join(homeRoot, ".local", "bin");
  await mkdir(bin, { recursive: true });
  await Promise.all([
    writeExecutable(path.join(bin, "exo"), "#!/bin/sh\nexit 0\n"),
    writeExecutable(path.join(bin, "claude"), "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/claude-mcp.log\"\n"),
    writeExecutable(path.join(bin, "codex"), "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/codex-mcp.log\"\n"),
  ]);
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
  await chmod(filePath, 0o755);
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
