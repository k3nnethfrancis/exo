import { app, nativeTheme } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createBranchFile,
  deleteWorkspacePath,
  listRootTree,
  readAuthorizedIndexDocument,
  emptyOnboardingStateStore,
  markOnboardingComplete,
  markOnboardingWorkspaceBasicsSaved,
  readOnboardingStateStore,
  readWorkspaceDocument,
  renameWorkspacePath,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  searchIndex,
  searchNotes,
  searchWorkspace,
  SemanticTraceStore,
  semanticTraceEventsToAgentAnswerText,
  writeOnboardingStateStore,
  type OnboardingStateStore,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import type { DesktopEventChannel, DesktopEventPayloads } from "../shared/desktop-ipc";
import { AgentInstructionsService } from "./agent-instructions-service";
import { AgentCommandInvocationService } from "./agent-command-invocation-service";
import { AppLifecycleController } from "./app-lifecycle";
import { CommandServer } from "./command-server";
import {
  commandServerDocumentReadContext,
  CommandServerDocumentReader,
} from "./command-server-document-reader";
import { IndexingService } from "./indexing-service";
import { InvocationObservationService } from "./invocation-observation-service";
import {
  applyWorkspaceSettingsToEnv,
  DEFAULT_APPEARANCE_MODE,
  isForcedTheme,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "./settings-store";
import { registerTerminalIpcHandlers } from "./terminal-ipc";
import { TerminalManager } from "./terminal-manager";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc";
import { resolvePreviewTarget } from "./preview-target";
import { WorkspaceNotesService } from "./workspace-notes-service";
import { WorkspaceSettingsService } from "./workspace-settings-service";
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

const singleInstanceLock = app.requestSingleInstanceLock(resolveSingleInstanceData());

let appLifecycle: AppLifecycleController;
let commandServer: CommandServer | null = null;
let workspaceModel: WorkspaceModel;
let workspaceSettings: WorkspaceSettings | null = null;
let workspaceSettingsStore: WorkspaceSettingsStore;
let workspaceSetupComplete = false;
let operatorWorkspaceSetupComplete = false;
let onboardingState: OnboardingStateStore = emptyOnboardingStateStore();
let onboardingRuntimeRoot: string | null = null;
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
let indexingService: IndexingService;
let workspaceNotesService: WorkspaceNotesService;
let agentInstructionsService: AgentInstructionsService;
let workspaceSettingsService: WorkspaceSettingsService;
let invocationObservationService: InvocationObservationService;

if (!singleInstanceLock) {
  console.error(
    "[exo] another Exo instance is already running; this dev process will exit after asking the running app to focus and refresh command-server discovery.",
  );
  app.quit();
}

function startCommandServer() {
  const runtimeConfig = resolveRuntimeConfig();
  const documentReader = new CommandServerDocumentReader({
    getContext: () => commandServerDocumentReadContext(workspaceModel),
    readDocument: (context, target, options, authorizeResolvedPath) =>
      readAuthorizedIndexDocument(
        context.model,
        context.runtimeRoot,
        target,
        options,
        authorizeResolvedPath,
      ),
  });

  commandServer?.stop();
  const nextCommandServer = new CommandServer({
    runtimeRoot: runtimeConfig.runtimeRoot,
    onShowWindow: () => appLifecycle.showMainWindow(),
    onOpenFile: (filePath: string) => {
      sendToRenderer("command:open-file", filePath);
    },
    onOpenPreview: async (target: string) => {
      const result = await resolvePreviewTarget(target, workspaceSettingsService.currentSettings());
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
    onIndexSearch: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    onReadDocument: (target, options) => documentReader.read(target, options),
    onIndexStatus: () => indexingService.getMeasuredStatus(),
    onIndexAddRoot: (input) => indexingService.addRoot(input),
    onIndexRemoveRoot: (target) => indexingService.removeRoot(target),
    onIndexSync: () => indexingService.runSync("command"),
    onIndexUpdate: () => indexingService.update("command"),
    onIndexEmbed: () => indexingService.embed("command"),
    onListTerminals: () => terminalManager.list(),
    onTerminalDiagnostics: () => terminalManager.diagnostics(),
    onCreateTerminal: (options) => terminalManager.create(options),
    onReadTerminalTail: (id: string, options?: { maxLines?: number }) => terminalManager.readTail(id, options),
    onReadTerminalTranscript: (id: string, tailChars: number) => terminalManager.readTranscript(id, tailChars),
    onReadTerminalSemanticAnswer: async (id: string, options?: { limit?: number }) => {
      const events = await new SemanticTraceStore(runtimeConfig.runtimeRoot).readEvents(id, { limit: options?.limit ?? 100 });
      return events.length === 0 ? null : semanticTraceEventsToAgentAnswerText(events);
    },
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onSendTerminalMessage: (id: string, message: string, submit: boolean) => terminalManager.sendMessage(id, message, submit),
    onKillTerminal: (id: string) => terminalManager.kill(id),
    onGetSettings: () => workspaceSettingsService.currentSettings(),
    onGetStatus: () => ({
      workspace: workspaceModel,
      terminals: terminalManager.list(),
    }),
    onSpawnAgentCommand: (input) =>
      new AgentCommandInvocationService({
        getWorkspaceSettings: () => workspaceSettingsService.currentSettings(),
        trustStateRoot: app.getPath("userData"),
        terminalManager,
        observationService: invocationObservationService,
      }).spawnFromCli(input),
  });
  commandServer = nextCommandServer;

  nextCommandServer.start().then((port) => {
    logMain("command server started", { runtimeRoot: runtimeConfig.runtimeRoot, port });
  }).catch((error) => {
    if (commandServer === nextCommandServer) {
      commandServer = null;
    }
    console.error("Failed to start command server:", error);
    logMain("command server start failed", serializeError(error));
  });
}

async function refreshCommandServerDiscovery(reason: string): Promise<void> {
  if (!commandServer?.isListening()) {
    console.warn(`[exo] command server was not listening during ${reason}; restarting it.`);
    logMain("command server discovery refresh restarting server", { reason });
    startCommandServer();
    return;
  }

  try {
    const info = await commandServer.ensureDiscoveryFile();
    console.info(`[exo] command server discovery refreshed for ${reason}: ${info.path} (port ${info.port})`);
    logMain("command server discovery refreshed", { reason, path: info.path, port: info.port });
  } catch (error) {
    console.error(`[exo] failed to refresh command server discovery for ${reason}:`, error);
    logMain("command server discovery refresh failed", { reason, error: serializeError(error) });
  }
}

function resolveSingleInstanceData(): Record<string, string | number> {
  const runtimeConfig = resolveRuntimeConfig();
  return {
    pid: process.pid,
    runtimeRoot: runtimeConfig.runtimeRoot,
    workspaceRoot: runtimeConfig.workspace.workspaceRoot,
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
    projectRoots: model.projectRoots.map((root) => root.path),
    userDataPath: app.getPath("userData"),
    settingsPath: workspaceSettingsStore.resolvePath(),
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
    projectRoots: [],
    indexedRoots: [],
    indexing: {
      enabled: false,
      mode: "off",
      backend: "qmd",
    },
    attachedWorkcells: [],
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

function registerIpcHandlers() {
  registerWorkspaceIpcHandlers({
    activateWorkspace: async (input) => {
      const entry = await workspaceSettingsStore.getWorkspace(input.workspaceId);
      if (!entry) {
        throw new Error("Workspace not found.");
      }
      return workspaceSettingsService.saveSettings({
        settings: entry.settings,
        expectedRevision: input.expectedRevision,
      });
    },
    createBranch: (filePath, frontmatter, body) =>
      createBranchFile(
        filePath,
        {
          filePath,
          title: typeof frontmatter.title === "string" ? frontmatter.title : path.basename(filePath, path.extname(filePath)),
          frontmatter,
          body,
          kind: "markdown",
        },
        workspaceModel.noteRoots.map((root) => root.path),
      ),
    createDirectory: createWorkspaceDirectory,
    createFile: createWorkspaceFile,
    deletePath: deleteWorkspacePath,
    embedIndex: () => indexingService.embed("settings"),
    ensureTarget: (sourceFilePath, target) => workspaceNotesService.ensureTarget(sourceFilePath, target),
    getAgentInstructionConfig: () => agentInstructionsService.getConfig(),
    getBranchFamily: (filePath) => workspaceNotesService.getBranchFamily(filePath),
    getIndexStatus: () => indexingService.getMeasuredStatus(),
    launchAgentInvocation: (input) =>
      new AgentCommandInvocationService({
        getWorkspaceSettings: () => workspaceSettingsService.currentSettings(),
        trustStateRoot: app.getPath("userData"),
        terminalManager,
        observationService: invocationObservationService,
      }).launchNoteInvocation(input),
    endAgentInvocation: (invocationId) => invocationObservationService.endObservation(invocationId),
    getKnowledge: (filePath) => workspaceNotesService.getKnowledge(filePath),
    getMainWindow: () => appLifecycle.getMainWindow(),
    getModel: () => workspaceModel,
    getRuntimeStatus: () => terminalManager.getRuntimeConfig(),
    getSettings: async () => workspaceSettingsService.currentSnapshot(),
    getSetupState: async () => ({
      complete: workspaceSetupComplete,
      onboardingComplete: onboardingComplete(),
      onboarding: onboardingState,
      settingsPath: workspaceSettingsStore.resolvePath(),
    }),
    markOnboardingComplete: () => completeWorkspaceOnboarding(),
    listAgentInstructionOverlays: () => agentInstructionsService.listOverlays(),
    listTree: listRootTree,
    listWorkspaces: () => workspaceSettingsStore.listWorkspaces(workspaceSettings),
    readNote: readWorkspaceDocument,
    renamePath: renameWorkspacePath,
    resolvePreviewTarget: async (target) => {
      const result = await resolvePreviewTarget(target, workspaceSettingsService.currentSettings());
      return { url: result.url, source: result.source };
    },
    resolveTarget: (sourceFilePath, target) => workspaceNotesService.resolveTarget(sourceFilePath, target),
    saveAgentInstructionConfig: (input) => agentInstructionsService.saveConfig(input),
    syncAgentInstructionFilesFromProvider: (input) => agentInstructionsService.syncFromProviderFile(input),
    applyGlobalExographContext: (input) => agentInstructionsService.applyGlobalExographContext(input),
    saveNote: async (filePath, frontmatter, body) => {
      await saveWorkspaceDocument(filePath, frontmatter, body);
      indexingService.scheduleForFile(filePath, "note-save");
    },
    saveSettings: (request) => workspaceSettingsService.saveSettings(request),
    searchIndex: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
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
    syncRuntime: () => terminalManager.syncRuntimeContext(),
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
  if (settings && onboardingRuntimeRoot && process.env.EXO_RUNTIME_ROOT === onboardingRuntimeRoot) {
    delete process.env.EXO_RUNTIME_ROOT;
    onboardingRuntimeRoot = null;
  }
  applyWorkspaceSettingsToEnv(settings);
  if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
    nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
  }
}

function applyOnboardingRuntimeEnv() {
  if (process.env.EXO_RUNTIME_ROOT) {
    return;
  }
  onboardingRuntimeRoot = path.join(app.getPath("userData"), "onboarding-runtime");
  process.env.EXO_RUNTIME_ROOT = onboardingRuntimeRoot;
}

app.whenReady().then(async () => {
  workspaceSettingsStore = new WorkspaceSettingsStore({ userDataPath: app.getPath("userData") });
  workspaceWatcherService = new WorkspaceWatcherService((event) => {
    sendToRenderer("workspace:changed", event);
  });

  const forcedTheme = process.env.EXO_FORCE_THEME;
  if (isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = forcedTheme;
  }

  operatorWorkspaceSetupComplete = Boolean(process.env.EXO_NOTE_ROOTS);
  const loadedWorkspaceSettings = await workspaceSettingsStore.load();
  workspaceSettings = loadedWorkspaceSettings?.settings ?? null;
  onboardingState = await readOnboardingStateStore(app.getPath("userData"));
  if (workspaceSettings) {
    applyWorkspaceSettings(workspaceSettings);
  }
  workspaceSetupComplete = workspaceSettings !== null || operatorWorkspaceSetupComplete;
  workspaceModel = workspaceSetupComplete ? resolveWorkspaceModel() : createFirstRunWorkspaceModel();
  if (workspaceSetupComplete) {
    applyWorkspaceSettings(workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel));
  } else {
    applyOnboardingRuntimeEnv();
    applyWorkspaceSettings(null);
  }
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  if (workspaceSetupComplete) {
    await ensureNoteRoots(workspaceModel);
    const savedWorkspaceSettings = await workspaceSettingsStore.save({
      settings: workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel),
      expectedRevision: loadedWorkspaceSettings?.revision ?? null,
    });
    workspaceSettings = savedWorkspaceSettings.settings;
  }
  logWorkspaceStartup(workspaceModel);
  const terminalPolicy = resolveTerminalRuntimePolicy(workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel));
  terminalManager = new TerminalManager(
    workspaceModel.defaultTerminalCwd,
    terminalPolicy.bufferLineLimit,
    terminalPolicy.transcriptRetentionDays,
    terminalPolicy,
  );
  indexingService = new IndexingService({
    getWorkspaceModel: () => workspaceModel,
    getCurrentSettings: () => workspaceSettingsService.currentSettings(),
    getRuntimeRoot: () => resolveRuntimeConfig().runtimeRoot,
    saveWorkspaceSettings: async (settings) => {
      const saved = await workspaceSettingsService.saveSettings({
        settings,
        expectedRevision: workspaceSettingsService.currentSnapshot().revision,
      });
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      return saved.settings;
    },
    sendState: (event) => sendToRenderer("workspace:index-sync-state", event),
    errorMessage,
  });
  workspaceSettingsService = new WorkspaceSettingsService({
    store: workspaceSettingsStore,
    getWorkspaceModel: () => workspaceModel,
    setWorkspaceModel: (model) => {
      workspaceModel = model;
    },
    getWorkspaceSettings: () => workspaceSettings,
    setWorkspaceSettings: (settings) => {
      workspaceSettings = settings;
    },
    setWorkspaceSetupComplete: (complete) => {
      workspaceSetupComplete = complete;
    },
    terminalManager,
    workspaceWatcherService,
    indexingService,
    ensureNoteRoots,
    restartCommandServer: startCommandServer,
    applyAppearanceMode: (settings) => {
      if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
        nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
      }
    },
  });
  invocationObservationService = new InvocationObservationService({
    workspaceWatcherService,
    terminalManager,
    getWorkspaceSettings: () => workspaceSettingsService.currentSettings(),
  });
  invocationObservationService.on("updated", (record) => {
    sendToRenderer("workspace:invocation-updated", record);
  });
  void invocationObservationService.markOrphanedRunningInvocations().catch((error) => {
    console.warn("[exo] failed to mark orphaned invocations", error);
  });
  workspaceNotesService = new WorkspaceNotesService({
    getWorkspaceModel: () => workspaceModel,
  });
  agentInstructionsService = new AgentInstructionsService({
    getWorkspaceModel: () => workspaceModel,
    errorMessage,
  });
  appLifecycle = new AppLifecycleController({
    currentDirectory,
    getTerminalDiagnostics: () => terminalManager?.diagnostics() ?? [],
    getCommandServerStatus: () => ({
      listening: commandServer?.isListening() ?? false,
      port: commandServer?.getPort() ?? null,
    }),
    openSettings: () => {
      sendToRenderer("command:open-settings", { section: "workspace" });
    },
    restartCommandServer: startCommandServer,
    logMain,
  });
  registerIpcHandlers();
  broadcastTerminalData();
  workspaceWatcherService.start(workspaceModel);
  await terminalManager.syncRuntimeContext();
  appLifecycle.createWindow();
  appLifecycle.setupTray();
  startCommandServer();

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

app.on("before-quit", () => {
  appLifecycle?.prepareToQuit();
  commandServer?.stop();
  workspaceWatcherService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
