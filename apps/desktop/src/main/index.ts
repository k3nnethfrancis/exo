import { app, nativeTheme } from "electron";
import os from "node:os";
import path from "node:path";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import { AppLifecycleController } from "./app-lifecycle";
import { CommandServer } from "./command-server";
import { IndexingService } from "./indexing-service";
import { writeAgentInstructionOverlays } from "./agent-instruction-overlays";
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
import { ProjectReviewService } from "./project-review-service";
import { WorkspaceNotesService } from "./workspace-notes-service";
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
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onIndexSearch: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    onReadDocument: (target, options) => readIndexDocument(workspaceModel, resolveRuntimeConfig().runtimeRoot, target, options),
    onIndexStatus: () => indexingService.getMeasuredStatus(),
    onIndexAddRoot: (input) => indexingService.addRoot(input),
    onIndexRemoveRoot: (target) => indexingService.removeRoot(target),
    onIndexSync: () => indexingService.runSync("command"),
    onIndexUpdate: () => indexingService.update("command"),
    onIndexEmbed: () => indexingService.embed("command"),
    onListProjectRoots: () => currentWorkspaceSettings().projectRoots,
    onAddProjectRoot: (input) => addProjectRoot(input.path),
    onRemoveProjectRoot: (target) => removeProjectRoot(target),
    onListTerminals: () => terminalManager.list(),
    onTerminalDiagnostics: () => terminalManager.diagnostics(),
    onCreateTerminal: (kind: string, cwd?: string) =>
      terminalManager.create({ kind: kind as "shell" | "claude" | "codex", cwd }),
    onReadTerminalTail: (id: string) => terminalManager.readTail(id),
    onReadTerminalTranscript: (id: string, tailChars: number) => terminalManager.readTranscript(id, tailChars),
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onSendTerminalMessage: (id: string, message: string, submit: boolean) => terminalManager.sendMessage(id, message, submit),
    onKillTerminal: (id: string) => terminalManager.kill(id),
    onGetSettings: () => currentWorkspaceSettings(),
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

function sendToRenderer(channel: string, payload: unknown) {
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
      return saveWorkspaceSettings(entry.settings);
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
    getAgentInstructionConfig,
    getBranchFamily: (filePath) => workspaceNotesService.getBranchFamily(filePath),
    getGitStatus: (rootPath) => projectReviewService.getGitStatus(rootPath),
    getIndexStatus: () => indexingService.getMeasuredStatus(),
    getKnowledge: (filePath) => workspaceNotesService.getKnowledge(filePath),
    getMainWindow: () => appLifecycle.getMainWindow(),
    getModel: () => workspaceModel,
    getRuntimeStatus: () => terminalManager.getRuntimeConfig(),
    getSettings: currentWorkspaceSettings,
    getSetupState: () => ({
      complete: workspaceSetupComplete,
      settingsPath: workspaceSettingsStore.resolvePath(),
    }),
    listAgentInstructionOverlays,
    listTree: listRootTree,
    listWorkspaces: () => workspaceSettingsStore.listWorkspaces(workspaceSettings),
    readNote: readWorkspaceDocument,
    renamePath: renameWorkspacePath,
    resolveTarget: (sourceFilePath, target) => workspaceNotesService.resolveTarget(sourceFilePath, target),
    saveAgentInstructionConfig,
    saveNote: async (filePath, frontmatter, body) => {
      await saveWorkspaceDocument(filePath, frontmatter, body);
      indexingService.scheduleForFile(filePath, "note-save");
    },
    saveSettings: saveWorkspaceSettings,
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

async function listAgentInstructionOverlays() {
  return writeAgentInstructionOverlays(workspaceModel);
}

async function getAgentInstructionConfig() {
  return {
    scopes: await Promise.all(agentInstructionScopeCandidates().map(readAgentInstructionScope)),
    starterTemplate: exoAgentInstructionStarterTemplate(),
  };
}

async function saveAgentInstructionConfig(input: { scopeId: "global" | "exocortex"; body: string }) {
  const scope = agentInstructionScopeCandidates().find((candidate) => candidate.id === input.scopeId);
  if (!scope) {
    throw new Error("Agent instruction scope is unavailable for the active workspace.");
  }
  await Promise.all(Object.values(scope.files).map(async (file) => {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, normalizeInstructionFileBody(input.body), "utf8");
  }));
  return getAgentInstructionConfig();
}

function agentInstructionScopeCandidates() {
  const notesRoot = workspaceModel.noteRoots[0];
  return [
    {
      id: "global" as const,
      label: "Global",
      description: "Personal instructions loaded by supported terminal agents across workspaces.",
      rootPath: os.homedir(),
      files: {
        agents: {
          id: "agents" as const,
          label: "Codex AGENTS.md",
          path: path.join(os.homedir(), ".codex", "AGENTS.md"),
        },
        claude: {
          id: "claude" as const,
          label: "Claude CLAUDE.md",
          path: path.join(os.homedir(), ".claude", "CLAUDE.md"),
        },
      },
    },
    ...(notesRoot ? [{
      id: "exocortex" as const,
      label: "Exocortex",
      description: "Instructions stored in the active notes folder for agents working with your Exo context.",
      rootPath: notesRoot.path,
      files: {
        agents: {
          id: "agents" as const,
          label: "Notes AGENTS.md",
          path: path.join(notesRoot.path, "AGENTS.md"),
        },
        claude: {
          id: "claude" as const,
          label: "Notes CLAUDE.md",
          path: path.join(notesRoot.path, "CLAUDE.md"),
        },
      },
    }] : []),
  ];
}

async function readAgentInstructionScope(scope: ReturnType<typeof agentInstructionScopeCandidates>[number]) {
  const [agents, claude] = await Promise.all([
    readAgentInstructionProviderFile(scope.files.agents),
    readAgentInstructionProviderFile(scope.files.claude),
  ]);
  const errorMessages = [agents, claude].flatMap((file) => file.errorMessage ? [`${file.label}: ${file.errorMessage}`] : []);
  const agentsHasBody = agents.body.trim().length > 0;
  const claudeHasBody = claude.body.trim().length > 0;
  const bodiesMatch = normalizeInstructionComparisonBody(agents.body) === normalizeInstructionComparisonBody(claude.body);
  const status = errorMessages.length > 0
    ? "error"
    : !agents.exists && !claude.exists
      ? "missing-both"
      : agents.exists && !claude.exists
        ? "missing-claude"
        : !agents.exists && claude.exists
          ? "missing-agents"
          : bodiesMatch
            ? "aligned"
            : "different";
  const source = status === "different" || status === "error"
    ? "unresolved"
    : agentsHasBody
      ? "agents"
      : claudeHasBody
        ? "claude"
        : "empty";
  const body = source === "agents" ? agents.body : source === "claude" ? claude.body : "";
  return {
    id: scope.id,
    label: scope.label,
    description: scope.description,
    rootPath: scope.rootPath,
    files: { agents, claude },
    status,
    body,
    source,
    errorMessages,
  };
}

async function readAgentInstructionProviderFile(file: { id: "agents" | "claude"; label: string; path: string }) {
  try {
    const body = await readFile(file.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    });
    return {
      ...file,
      exists: body.length > 0 || existsSync(file.path),
      body,
      errorMessage: null,
    };
  } catch (error) {
    return {
      ...file,
      exists: existsSync(file.path),
      body: "",
      errorMessage: errorMessage(error),
    };
  }
}

function normalizeInstructionFileBody(body: string) {
  return `${body.trimEnd()}\n`;
}

function normalizeInstructionComparisonBody(body: string) {
  return body.replace(/\r\n/g, "\n").trimEnd();
}

function exoAgentInstructionStarterTemplate() {
  return [
    "# Exo Agent Instructions",
    "",
    "- Exo is the local workspace app for navigating the user's notes, projects, terminals, and indexed context.",
    "- Use Exo MCP or CLI tools to inspect attached project roots and indexed notes before guessing where context lives.",
    "- Treat notes as user-authored working context. Preserve organization, links, and private drafts unless asked to change them.",
    "- Prefer explicit attached roots over broad filesystem searches.",
  ].join("\n");
}

function currentWorkspaceSettings(): WorkspaceSettings {
  return workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel);
}

async function saveWorkspaceSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
  const previousSettings = currentWorkspaceSettings();
  const previousRuntimeRoot = resolveRuntimeConfig().runtimeRoot;
  workspaceSettings = await workspaceSettingsStore.save(settings);
  workspaceSetupComplete = true;
  applyWorkspaceSettings(workspaceSettings);
  workspaceModel = resolveWorkspaceModel();
  const nextRuntimeConfig = resolveRuntimeConfig();
  await ensureNoteRoots(workspaceModel);
  workspaceWatcherService.start(workspaceModel);
  const terminalPolicy = resolveTerminalRuntimePolicy(currentWorkspaceSettings());
  terminalManager.setRuntimeConfig(nextRuntimeConfig);
  terminalManager.setDefaultCwd(workspaceModel.defaultTerminalCwd);
  terminalManager.setBufferLineLimit(terminalPolicy.bufferLineLimit);
  terminalManager.setTranscriptRetentionDays(terminalPolicy.transcriptRetentionDays);
  await terminalManager.syncRuntimeContext();
  if (nextRuntimeConfig.runtimeRoot !== previousRuntimeRoot) {
    startCommandServer();
  }
  if (indexingService.shouldSyncAfterSettingsApply(previousSettings, workspaceSettings)) {
    indexingService.scheduleSync("settings-apply", 0);
  }
  return workspaceSettings;
}

async function addProjectRoot(targetPath?: string): Promise<WorkspaceSettings> {
  if (!targetPath) {
    throw new Error("Missing project root path.");
  }
  const settings = currentWorkspaceSettings();
  const resolvedPath = path.resolve(targetPath);
  const nextRoots = uniqueResolvedPaths([...settings.projectRoots, resolvedPath]);
  return saveWorkspaceSettings({ ...settings, projectRoots: nextRoots });
}

async function removeProjectRoot(target: string): Promise<WorkspaceSettings> {
  if (!target) {
    throw new Error("Missing project root target.");
  }
  const settings = currentWorkspaceSettings();
  const resolvedTarget = path.resolve(target);
  const nextRoots = settings.projectRoots.filter((root) => path.resolve(root) !== resolvedTarget && root !== target);
  return saveWorkspaceSettings({ ...settings, projectRoots: nextRoots });
}

function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
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
  workspaceSetupComplete = workspaceSettings !== null || Boolean(process.env.EXO_NOTE_ROOTS);
  applyWorkspaceSettings(workspaceSettings);
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  workspaceModel = resolveWorkspaceModel();
  if (workspaceSetupComplete) {
    await ensureNoteRoots(workspaceModel);
    workspaceSettings = await workspaceSettingsStore.save(currentWorkspaceSettings());
  }
  logWorkspaceStartup(workspaceModel);
  const terminalPolicy = resolveTerminalRuntimePolicy(currentWorkspaceSettings());
  terminalManager = new TerminalManager(
    workspaceModel.defaultTerminalCwd,
    terminalPolicy.bufferLineLimit,
    terminalPolicy.transcriptRetentionDays,
  );
  indexingService = new IndexingService({
    getWorkspaceModel: () => workspaceModel,
    getCurrentSettings: currentWorkspaceSettings,
    getRuntimeRoot: () => resolveRuntimeConfig().runtimeRoot,
    saveWorkspaceSettings,
    sendState: (event) => sendToRenderer("workspace:index-sync-state", event),
    errorMessage,
  });
  workspaceNotesService = new WorkspaceNotesService({
    getWorkspaceModel: () => workspaceModel,
  });
  projectReviewService = new ProjectReviewService();
  appLifecycle = new AppLifecycleController({
    currentDirectory,
    getTerminalDiagnostics: () => terminalManager?.diagnostics() ?? [],
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
