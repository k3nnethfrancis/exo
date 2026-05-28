import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray, type OpenDialogOptions } from "electron";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createIndexedRoot,
  createBranchFile,
  deleteWorkspacePath,
  embedIndex,
  getBranchFamily,
  getIndexStatus,
  getNoteKnowledge,
  listMarkdownFiles,
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
  syncIndex,
  updateIndex,
  type IndexedRoot,
  type IndexJobMetric,
  type IndexStatus,
  type IndexSyncResult,
  type SearchResult,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import { CommandServer } from "./command-server";
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
import { WorkspaceWatcherService } from "./workspace-watchers";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

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

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let tray: Tray | null = null;
let commandServer: CommandServer | null = null;
let workspaceModel: WorkspaceModel;
let workspaceSettings: WorkspaceSettings | null = null;
let workspaceSettingsStore: WorkspaceSettingsStore;
let workspaceSetupComplete = false;
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
let indexSyncTimer: NodeJS.Timeout | null = null;
let indexSyncPromise: Promise<IndexSyncResult> | null = null;
let indexSyncQueued = false;
let indexRefreshTimer: NodeJS.Timeout | null = null;
let indexRefreshPromise: Promise<IndexSyncResult> | null = null;
const pendingIndexRefreshRootIds = new Set<string>();
let indexJobSequence = 0;
const indexJobMetrics: IndexJobMetric[] = [];
const rendererRecoveryTimestamps: number[] = [];
const streamingTerminalIds = new Set<string>();

if (!singleInstanceLock) {
  console.error(
    "[exo] another Exo instance is already running; this dev process will exit after asking the running app to focus and refresh command-server discovery.",
  );
  app.quit();
}

function setupTray() {
  // 16x16 template image for macOS menu bar (white circle, rendered as dark in light mode)
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaklEQVQ4T2NkoBAwUqifgWoGzP7/n+E/AwMDIyMjw+z//xkYGBgZGGb9/8/AABJjZGRkmMXIwMAAEmNiYmKYxcDAwACyAcQGsUFiIHVMTEyzGEBOALsBpA/mBJAbQOEACweKkgHVkgEA+XIjEZSfLzQAAAAASUVORK5CYII=",
  );
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("Exo");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Exo",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to show/focus
  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function startCommandServer() {
  const runtimeConfig = resolveRuntimeConfig();

  commandServer?.stop();
  const nextCommandServer = new CommandServer({
    runtimeRoot: runtimeConfig.runtimeRoot,
    onShowWindow: () => showMainWindow(),
    onOpenFile: (filePath: string) => {
      sendToRenderer("command:open-file", filePath);
    },
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onIndexSearch: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    onReadDocument: (target, options) => readIndexDocument(workspaceModel, resolveRuntimeConfig().runtimeRoot, target, options),
    onIndexStatus: () => getMeasuredIndexStatus(),
    onIndexAddRoot: (input) => addIndexedRoot(input),
    onIndexRemoveRoot: (target) => removeIndexedRoot(target),
    onIndexSync: () => runIndexSync("command"),
    onIndexUpdate: () => runMeasuredIndexStatusJob("update", "command", () => updateIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot)),
    onIndexEmbed: () => runMeasuredIndexStatusJob("embed", "command", () => embedIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot)),
    onListProjectRoots: () => currentWorkspaceSettings().projectRoots,
    onAddProjectRoot: (input) => addProjectRoot(input.path),
    onRemoveProjectRoot: (target) => removeProjectRoot(target),
    onListTerminals: () => terminalManager.list(),
    onTerminalDiagnostics: () => terminalManager.diagnostics(),
    onCreateTerminal: (kind: string, cwd?: string, transport?: "direct" | "tmux") =>
      terminalManager.create({ kind: kind as "shell" | "claude" | "codex", cwd, transport }),
    onReadTerminal: (id: string) => terminalManager.readBuffer(id),
    onReadTerminalTranscript: (id: string, tailChars: number) => terminalManager.readTranscript(id, tailChars),
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onKillTerminal: (id: string) => terminalManager.kill(id, { terminate: true }),
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

function createWindow() {
  const preloadPath = resolvePreloadPath();
  const isTestWindow = process.env.EXO_TEST === "1";
  const window = new BrowserWindow({
    width: 1680,
    height: 1060,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "Exo",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#f6ecda",
    icon: resolveWindowIconPath(),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {
      x: 16,
      y: 14,
    },
    webPreferences: {
      preload: preloadPath,
      webviewTag: true,
    },
  });

  loadRenderer(window);

  window.webContents.on("did-start-loading", () => {
    if (mainWindow === window) {
      rendererReady = false;
    }
  });

  // Safety timeout: force-show if renderer takes too long (e.g., slow Vite HMR)
  const showTimeout = isTestWindow
    ? null
    : setTimeout(() => {
        if (!window.isDestroyed() && !window.isVisible()) {
          window.show();
        }
      }, 5000);

  window.once("ready-to-show", () => {
    if (showTimeout) clearTimeout(showTimeout);
    if (isTestWindow) {
      return;
    }
    window.show();
  });

  window.webContents.on("did-finish-load", () => {
    if (showTimeout) clearTimeout(showTimeout);
    if (window.isDestroyed()) {
      return;
    }
    if (mainWindow === window) {
      rendererReady = true;
    }
    if (isTestWindow) {
      return;
    }
    if (!window.isVisible()) {
      window.show();
    }
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    if (mainWindow === window) {
      rendererReady = false;
    }
    const diagnostics = {
      ...details,
      gpuDisabled: process.env.EXO_ENABLE_GPU !== "1",
      terminals: terminalManager?.diagnostics() ?? [],
    };
    console.error("[main] renderer process gone", diagnostics);
    logMain("renderer process gone", diagnostics);
    scheduleRendererRecovery(window, details.reason);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    const details = { errorCode, errorDescription, validatedURL };
    console.error("[main] renderer failed to load", details);
    logMain("renderer failed to load", details);
  });

  mainWindow = window;

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      rendererReady = false;
    }
  });
}

function resolveWindowIconPath(): string | undefined {
  const iconPath = path.join(currentDirectory, "../../build/icon.png");
  return existsSync(iconPath) ? iconPath : undefined;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function loadRenderer(window: BrowserWindow) {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  }
}

function scheduleRendererRecovery(window: BrowserWindow, reason: string) {
  if (process.env.EXO_AUTO_RECOVER_RENDERER === "0") {
    return;
  }
  if (reason !== "crashed" && reason !== "oom") {
    return;
  }

  const now = Date.now();
  while (rendererRecoveryTimestamps.length > 0 && now - rendererRecoveryTimestamps[0] > 60_000) {
    rendererRecoveryTimestamps.shift();
  }
  if (rendererRecoveryTimestamps.length >= 3) {
    logMain("renderer auto recovery suppressed", {
      reason,
      recentRecoveries: rendererRecoveryTimestamps.length,
    });
    return;
  }
  rendererRecoveryTimestamps.push(now);

  setTimeout(() => {
    if (window.isDestroyed() || mainWindow !== window) {
      return;
    }
    logMain("renderer auto recovery reload", { reason });
    loadRenderer(window);
    if (!window.isVisible()) {
      window.show();
    }
  }, 750);
}

function resolvePreloadPath(): string {
  const candidatePaths = [path.join(currentDirectory, "../preload/index.js"), path.join(currentDirectory, "../preload/index.mjs")];
  const existing = candidatePaths.find((candidate) => existsSync(candidate));
  return existing ?? candidatePaths[0];
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
    if (!streamingTerminalIds.has(event.id)) {
      return;
    }
    sendToRenderer("terminal:data", event);
  });
  terminalManager.on("exit", (event) => {
    sendToRenderer("terminal:exit", event);
  });
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
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
  ipcMain.handle("workspace:get-model", async () => workspaceModel);
  ipcMain.handle("workspace:get-settings", async () => currentWorkspaceSettings());
  ipcMain.handle("workspace:get-setup-state", async () => ({
    complete: workspaceSetupComplete,
    settingsPath: workspaceSettingsStore.resolvePath(),
  }));
  ipcMain.handle("workspace:list-workspaces", async () => workspaceSettingsStore.listWorkspaces(workspaceSettings));
  ipcMain.handle("workspace:activate-workspace", async (_event, workspaceId: string) => {
    const entry = await workspaceSettingsStore.getWorkspace(workspaceId);
    if (!entry) {
      throw new Error("Workspace not found.");
    }
    return saveWorkspaceSettings(entry.settings);
  });
  ipcMain.handle("workspace:get-index-status", async () => getMeasuredIndexStatus());
  ipcMain.handle("workspace:index-sync", async () => runIndexSync("settings"));
  ipcMain.handle("workspace:index-update", async () =>
    runMeasuredIndexStatusJob("update", "settings", () => updateIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot)),
  );
  ipcMain.handle("workspace:index-embed", async () =>
    runMeasuredIndexStatusJob("embed", "settings", () => embedIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot)),
  );
  ipcMain.handle("workspace:save-settings", async (_event, settings: WorkspaceSettings) => {
    return saveWorkspaceSettings(settings);
  });
  ipcMain.handle(
    "workspace:select-folder",
    async (_event, options?: { title?: string; allowMultiple?: boolean; buttonLabel?: string }) => {
      const dialogOptions: OpenDialogOptions = {
        title: options?.title,
        buttonLabel: options?.buttonLabel,
        properties: [
          "openDirectory",
          "createDirectory",
          ...(options?.allowMultiple ? ["multiSelections" as const] : []),
        ],
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? [] : result.filePaths;
    },
  );
  ipcMain.handle("runtime:get-status", async () => terminalManager.getRuntimeConfig());
  ipcMain.handle("runtime:sync", async () => terminalManager.syncRuntimeContext());
  ipcMain.handle(
    "workspace:list-tree",
    async (_event, rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number; includeEmptyDirectories?: boolean }) =>
    listRootTree(rootPath, options),
  );
  ipcMain.handle("workspace:search-notes", async (_event, query: string) => searchNotes(workspaceModel, query));
  ipcMain.handle("workspace:search-workspace", async (_event, query: string) => searchWorkspace(workspaceModel, query));
  ipcMain.handle(
    "workspace:search-index",
    async (_event, query: string, options?: { limit?: number; forceMode?: "lexical" | "semantic" | "hybrid" }) =>
      searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
  );
  ipcMain.handle("workspace:get-git-status", async (_event, rootPath: string) => getGitStatus(rootPath));
  ipcMain.handle("workspace:get-agent-instruction-config", async () => getAgentInstructionConfig());
  ipcMain.handle("workspace:save-agent-instruction-config", async (_event, input: { scopeId: "global" | "exocortex"; body: string }) =>
    saveAgentInstructionConfig(input),
  );
  ipcMain.handle("workspace:list-agent-instruction-overlays", async () => listAgentInstructionOverlays());
  ipcMain.handle("workspace:create-file", async (_event, targetPath: string, content?: string) => createWorkspaceFile(targetPath, content));
  ipcMain.handle("workspace:create-directory", async (_event, targetPath: string) => createWorkspaceDirectory(targetPath));
  ipcMain.handle("workspace:rename-path", async (_event, sourcePath: string, nextPath: string) => renameWorkspacePath(sourcePath, nextPath));
  ipcMain.handle("workspace:delete-path", async (_event, targetPath: string) => deleteWorkspacePath(targetPath));
  ipcMain.handle("workspace:search-tag", async (_event, tag: string): Promise<SearchResult[]> => {
    const normalized = tag.replace(/^#/, "");
    const files = await listMarkdownFiles(workspaceModel.noteRoots.map((root) => root.path));
    const results: Array<SearchResult | null> = await Promise.all(
      files.map(async (filePath) => {
        const document = await readWorkspaceDocument(filePath);
        const rawTags = Array.isArray(document.frontmatter.tags)
          ? document.frontmatter.tags.filter((entry): entry is string => typeof entry === "string")
          : typeof document.frontmatter.tags === "string"
            ? document.frontmatter.tags.split(/[,\s]+/)
            : [];
        const bodyIncludes = document.body.toLowerCase().includes(`#${normalized.toLowerCase()}`);
        const frontmatterIncludes = rawTags.some((entry) => entry.replace(/^#/, "").toLowerCase() === normalized.toLowerCase());
        if (!bodyIncludes && !frontmatterIncludes) {
          return null;
        }

        return {
          filePath,
          title: document.title,
          snippet: `#${normalized}`,
          kind: "tag" as const,
        };
      }),
    );

    return results.filter((entry): entry is SearchResult => entry !== null);
  });

  ipcMain.handle("notes:read", async (_event, filePath: string) => readWorkspaceDocument(filePath));
  ipcMain.handle("notes:save", async (_event, filePath: string, frontmatter: Record<string, unknown>, body: string) => {
    await saveWorkspaceDocument(filePath, frontmatter, body);
    scheduleIndexSyncForFile(filePath, "note-save");
  });
  ipcMain.handle("notes:stat", async (_event, filePath: string) => {
    try {
      const info = await stat(filePath);
      return { size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  });
  ipcMain.handle("notes:get-knowledge", async (_event, filePath: string) =>
    getNoteKnowledge(filePath, workspaceModel.noteRoots.map((root) => root.path)),
  );
  ipcMain.handle("notes:resolve-target", async (_event, sourceFilePath: string, target: string) =>
    resolveNoteTarget(sourceFilePath, target),
  );
  ipcMain.handle("notes:ensure-target", async (_event, sourceFilePath: string, target: string) =>
    ensureNoteTarget(sourceFilePath, target),
  );
  ipcMain.handle("notes:suggest-targets", async (_event, sourceFilePath: string, query: string) =>
    suggestNoteTargets(sourceFilePath, query),
  );
  ipcMain.handle("notes:get-branch-family", async (_event, filePath: string) =>
    getBranchFamily(filePath, workspaceModel.noteRoots.map((root) => root.path)),
  );
  ipcMain.handle("notes:create-branch", async (_event, filePath: string, frontmatter: Record<string, unknown>, body: string) =>
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
  );

  registerTerminalIpcHandlers(terminalManager, streamingTerminalIds);
  ipcMain.handle("shell:open-external", async (_event, target: string) => shell.openExternal(target));
}

async function resolveNoteTarget(sourceFilePath: string, target: string): Promise<string | null> {
  if (/^https?:\/\//.test(target)) {
    return null;
  }

  const relativeCandidate = target.endsWith(".md")
    ? path.resolve(path.dirname(sourceFilePath), target)
    : path.resolve(path.dirname(sourceFilePath), `${target}.md`);

  if (await fileExists(relativeCandidate)) {
    return relativeCandidate;
  }

  const normalizedTarget = path.basename(target, ".md").toLowerCase();
  const noteFiles = await listMarkdownFiles(workspaceModel.noteRoots.map((root) => root.path));
  return noteFiles.find((filePath) => path.basename(filePath, ".md").toLowerCase() === normalizedTarget) ?? null;
}

async function ensureNoteTarget(sourceFilePath: string, target: string): Promise<string> {
  const resolved = await resolveNoteTarget(sourceFilePath, target);
  if (resolved) {
    return resolved;
  }

  const noteRoot = workspaceModel.noteRoots.find((root) => isPathWithin(root.path, sourceFilePath));
  const normalizedTarget = target.replace(/^\/+/, "").replace(/\.md$/i, "");
  const nextPath = normalizedTarget.includes("/")
    ? path.join(noteRoot?.path ?? path.dirname(sourceFilePath), `${normalizedTarget}.md`)
    : path.join(path.dirname(sourceFilePath), `${normalizedTarget}.md`);

  await createWorkspaceFile(nextPath, "");
  return nextPath;
}

async function suggestNoteTargets(sourceFilePath: string, query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [];
  }

  const sourceRoot = workspaceModel.noteRoots.find((root) => isPathWithin(root.path, sourceFilePath));
  const noteFiles = await listMarkdownFiles(workspaceModel.noteRoots.map((root) => root.path));
  const suggestions = noteFiles
    .map((filePath) => {
      const rootPath = workspaceModel.noteRoots.find((root) => isPathWithin(root.path, filePath))?.path ?? sourceRoot?.path;
      const relativePath = rootPath ? path.relative(rootPath, filePath) : path.basename(filePath);
      const relativeWithoutExtension = relativePath.replace(/\.md$/i, "");
      const title = path.basename(filePath, ".md");
      const haystack = `${title}\n${relativeWithoutExtension}`.toLowerCase();
      if (!haystack.includes(trimmedQuery)) {
        return null;
      }

      return {
        filePath,
        title,
        target: relativeWithoutExtension,
        snippet: relativeWithoutExtension,
      };
    })
    .filter((entry): entry is { filePath: string; title: string; target: string; snippet: string } => entry !== null)
    .slice(0, 20);

  suggestions.sort((left, right) => {
    const leftExact = left.title.toLowerCase() === trimmedQuery || left.target.toLowerCase() === trimmedQuery;
    const rightExact = right.title.toLowerCase() === trimmedQuery || right.target.toLowerCase() === trimmedQuery;
    if (leftExact !== rightExact) {
      return leftExact ? -1 : 1;
    }
    return left.target.localeCompare(right.target);
  });

  return suggestions;
}

async function getGitStatus(rootPath: string) {
  try {
    const [{ stdout: branchStdout }, { stdout: statusStdout }, { stdout: diffStdout }] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "branch", "--show-current"]),
      execFileAsync("git", ["-C", rootPath, "status", "--porcelain", "--", "."]),
      execFileAsync("git", ["-C", rootPath, "diff", "--unified=0", "HEAD", "--", "."]).catch(() => ({ stdout: "" })),
    ]);
    const firstChangedLines = parseGitDiffFirstChangedLines(diffStdout);

    return {
      rootPath,
      branch: branchStdout.trim() || null,
      dirty: statusStdout.trim().length > 0,
      changes: parseGitStatusChanges(rootPath, statusStdout, firstChangedLines),
    };
  } catch {
    return null;
  }
}

function parseGitStatusChanges(rootPath: string, output: string, firstChangedLines: Map<string, number>) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "??";
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      return {
        path: filePath,
        absolutePath: path.resolve(rootPath, filePath),
        status,
        firstChangedLine: firstChangedLines.get(filePath) ?? (status === "??" ? 1 : null),
      };
    });
}

function parseGitDiffFirstChangedLines(output: string): Map<string, number> {
  const linesByPath = new Map<string, number>();
  let currentPath: string | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length);
      continue;
    }
    if (!currentPath || !line.startsWith("@@")) {
      continue;
    }
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) {
      continue;
    }
    const startLine = Number(match[1]);
    const lineCount = match[2] === undefined ? 1 : Number(match[2]);
    if (lineCount <= 0 || linesByPath.has(currentPath)) {
      continue;
    }
    linesByPath.set(currentPath, startLine);
  }

  return linesByPath;
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

async function fileExists(targetPath: string): Promise<boolean> {
  return access(targetPath, constants.F_OK).then(
    () => true,
    () => false,
  );
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
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
  terminalManager.setTmuxHistoryLines(terminalPolicy.scrollbackLines);
  terminalManager.setTranscriptRetentionDays(terminalPolicy.transcriptRetentionDays);
  terminalManager.setAgentTransport(terminalPolicy.agentTransport);
  await terminalManager.syncRuntimeContext();
  if (nextRuntimeConfig.runtimeRoot !== previousRuntimeRoot) {
    startCommandServer();
  }
  if (shouldSyncAfterSettingsApply(previousSettings, workspaceSettings)) {
    scheduleIndexSync("settings-apply", 0);
  }
  return workspaceSettings;
}

async function addIndexedRoot(input: { path?: string; name?: string; kind?: string; pattern?: string; ignore?: string[]; force?: boolean }): Promise<WorkspaceSettings> {
  if (!input.path) {
    throw new Error("Missing indexed root path.");
  }
  const settings = currentWorkspaceSettings();
  const root = createIndexedRoot(input.path, {
    id: input.name ? `index-${input.name}` : undefined,
    label: input.name,
    kind: parseIndexedRootKind(input.kind),
    pattern: input.pattern,
    ignore: input.ignore,
  });
  if (!input.force && isBroadIndexedRoot(root.path)) {
    throw new Error("Refusing to index a broad home, Desktop, or Documents root directly. Choose a more specific folder.");
  }
  const nextRoots = [
    ...settings.indexedRoots.filter((existing) => existing.id !== root.id && path.resolve(existing.path) !== path.resolve(root.path)),
    root,
  ];
  return saveWorkspaceSettings({
    ...settings,
    indexedRoots: nextRoots,
    indexing: settings.indexing.mode === "off"
      ? { enabled: true, mode: "lexical", backend: "qmd" }
      : { ...settings.indexing, enabled: true },
  });
}

async function removeIndexedRoot(target: string): Promise<WorkspaceSettings> {
  const settings = currentWorkspaceSettings();
  const nextRoots = settings.indexedRoots.filter(
    (root) => root.id !== target && root.label !== target && path.resolve(root.path) !== path.resolve(target),
  );
  return saveWorkspaceSettings({
    ...settings,
    indexedRoots: nextRoots,
    indexing: nextRoots.length === 0 ? { enabled: false, mode: "off", backend: "qmd" } : settings.indexing,
  });
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

function shouldUseIndex(model = workspaceModel): boolean {
  return model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0;
}

async function getMeasuredIndexStatus(): Promise<IndexStatus> {
  const status = await getIndexStatus(workspaceModel, resolveRuntimeConfig().runtimeRoot);
  return attachIndexJobMetrics(status);
}

function attachIndexJobMetrics(status: IndexStatus): IndexStatus {
  return { ...status, recentJobs: indexJobMetrics.slice(0, 8) };
}

function recordIndexJob(
  kind: IndexJobMetric["kind"],
  reason: string,
  startedAtMs: number,
  status: "completed" | "failed",
  resultStatus?: IndexStatus,
  warnings: string[] = [],
  error?: unknown,
) {
  const completedAtMs = Date.now();
  const metric: IndexJobMetric = {
    id: `index-job-${++indexJobSequence}`,
    kind,
    reason,
    status,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    documentCount: resultStatus?.documentCount,
    pendingEmbeddings: resultStatus?.pendingEmbeddings,
    warnings: [...(resultStatus?.warnings ?? []), ...warnings],
    error: error ? errorMessage(error) : undefined,
  };
  indexJobMetrics.unshift(metric);
  indexJobMetrics.splice(20);
}

async function runMeasuredIndexStatusJob(
  kind: IndexJobMetric["kind"],
  reason: string,
  run: () => Promise<IndexStatus>,
): Promise<IndexStatus> {
  const startedAtMs = Date.now();
  try {
    const status = await run();
    recordIndexJob(kind, reason, startedAtMs, "completed", status);
    return attachIndexJobMetrics(status);
  } catch (error) {
    recordIndexJob(kind, reason, startedAtMs, "failed", undefined, [], error);
    throw error;
  }
}

function scheduleIndexSyncForFile(filePath: string, reason: string) {
  const settings = currentWorkspaceSettings();
  if (settings.indexUpdateStrategy !== "on-save" || !shouldUseIndex()) {
    return;
  }
  const matchingRootIds = workspaceModel.indexedRoots
    .filter((root) => isPathWithin(root.path, filePath))
    .map((root) => root.id);
  if (matchingRootIds.length === 0) {
    return;
  }

  if (workspaceModel.indexing.mode === "lexical") {
    scheduleIndexRefresh(reason, matchingRootIds);
    return;
  }

  scheduleIndexSync(reason);
}

function shouldSyncAfterSettingsApply(previous: WorkspaceSettings, next: WorkspaceSettings): boolean {
  if (!next.indexing.enabled || next.indexing.mode === "off" || next.indexedRoots.length === 0) {
    return false;
  }
  return (
    !previous.indexing.enabled ||
    previous.indexing.mode !== next.indexing.mode ||
    JSON.stringify(previous.indexedRoots.map((root) => root.path).sort()) !== JSON.stringify(next.indexedRoots.map((root) => root.path).sort())
  );
}

function scheduleIndexSync(reason: string, delayMs = 15_000) {
  if (indexSyncTimer) {
    clearTimeout(indexSyncTimer);
  }
  indexSyncTimer = setTimeout(() => {
    indexSyncTimer = null;
    runIndexSync(reason).catch((error) => {
      console.warn("[exo] index sync failed", error);
    });
  }, delayMs);
}

async function runIndexSync(reason: string): Promise<IndexSyncResult> {
  if (!shouldUseIndex()) {
    throw new Error("Indexing is disabled or has no indexed roots.");
  }
  if (indexSyncPromise) {
    indexSyncQueued = true;
    return indexSyncPromise;
  }

  const startedAtMs = Date.now();
  sendToRenderer("workspace:index-sync-state", { state: "running", reason });
  indexSyncPromise = syncIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot)
    .then((result) => {
      recordIndexJob("sync", reason, startedAtMs, "completed", result.status, result.warnings);
      const measuredResult = { ...result, status: attachIndexJobMetrics(result.status) };
      sendToRenderer("workspace:index-sync-state", { state: "idle", reason, result: measuredResult });
      return measuredResult;
    })
    .catch((error) => {
      recordIndexJob("sync", reason, startedAtMs, "failed", undefined, [], error);
      sendToRenderer("workspace:index-sync-state", {
        state: "error",
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      indexSyncPromise = null;
      if (indexSyncQueued) {
        indexSyncQueued = false;
        runIndexSync("queued").catch((error) => {
          console.warn("[exo] queued index sync failed", error);
        });
      }
    });

  return indexSyncPromise;
}

function scheduleIndexRefresh(reason: string, rootIds: string[], delayMs = 15_000) {
  for (const rootId of rootIds) {
    pendingIndexRefreshRootIds.add(rootId);
  }
  if (indexRefreshTimer) {
    clearTimeout(indexRefreshTimer);
  }
  indexRefreshTimer = setTimeout(() => {
    indexRefreshTimer = null;
    const refreshRootIds = Array.from(pendingIndexRefreshRootIds);
    pendingIndexRefreshRootIds.clear();
    runIndexRefresh(reason, refreshRootIds).catch((error) => {
      console.warn("[exo] index refresh failed", error);
    });
  }, delayMs);
}

async function runIndexRefresh(reason: string, rootIds: string[]): Promise<IndexSyncResult> {
  if (!shouldUseIndex()) {
    throw new Error("Indexing is disabled or has no indexed roots.");
  }
  if (indexSyncPromise) {
    return indexSyncPromise;
  }
  if (indexRefreshPromise) {
    return indexRefreshPromise;
  }

  const startedAtMs = Date.now();
  sendToRenderer("workspace:index-sync-state", { state: "running", reason });
  indexRefreshPromise = updateIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, { rootIds })
    .then((status) => {
      const result: IndexSyncResult = {
        status,
        phases: [
          {
            name: "update",
            status: "completed",
            message: "Indexed documents refreshed for changed root.",
          },
          {
            name: "embed",
            status: "skipped",
            message: "Embeddings are deferred on save; use Sync index to rebuild them.",
          },
        ],
        warnings:
          workspaceModel.indexing.mode === "lexical"
            ? []
            : ["Save-triggered indexing refreshed documents only; embeddings remain available from the previous sync until rebuilt."],
      };
      recordIndexJob("update", reason, startedAtMs, "completed", status, result.warnings);
      const measuredResult = { ...result, status: attachIndexJobMetrics(status) };
      sendToRenderer("workspace:index-sync-state", { state: "idle", reason, result: measuredResult });
      return measuredResult;
    })
    .catch((error) => {
      recordIndexJob("update", reason, startedAtMs, "failed", undefined, [], error);
      sendToRenderer("workspace:index-sync-state", {
        state: "error",
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      indexRefreshPromise = null;
    });

  return indexRefreshPromise;
}

function applyWorkspaceSettings(settings: WorkspaceSettings | null) {
  applyWorkspaceSettingsToEnv(settings);
  if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
    nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
  }
}

function parseIndexedRootKind(value: string | undefined): IndexedRoot["kind"] {
  return value === "notes" || value === "docs" || value === "code" || value === "mixed" ? value : "mixed";
}

function isBroadIndexedRoot(targetPath: string): boolean {
  const resolvedPath = path.resolve(targetPath);
  return [app.getPath("home"), app.getPath("desktop"), app.getPath("documents")]
    .some((candidate) => path.resolve(candidate) === resolvedPath);
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
    terminalPolicy.scrollbackLines,
    terminalPolicy.transcriptRetentionDays,
  );
  terminalManager.setAgentTransport(terminalPolicy.agentTransport);
  registerIpcHandlers();
  broadcastTerminalData();
  workspaceWatcherService.start(workspaceModel);
  await terminalManager.syncRuntimeContext();
  try {
    const restored = await terminalManager.restoreAgentSessions();
    if (restored.length > 0) {
      console.log(`[main] reattached ${restored.length} agent terminal(s) from previous session`);
    }
  } catch (err) {
    console.warn("[main] failed to restore agent terminals:", err);
  }
  createWindow();
  setupTray();
  startCommandServer();

  nativeTheme.on("updated", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#111318" : "#f6ecda");
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    showMainWindow();
  });

  app.on("second-instance", (_event, _commandLine, workingDirectory, additionalData) => {
    logMain("second instance requested focus", {
      workingDirectory,
      requestedRuntimeRoot: extractRuntimeRoot(additionalData),
    });
    void refreshCommandServerDiscovery("second-instance");
    showMainWindow();
  });
});

async function ensureNoteRoots(model: WorkspaceModel): Promise<void> {
  await Promise.all(model.noteRoots.map((root) => mkdir(root.path, { recursive: true })));
}

app.on("before-quit", () => {
  commandServer?.stop();
});

app.on("window-all-closed", () => {
  workspaceWatcherService?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
