import { app, nativeTheme } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createFolderWithIndex,
  DEFAULT_APPEARANCE_MODE,
  createWorkspaceFile,
  deleteWorkspacePath,
  listRootTree,
  emptyOnboardingStateStore,
  ensureFolderIndex,
  inspectFolderIndexes,
  markOnboardingComplete,
  markOnboardingWorkspaceBasicsSaved,
  readOnboardingStateStore,
  readWorkspaceDocument,
  renameWorkspacePath,
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  workspaceModelFromSettings,
  WorkspaceIndex,
  qmdSearchProvider,
  searchNotes,
  searchWorkspace,
  writeOnboardingStateStore,
  type OnboardingStateStore,
  type WorkspaceModel,
  type WorkspaceSettings,
  type WorkspaceSettingsSaveRequest,
} from "@exo/core";

import type { DesktopEventChannel, DesktopEventPayloads } from "../shared/desktop-ipc";
import type { WorkspaceSettingsSaveOutcome } from "../shared/api";
import { InvocationRunner } from "./invocation-runner";
import { AppLifecycleController } from "./app-lifecycle";
import { CommandServer } from "./command-server";
import { CommandServerLifecycle } from "./command-server-lifecycle";
import {
  commandServerDocumentReadContext,
  CommandServerDocumentReader,
} from "./command-server-document-reader";
import { IndexingService } from "./indexing-service";
import { WorkspaceConfigStore, workspaceSettingsFromModel } from "./workspace-config-store";
import { registerTerminalIpcHandlers } from "./terminal-ipc";
import { TerminalManager } from "./terminal-manager";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc";
import { resolvePreviewTarget } from "./preview-target";
import { WorkspaceNotesService } from "./workspace-notes-service";
import { WorkspaceWatcherService } from "./workspace-watchers";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceProjectRoot = resolveSourceProjectRoot();

if (process.env.EXO_ENABLE_GPU !== "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-zero-copy");
}

if (process.env.EXO_USER_DATA_PATH) {
  app.setPath("userData", process.env.EXO_USER_DATA_PATH);
}

process.on("uncaughtException", (error) => {
  logMain("uncaught exception", serializeError(error));
});

process.on("unhandledRejection", (reason) => {
  logMain("unhandled rejection", serializeError(reason));
});

let appLifecycle: AppLifecycleController;
let commandServerLifecycle: CommandServerLifecycle;
let workspaceModel: WorkspaceModel;
let workspaceSettings: WorkspaceSettings | null = null;
let workspaceSettingsRevision: string | null = null;
let workspaceConfig: WorkspaceConfigStore;
let workspaceSetupComplete = false;
let operatorWorkspaceSetupComplete = false;
let onboardingState: OnboardingStateStore = emptyOnboardingStateStore();
let onboardingRuntimeRoot: string | null = null;
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
let indexingService: IndexingService;
let workspaceNotesService: WorkspaceNotesService;
let invocationRunner: InvocationRunner;

const singleInstanceLock = app.requestSingleInstanceLock(resolveSingleInstanceData());

function workspaceIndex(): WorkspaceIndex {
  return new WorkspaceIndex({ context: { model: workspaceModel, runtimeRoot: resolveRuntimeRoot() } });
}

if (!singleInstanceLock) {
  console.error(
    "[exo] another Exo instance is already running; this dev process will exit after asking the running app to focus and refresh command-server discovery.",
  );
  app.quit();
}

function createCommandServer() {
  const runtimeRoot = resolveRuntimeRoot();
  const documentReader = new CommandServerDocumentReader({
    getContext: () => commandServerDocumentReadContext(workspaceModel),
    readDocument: (context, target, options, authorizeResolvedPath) =>
      qmdSearchProvider.readAuthorized(
        context.model,
        context.runtimeRoot,
        target,
        options,
        authorizeResolvedPath,
      ),
  });

  return new CommandServer({
    runtimeRoot,
    onShowWindow: () => appLifecycle.showMainWindow(),
    onOpenFile: (filePath: string) => {
      sendToRenderer("command:open-file", filePath);
    },
    onOpenPreview: async (target: string) => {
      const result = await resolvePreviewTarget(target, currentSettings());
      appLifecycle.showMainWindow();
      sendToRenderer("command:open-preview", { url: result.url });
      return result;
    },
    onFocusPreview: () => {
      appLifecycle.showMainWindow();
      sendToRenderer("command:focus-preview", undefined);
      return { ok: true };
    },
    onClosePreview: () => {
      sendToRenderer("command:close-preview", undefined);
      return { ok: true };
    },
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onIndexSearch: (query, options) => workspaceIndex().search(query, options),
    onReadDocument: (target, options) => documentReader.read(target, options),
    onIndexStatus: () => indexingService.getMeasuredStatus(),
    onIndexAddRoot: (input) => indexingService.addRoot(input),
    onIndexRemoveRoot: (target) => indexingService.removeRoot(target),
    onIndexSync: () => indexingService.runSync("command"),
    onListTerminals: () => terminalManager.list(),
    onCreateTerminal: (options) => terminalManager.create(options),
    onReadTerminalTail: (id: string, options?: { maxLines?: number }) => terminalManager.readTail(id, options),
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onSendTerminalMessage: (id: string, message: string, submit: boolean) => terminalManager.sendMessage(id, message, submit),
    onKillTerminal: (id: string) => terminalManager.kill(id),
    onGetSettings: () => currentSettings(),
    onGetStatus: () => ({
      workspace: workspaceModel,
      terminals: terminalManager.list(),
    }),
    onSpawnAgentCommand: async (input) => invocationRunner.authorizeAndStart(await invocationRunner.prepare({
      context: "cli", handle: input.handle, task: input.task, message: input.task,
    })),
  });
}

async function refreshCommandServerDiscovery(reason: string): Promise<void> {
  if (!commandServerLifecycle.status().listening) {
    console.warn(`[exo] command server was not listening during ${reason}; restarting it.`);
    logMain("command server discovery refresh restarting server", { reason });
    await commandServerLifecycle.restart();
    return;
  }

  try {
    const info = await commandServerLifecycle.refreshDiscovery();
    console.info(`[exo] command server discovery refreshed for ${reason}: ${info.path} (port ${info.port})`);
    logMain("command server discovery refreshed", { reason, path: info.path, port: info.port });
  } catch (error) {
    console.error(`[exo] failed to refresh command server discovery for ${reason}:`, error);
    logMain("command server discovery refresh failed", { reason, error: serializeError(error) });
  }
}

function resolveSingleInstanceData(): Record<string, string | number> {
  return {
    pid: process.pid,
    runtimeRoot: resolveRuntimeRoot(),
    workspaceRoot: resolveWorkspaceModel().workspaceRoot,
  };
}

function extractRuntimeRoot(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const runtimeRoot = (value as { runtimeRoot?: unknown }).runtimeRoot;
  return typeof runtimeRoot === "string" ? runtimeRoot : undefined;
}

function logWorkspaceStartup(model: WorkspaceModel) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const details = {
    workspaceRoot: model.workspaceRoot,
    defaultTerminalCwd: model.defaultTerminalCwd,
    noteRoots: model.noteRoots.map((root) => root.path),
    userDataPath: app.getPath("userData"),
    settingsPath: path.join(app.getPath("userData"), "workspace-settings.json"),
    gpuDisabled: process.env.EXO_ENABLE_GPU !== "1",
  };
  console.info("[exo] workspace startup", details);
  logMain("workspace startup", details);
}

function createFirstRunWorkspaceModel(): WorkspaceModel {
  const userDataRoot = app.getPath("userData");
  const homeRoot = app.getPath("home");

  return {
    workspaceRoot: userDataRoot,
    defaultTerminalCwd: homeRoot,
    noteRoots: [],
    indexedRoots: [],
    indexing: {
      enabled: false,
      mode: "off",
      backend: "qmd",
    },
  };
}

function broadcastTerminalData() {
  terminalManager.on("created", (session) => {
    sendToRenderer("terminal:created", session);
  });
  terminalManager.on("updated", (session) => {
    sendToRenderer("terminal:updated", session);
  });
  terminalManager.on("data", (event) => {
    sendToRenderer("terminal:data", event);
  });
  terminalManager.on("exit", (event) => {
    sendToRenderer("terminal:exit", event);
  });
}

function sendToRenderer<C extends DesktopEventChannel>(channel: C, payload: DesktopEventPayloads[C]) {
  const mainWindow = appLifecycle.getMainWindow();
  if (!appLifecycle.isRendererReady() || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  try {
    mainWindow.webContents.send(channel, payload);
  } catch (err) {
    console.warn(`[main] failed to send ${channel}:`, err);
  }
}

function logMain(message: string, details?: unknown) {
  const line = `${new Date().toISOString()} ${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}\n`;
  const logPath = path.join(app.getPath("userData"), "exo-main.log");
  appendFile(logPath, line, "utf8").catch(() => {});
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isForcedTheme(value: string | undefined): value is WorkspaceSettings["appearanceMode"] {
  return value === "light" || value === "dark" || value === "system";
}

function registerIpcHandlers() {
  registerWorkspaceIpcHandlers({
    activateWorkspace: async (input) => {
      return switchWorkspace(input.workspaceId, input.expectedRevision);
    },
    createFolder: createFolderWithIndex,
    createFile: createWorkspaceFile,
    deletePath: deleteWorkspacePath,
    embedIndex: () => indexingService.embed("settings"),
    ensureTarget: (sourceFilePath, target) => workspaceNotesService.ensureTarget(sourceFilePath, target),
    getIndexStatus: () => indexingService.getMeasuredStatus(),
    getFolderIndexStatus: () => inspectFolderIndexes(workspaceModel.noteRoots.map((root) => root.path)),
    getFolderOverview: (directoryPath) => workspaceNotesService.getFolderOverview(directoryPath),
    ensureFolderIndex,
    launchAgentInvocation: async (input) => invocationRunner.authorizeAndStart(await invocationRunner.prepare({
      context: "note", handle: input.handle, documentPath: input.documentPath,
      mentionText: input.mentionText, message: input.message,
      allowUntrustedOneShot: input.allowUntrustedOneShot, persistTrust: input.persistTrust,
    })),
    getAgentCommandTrust: (handle) => invocationRunner.getCommandTrust(handle),
    getAgentCommandLaunchFacts: (commandId) => invocationRunner.getCommandLaunchFacts(commandId),
    testAgentCommand: (input) => invocationRunner.testCommand(input.commandId, input.expectedFingerprint),
    endAgentInvocation: (invocationId) => invocationRunner.endObservation(invocationId),
    getGraphContext: (filePath) => workspaceNotesService.getGraphContext(filePath),
    getMainWindow: () => appLifecycle.getMainWindow(),
    getModel: () => workspaceModel,
    getSettings: async () => currentSnapshot(),
    getSetupState: async () => ({
      complete: workspaceSetupComplete,
      onboardingComplete: onboardingComplete(),
      onboarding: onboardingState,
      settingsPath: path.join(app.getPath("userData"), "workspace-settings.json"),
    }),
    markOnboardingComplete: () => completeWorkspaceOnboarding(),
    listTree: listRootTree,
    listWorkspaces: () => workspaceConfig.listWorkspaces(),
    readNote: readWorkspaceDocument,
    renamePath: renameWorkspacePath,
    resolvePreviewTarget: async (target) => {
      const result = await resolvePreviewTarget(target, currentSettings());
      return { url: result.url, source: result.source };
    },
    resolveTarget: (sourceFilePath, target) => workspaceNotesService.resolveTarget(sourceFilePath, target),
    saveNote: async (filePath, frontmatter, body) => {
      await saveWorkspaceDocument(filePath, frontmatter, body);
      indexingService.scheduleForFile(filePath, "note-save");
    },
    saveSettings,
    searchIndex: (query, options) => workspaceIndex().search(query, options),
    searchNotes: (query) => searchNotes(workspaceModel, query),
    searchTag: (tag) => workspaceNotesService.searchTag(tag),
    searchWorkspace: (query) => searchWorkspace(workspaceModel, query),
    statNote: async (filePath) => {
      try {
        const info = await stat(filePath);
        return { size: info.size, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    },
    suggestTargets: (sourceFilePath, query) => workspaceNotesService.suggestTargets(sourceFilePath, query),
    syncIndex: () => indexingService.runSync("settings"),
    updateIndex: () => indexingService.update("settings"),
  });
  registerTerminalIpcHandlers(terminalManager);
}

function onboardingComplete(): boolean {
  return onboardingState.status === "complete" || operatorWorkspaceSetupComplete;
}

async function writeWorkspaceOnboardingState(nextState: OnboardingStateStore): Promise<OnboardingStateStore> {
  onboardingState = nextState;
  await writeOnboardingStateStore(app.getPath("userData"), onboardingState);
  return onboardingState;
}

async function completeWorkspaceOnboarding(): Promise<OnboardingStateStore> {
  const base = onboardingState.workspaceBasicsSaved
    ? onboardingState
    : markOnboardingWorkspaceBasicsSaved(onboardingState);
  return writeWorkspaceOnboardingState(markOnboardingComplete(base));
}

function pluginDiscoveryEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EXO_PROJECT_ROOT: process.env.EXO_PROJECT_ROOT ?? sourceProjectRoot,
    EXO_USER_DATA_PATH: app.getPath("userData"),
  };
}

function resolveSourceProjectRoot(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  for (const candidate of [
    process.cwd(),
    ...(resourcesPath ? [resourcesPath] : []),
    path.resolve(currentDirectory, "../../.."),
    path.resolve(currentDirectory, "../../../.."),
  ]) {
    if (existsSync(path.join(candidate, "plugins"))) {
      return candidate;
    }
  }
  return undefined;
}

function applyWorkspaceSettings(settings: WorkspaceSettings | null) {
  if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
    nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
  }
}

function currentSettings(): WorkspaceSettings {
  return workspaceSettings ?? workspaceSettingsFromModel(workspaceModel);
}

function currentSnapshot() {
  return { settings: currentSettings(), revision: workspaceSettingsRevision };
}

async function saveSettings(request: WorkspaceSettingsSaveRequest): Promise<WorkspaceSettingsSaveOutcome> {
  const previous = currentSettings();
  const saved = await workspaceConfig.patch(request.expectedRevision, { ...previous, ...request.settings });
  workspaceSettings = saved.settings;
  workspaceSettingsRevision = saved.revision;
  workspaceSetupComplete = true;
  try {
    applyWorkspaceSettings(saved.settings);
    workspaceModel = workspaceModelFromSettings(saved.settings);
    await ensureNoteRoots(workspaceModel);
    workspaceWatcherService.start(workspaceModel);
    terminalManager.setDefaultCwd(workspaceModel.defaultTerminalCwd);
    if (indexingService.shouldSyncAfterSettingsApply(previous, saved.settings)) {
      indexingService.scheduleSync("settings-apply", 0);
    }
    return { ...saved, runtimeApply: { status: "applied" } };
  } catch (error) {
    return { ...saved, runtimeApply: { status: "failed", errorMessage: error instanceof Error ? error.message : String(error) } };
  }
}

async function switchWorkspace(workspaceId: string, expectedRevision: string | null): Promise<WorkspaceSettingsSaveOutcome> {
  const saved = await workspaceConfig.switchWorkspace(workspaceId, expectedRevision);
  workspaceSettings = saved.settings;
  workspaceSettingsRevision = saved.revision;
  workspaceModel = workspaceModelFromSettings(saved.settings);
  workspaceWatcherService.start(workspaceModel);
  terminalManager.setDefaultCwd(workspaceModel.defaultTerminalCwd);
  return { ...saved, runtimeApply: { status: "applied" } };
}

function applyOnboardingRuntimeEnv() {
  if (process.env.EXO_RUNTIME_ROOT) {
    return;
  }
  onboardingRuntimeRoot = path.join(app.getPath("userData"), "onboarding-runtime");
  process.env.EXO_RUNTIME_ROOT = onboardingRuntimeRoot;
}

app.whenReady().then(async () => {
  workspaceConfig = new WorkspaceConfigStore({ userDataPath: app.getPath("userData") });
  workspaceWatcherService = new WorkspaceWatcherService((event) => {
    sendToRenderer("workspace:changed", event);
  });

  const forcedTheme = process.env.EXO_FORCE_THEME;
  if (isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = forcedTheme;
  }

  operatorWorkspaceSetupComplete = Boolean(process.env.EXO_NOTE_ROOTS);
  const loadedWorkspaceSettings = await workspaceConfig.load();
  workspaceSettings = loadedWorkspaceSettings?.settings ?? null;
  workspaceSettingsRevision = loadedWorkspaceSettings?.revision ?? null;
  onboardingState = await readOnboardingStateStore(app.getPath("userData"));
  if (workspaceSettings) {
    applyWorkspaceSettings(workspaceSettings);
  }
  workspaceSetupComplete = workspaceSettings !== null || operatorWorkspaceSetupComplete;
  workspaceModel = workspaceSettings ? workspaceModelFromSettings(workspaceSettings) : workspaceSetupComplete ? resolveWorkspaceModel() : createFirstRunWorkspaceModel();
  if (workspaceSetupComplete) {
    applyWorkspaceSettings(workspaceSettings ?? workspaceSettingsFromModel(workspaceModel));
  } else {
    applyOnboardingRuntimeEnv();
    applyWorkspaceSettings(null);
  }
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  if (workspaceSetupComplete) {
    await ensureNoteRoots(workspaceModel);
    const savedWorkspaceSettings = await workspaceConfig.patch(loadedWorkspaceSettings?.revision ?? null, workspaceSettings ?? workspaceSettingsFromModel(workspaceModel));
    workspaceSettings = savedWorkspaceSettings.settings;
    workspaceSettingsRevision = savedWorkspaceSettings.revision;
  }
  logWorkspaceStartup(workspaceModel);
  terminalManager = new TerminalManager(
    workspaceModel.defaultTerminalCwd,
  );
  indexingService = new IndexingService({
    getWorkspaceModel: () => workspaceModel,
    getCurrentSettings: () => currentSettings(),
    getRuntimeRoot: () => resolveRuntimeRoot(),
    saveWorkspaceSettings: async (settings) => {
      const saved = await saveSettings({
        settings,
        expectedRevision: (await currentSnapshot()).revision,
      });
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      return saved.settings;
    },
    sendState: (event) => sendToRenderer("workspace:index-sync-state", event),
    errorMessage,
  });
  invocationRunner = new InvocationRunner({
    trustStateRoot: app.getPath("userData"),
    workspaceWatcherService,
    terminalManager,
    getWorkspaceSettings: () => currentSettings(),
  });
  invocationRunner.on("updated", (record) => {
    sendToRenderer("workspace:invocation-updated", record);
  });
  void invocationRunner.markOrphanedRunningInvocations().catch((error) => {
    console.warn("[exo] failed to mark orphaned invocations", error);
  });
  workspaceNotesService = new WorkspaceNotesService({
    getWorkspaceModel: () => workspaceModel,
  });
  commandServerLifecycle = new CommandServerLifecycle({
    runtimeRoot: resolveRuntimeRoot(),
    createServer: createCommandServer,
    log: logMain,
  });
  appLifecycle = new AppLifecycleController({
    currentDirectory,
    getTerminals: () => terminalManager?.list() ?? [],
    getCommandServerStatus: () => commandServerLifecycle.status(),
    openSettings: () => {
      sendToRenderer("command:open-settings", { section: "workspace" });
    },
    restartCommandServer: () => void commandServerLifecycle.restart(),
    logMain,
  });
  registerIpcHandlers();
  broadcastTerminalData();
  workspaceWatcherService.start(workspaceModel);
  appLifecycle.createWindow();
  appLifecycle.setupTray();
  void commandServerLifecycle.start().catch((error) => {
    console.error("Failed to start command server:", error);
    logMain("command server start failed", serializeError(error));
  });

  nativeTheme.on("updated", () => {
    appLifecycle.updateBackgroundForTheme();
  });


  app.on("activate", () => {
    appLifecycle.activate();
  });

  app.on("second-instance", (_event, _commandLine, workingDirectory, additionalData) => {
    logMain("second instance requested focus", {
      workingDirectory,
      requestedRuntimeRoot: extractRuntimeRoot(additionalData),
    });
    void refreshCommandServerDiscovery("second-instance");
    appLifecycle.showMainWindow();
  });
});

async function ensureNoteRoots(model: WorkspaceModel): Promise<void> {
  await Promise.all(model.noteRoots.map((root) => mkdir(root.path, { recursive: true })));
}

function resolveRuntimeRoot(): string {
  if (process.env.EXO_RUNTIME_ROOT) {
    return process.env.EXO_RUNTIME_ROOT;
  }

  // Settings own the active workspace after startup. Falling back to the launch
  // directory here made packaged Exo derive `/.exo`, because Electron launches
  // the app from `/` rather than from the user's workspace.
  const workspaceRoot = workspaceSettings?.workspaceRoot ?? workspaceModel?.workspaceRoot ?? resolveWorkspaceModel().workspaceRoot;
  return path.join(workspaceRoot, ".exo");
}

app.on("before-quit", () => {
  appLifecycle?.prepareToQuit();
  void commandServerLifecycle?.stop();
  workspaceWatcherService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
