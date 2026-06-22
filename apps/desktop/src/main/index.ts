import { app, nativeTheme, powerMonitor } from "electron";
import path from "node:path";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createBranchFile,
  deleteWorkspacePath,
  listRootTree,
  readIndexDocument,
  readWorkspaceDocument,
  renameWorkspacePath,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  searchIndex,
  searchNotes,
  searchWorkspace,
  type ManagedAgentKind,
  type ExoOpenPreviewResponse,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import type { DesktopEventChannel, DesktopEventPayloads } from "../shared/desktop-ipc";
import { AgentInstructionsService } from "./agent-instructions-service";
import { AgentSkillsService } from "./agent-skills-service";
import { AppLifecycleController } from "./app-lifecycle";
import { CommandServer } from "./command-server";
import { IndexingService } from "./indexing-service";
import {
  applyWorkspaceSettingsToEnv,
  DEFAULT_APPEARANCE_MODE,
  isForcedTheme,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "./settings-store";
import { registerTerminalIpcHandlers } from "./terminal-ipc";
import { TerminalManager } from "./terminal-manager";
import { registerTerminalRecoveryService } from "./terminal-recovery-service";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc";
import { ProjectReviewService } from "./project-review-service";
import { WorkspaceNotesService } from "./workspace-notes-service";
import { WorkspaceSettingsService } from "./workspace-settings-service";
import { WorkspaceWatcherService } from "./workspace-watchers";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

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
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
let indexingService: IndexingService;
let workspaceNotesService: WorkspaceNotesService;
let projectReviewService: ProjectReviewService;
let agentInstructionsService: AgentInstructionsService;
let agentSkillsService: AgentSkillsService;
let workspaceSettingsService: WorkspaceSettingsService;

if (!singleInstanceLock) {
  console.error(
    "[exo] another Exo instance is already running; this dev process will exit after asking the running app to focus and refresh command-server discovery.",
  );
  app.quit();
}

function startCommandServer() {
  const runtimeConfig = resolveRuntimeConfig();

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
    onReadDocument: (target, options) => readIndexDocument(workspaceModel, resolveRuntimeConfig().runtimeRoot, target, options),
    onIndexStatus: () => indexingService.getMeasuredStatus(),
    onIndexAddRoot: (input) => indexingService.addRoot(input),
    onIndexRemoveRoot: (target) => indexingService.removeRoot(target),
    onIndexSync: () => indexingService.runSync("command"),
    onIndexUpdate: () => indexingService.update("command"),
    onIndexEmbed: () => indexingService.embed("command"),
    onListProjectRoots: () => workspaceSettingsService.currentSettings().projectRoots,
    onAddProjectRoot: (input) => workspaceSettingsService.addProjectRoot(input.path),
    onRemoveProjectRoot: (target) => workspaceSettingsService.removeProjectRoot(target),
    onListTerminals: () => terminalManager.list(),
    onTerminalDiagnostics: () => terminalManager.diagnostics(),
    onCreateTerminal: (kind: string, cwd?: string) =>
      terminalManager.create({ kind: kind as ManagedAgentKind, cwd }),
    onReadTerminalTail: (id: string) => terminalManager.readTail(id),
    onReadTerminalTranscript: (id: string, tailChars: number) => terminalManager.readTranscript(id, tailChars),
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onSendTerminalMessage: (id: string, message: string, submit: boolean) => terminalManager.sendMessage(id, message, submit),
    onReconnectTerminal: (id: string) => terminalManager.reconnect(id),
    onKillTerminal: (id: string) => terminalManager.kill(id),
    onGetSettings: () => workspaceSettingsService.currentSettings(),
    onGetStatus: () => ({
      workspace: workspaceModel,
      terminals: terminalManager.list(),
    }),
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

async function resolvePreviewTarget(target: string, settings: WorkspaceSettings): Promise<ExoOpenPreviewResponse> {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Preview target cannot be empty.");
  }

  const parsedUrl = parsePreviewUrl(trimmed);
  if (parsedUrl) {
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return { ok: true, url: parsedUrl.toString(), source: "url" };
    }
    if (parsedUrl.protocol === "file:") {
      return resolveLocalPreviewPath(fileURLToPath(parsedUrl), settings);
    }
    throw new Error("Preview URL must use http, https, or file.");
  }

  const candidatePath = path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(settings.workspaceRoot, trimmed);
  return resolveLocalPreviewPath(candidatePath, settings);
}

function parsePreviewUrl(target: string): URL | null {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return null;
  }
  try {
    return new URL(target);
  } catch {
    throw new Error("Preview target is not a valid URL.");
  }
}

async function resolveLocalPreviewPath(filePath: string, settings: WorkspaceSettings): Promise<ExoOpenPreviewResponse> {
  const resolvedPath = path.resolve(filePath);
  const allowedRoots = [
    settings.workspaceRoot,
    ...settings.noteRoots,
    ...settings.projectRoots,
  ].map((rootPath) => path.resolve(rootPath));

  if (!allowedRoots.some((rootPath) => isPathWithin(rootPath, resolvedPath))) {
    throw new Error("Local preview files must be inside the workspace, note roots, or project roots.");
  }

  if (![".html", ".htm"].includes(path.extname(resolvedPath).toLowerCase())) {
    throw new Error("Local preview files must be .html or .htm files.");
  }

  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error("Local preview target must be an existing file.");
  }

  return { ok: true, url: pathToFileURL(resolvedPath).toString(), source: "file" };
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  const notesRoot = path.join(userDataRoot, "onboarding-notes");

  return {
    workspaceRoot: userDataRoot,
    defaultTerminalCwd: homeRoot,
    noteRoots: [
      {
        id: "note-root-1",
        label: "onboarding-notes",
        path: notesRoot,
        kind: "notes",
      },
    ],
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
    activateWorkspace: async (workspaceId) => {
      const entry = await workspaceSettingsStore.getWorkspace(workspaceId);
      if (!entry) {
        throw new Error("Workspace not found.");
      }
      return workspaceSettingsService.saveSettings(entry.settings);
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
    listAgentHarnesses: async () => terminalManager.getRuntimeConfig().harnesses,
    getBranchFamily: (filePath) => workspaceNotesService.getBranchFamily(filePath),
    getGitStatus: (rootPath) => projectReviewService.getGitStatus(rootPath),
    getIndexStatus: () => indexingService.getMeasuredStatus(),
    getKnowledge: (filePath) => workspaceNotesService.getKnowledge(filePath),
    getMainWindow: () => appLifecycle.getMainWindow(),
    getModel: () => workspaceModel,
    getRuntimeStatus: () => terminalManager.getRuntimeConfig(),
    getSettings: () => workspaceSettingsService.currentSettings(),
    getSetupState: () => ({
      complete: workspaceSetupComplete,
      settingsPath: workspaceSettingsStore.resolvePath(),
    }),
    addAgentSkillSource: (input) => agentSkillsService.addSkillSource(input),
    installAgentLibrarySkill: (input) => agentSkillsService.installLibrarySkill(input),
    listAgentInstructionOverlays: () => agentInstructionsService.listOverlays(),
    listAgentSkills: () => agentSkillsService.listInventory(),
    listTree: listRootTree,
    listWorkspaces: () => workspaceSettingsStore.listWorkspaces(workspaceSettings),
    readAgentSkillFile: (skillId, relativePath) => agentSkillsService.readSkillFile(skillId, relativePath),
    readNote: readWorkspaceDocument,
    renamePath: renameWorkspacePath,
    resolveTarget: (sourceFilePath, target) => workspaceNotesService.resolveTarget(sourceFilePath, target),
    saveAgentInstructionConfig: (input) => agentInstructionsService.saveConfig(input),
    saveAgentSkillFile: (skillId, relativePath, body) => agentSkillsService.saveSkillFile(skillId, relativePath, body),
    saveNote: async (filePath, frontmatter, body) => {
      await saveWorkspaceDocument(filePath, frontmatter, body);
      indexingService.scheduleForFile(filePath, "note-save");
    },
    saveSettings: (settings) => workspaceSettingsService.saveSettings(settings),
    searchIndex: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    searchNotes: (query) => searchNotes(workspaceModel, query),
    searchTag: (tag) => workspaceNotesService.searchTag(tag),
    searchWorkspace: (query) => searchWorkspace(workspaceModel, query),
    setAgentSkillEnabled: (input) => agentSkillsService.setSkillEnabled(input),
    statNote: async (filePath) => {
      try {
        const info = await stat(filePath);
        return { size: info.size, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    },
    suggestTargets: (sourceFilePath, query) => workspaceNotesService.suggestTargets(sourceFilePath, query),
    syncAgentSkillSource: (sourceId) => agentSkillsService.syncSkillSource(sourceId),
    syncIndex: () => indexingService.runSync("settings"),
    syncRuntime: () => terminalManager.syncRuntimeContext(),
    updateIndex: () => indexingService.update("settings"),
  });
  registerTerminalIpcHandlers(terminalManager);
}

function applyWorkspaceSettings(settings: WorkspaceSettings | null) {
  applyWorkspaceSettingsToEnv(settings);
  if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
    nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
  }
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

  workspaceSettings = await workspaceSettingsStore.load();
  if (workspaceSettings) {
    applyWorkspaceSettings(workspaceSettings);
  }
  workspaceSetupComplete = workspaceSettings !== null || Boolean(process.env.EXO_NOTE_ROOTS);
  workspaceModel = workspaceSetupComplete ? resolveWorkspaceModel() : createFirstRunWorkspaceModel();
  const effectiveWorkspaceSettings = workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel);
  applyWorkspaceSettings(effectiveWorkspaceSettings);
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  if (workspaceSetupComplete) {
    await ensureNoteRoots(workspaceModel);
    workspaceSettings = await workspaceSettingsStore.save(workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel));
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
    saveWorkspaceSettings: (settings) => workspaceSettingsService.saveSettings(settings),
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
  workspaceNotesService = new WorkspaceNotesService({
    getWorkspaceModel: () => workspaceModel,
  });
  projectReviewService = new ProjectReviewService();
  agentInstructionsService = new AgentInstructionsService({
    getWorkspaceModel: () => workspaceModel,
    errorMessage,
  });
  agentSkillsService = new AgentSkillsService({
    disabledRootPath: path.join(app.getPath("userData"), "disabled-skills"),
    getWorkspaceModel: () => workspaceModel,
    homePath: process.env.HOME || app.getPath("home"),
    skillSourcesRootPath: path.join(app.getPath("userData"), "skill-sources"),
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

  registerTerminalRecoveryService({ powerMonitor, terminalManager, logMain });

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
