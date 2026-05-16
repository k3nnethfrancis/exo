import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { access, appendFile, mkdir, stat } from "node:fs/promises";
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
  updateIndex,
  type IndexedRoot,
  type SearchResult,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import { CommandServer } from "./command-server";
import {
  applyWorkspaceSettingsToEnv,
  DEFAULT_APPEARANCE_MODE,
  isForcedTheme,
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

const singleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let tray: Tray | null = null;
let commandServer: CommandServer | null = null;
let workspaceModel: WorkspaceModel;
let workspaceSettings: WorkspaceSettings | null = null;
let workspaceSettingsStore: WorkspaceSettingsStore;
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
const rendererRecoveryTimestamps: number[] = [];
const streamingTerminalIds = new Set<string>();

if (!singleInstanceLock) {
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

  commandServer = new CommandServer({
    runtimeRoot: runtimeConfig.runtimeRoot,
    onShowWindow: () => showMainWindow(),
    onOpenFile: (filePath: string) => {
      sendToRenderer("command:open-file", filePath);
    },
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onIndexSearch: (query, options) => searchIndex(workspaceModel, runtimeConfig.runtimeRoot, query, options),
    onReadDocument: (target, options) => readIndexDocument(workspaceModel, runtimeConfig.runtimeRoot, target, options),
    onIndexStatus: () => getIndexStatus(workspaceModel, runtimeConfig.runtimeRoot),
    onIndexAddRoot: (input) => addIndexedRoot(input),
    onIndexRemoveRoot: (target) => removeIndexedRoot(target),
    onIndexUpdate: () => updateIndex(workspaceModel, runtimeConfig.runtimeRoot),
    onIndexEmbed: () => embedIndex(workspaceModel, runtimeConfig.runtimeRoot),
    onListTerminals: () => terminalManager.list(),
    onCreateTerminal: (kind: string, cwd?: string) => terminalManager.create({ kind: kind as "shell" | "claude" | "codex", cwd }),
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

  commandServer.start().catch((error) => {
    console.error("Failed to start command server:", error);
  });
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
    const info = terminalManager.getInfo(event.id);
    if (info?.kind !== "shell" && !streamingTerminalIds.has(event.id)) {
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

function registerIpcHandlers() {
  ipcMain.handle("workspace:get-model", async () => workspaceModel);
  ipcMain.handle("workspace:get-settings", async () => currentWorkspaceSettings());
  ipcMain.handle("workspace:get-index-status", async () => getIndexStatus(workspaceModel, resolveRuntimeConfig().runtimeRoot));
  ipcMain.handle("workspace:save-settings", async (_event, settings: WorkspaceSettings) => {
    return saveWorkspaceSettings(settings);
  });
  ipcMain.handle("runtime:get-status", async () => terminalManager.getRuntimeConfig());
  ipcMain.handle("runtime:sync", async () => terminalManager.syncRuntimeContext());
  ipcMain.handle(
    "workspace:list-tree",
    async (_event, rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number }) =>
    listRootTree(rootPath, options),
  );
  ipcMain.handle("workspace:search-notes", async (_event, query: string) => searchNotes(workspaceModel, query));
  ipcMain.handle("workspace:search-workspace", async (_event, query: string) => searchWorkspace(workspaceModel, query));
  ipcMain.handle("workspace:get-git-status", async (_event, rootPath: string) => getGitStatus(rootPath));
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
  ipcMain.handle("notes:save", async (_event, filePath: string, frontmatter: Record<string, unknown>, body: string) =>
    saveWorkspaceDocument(filePath, frontmatter, body),
  );
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
    const [{ stdout: branchStdout }, { stdout: statusStdout }] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "branch", "--show-current"]),
      execFileAsync("git", ["-C", rootPath, "status", "--porcelain"]),
    ]);

    return {
      rootPath,
      branch: branchStdout.trim() || null,
      dirty: statusStdout.trim().length > 0,
    };
  } catch {
    return null;
  }
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
  workspaceSettings = await workspaceSettingsStore.save(settings);
  workspaceModel = {
    ...workspaceModel,
    indexedRoots: workspaceSettings.indexedRoots,
    indexing: workspaceSettings.indexing,
  };
  applyWorkspaceSettings(workspaceSettings);
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
  workspaceWatcherService = new WorkspaceWatcherService((event) => sendToRenderer("workspace:changed", event));

  const forcedTheme = process.env.EXO_FORCE_THEME;
  if (isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = forcedTheme;
  }

  workspaceSettings = await workspaceSettingsStore.load();
  applyWorkspaceSettings(workspaceSettings);
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  workspaceModel = resolveWorkspaceModel();
  await ensureNoteRoots(workspaceModel);
  workspaceSettings = await workspaceSettingsStore.save(currentWorkspaceSettings());
  logWorkspaceStartup(workspaceModel);
  terminalManager = new TerminalManager(workspaceModel.defaultTerminalCwd);
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

  app.on("second-instance", () => {
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
