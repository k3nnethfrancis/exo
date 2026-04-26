import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from "electron";
import path from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, existsSync, watch, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildQmdConfig,
  createWorkspaceDirectory,
  createWorkspaceFile,
  createBranchFile,
  deleteWorkspacePath,
  getBranchFamily,
  getNoteKnowledge,
  listMarkdownFiles,
  listRootTree,
  readWorkspaceDocument,
  renameWorkspacePath,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  searchNotes,
  searchQmd,
  searchWorkspace,
  type SearchResult,
  type SemanticSearchResult,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";
import type { TerminalCreateOptions } from "../shared/api";

import { CommandServer } from "./command-server";
import { TerminalManager } from "./terminal-manager";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

if (process.env.EXO_USER_DATA_PATH) {
  app.setPath("userData", process.env.EXO_USER_DATA_PATH);
}

const singleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let commandServer: CommandServer | null = null;
let workspaceModel: WorkspaceModel;
let terminalManager: TerminalManager;
let workspaceWatchers: FSWatcher[] = [];
let pendingWorkspaceEvents = new Map<string, { rootPath: string; eventType: string; filePath: string | null }>();
let workspaceBroadcastTimer: NodeJS.Timeout | null = null;

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
  const qmdConfig = buildQmdConfig(runtimeConfig.retrieval, workspaceModel.noteRoots.map((r) => r.path));

  commandServer = new CommandServer({
    runtimeRoot: runtimeConfig.runtimeRoot,
    onOpenFile: (filePath: string) => {
      mainWindow?.webContents.send("command:open-file", filePath);
    },
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onSearchSemantic: (query: string) => qmdConfig ? searchQmd(query, qmdConfig) : Promise.resolve([]),
    onListTerminals: () => terminalManager.list(),
    onCreateTerminal: (kind: string, cwd?: string) => terminalManager.create({ kind: kind as "shell" | "claude" | "codex", cwd }),
    onGetSettings: () => ({
      workspaceRoot: workspaceModel.workspaceRoot,
      defaultTerminalCwd: workspaceModel.defaultTerminalCwd,
      noteRoots: workspaceModel.noteRoots.map((r) => r.path),
      projectRoots: workspaceModel.projectRoots.map((r) => r.path),
    }),
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {
      x: 16,
      y: 14,
    },
    webPreferences: {
      preload: preloadPath,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  }

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

  window.webContents.once("did-finish-load", () => {
    if (showTimeout) clearTimeout(showTimeout);
    if (isTestWindow || window.isDestroyed()) {
      return;
    }
    if (!window.isVisible()) {
      window.show();
    }
  });

  mainWindow = window;

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
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

  console.info("[exo] workspace startup", {
    workspaceRoot: model.workspaceRoot,
    defaultTerminalCwd: model.defaultTerminalCwd,
    noteRoots: model.noteRoots.map((root) => root.path),
    projectRoots: model.projectRoots.map((root) => root.path),
    userDataPath: app.getPath("userData"),
    settingsPath: resolveWorkspaceSettingsPath(),
  });
}

function broadcastTerminalData() {
  terminalManager.on("data", (event) => {
    mainWindow?.webContents.send("terminal:data", event);
  });
  terminalManager.on("exit", (event) => {
    mainWindow?.webContents.send("terminal:exit", event);
  });
}

function registerIpcHandlers() {
  ipcMain.handle("workspace:get-model", async () => workspaceModel);
  ipcMain.handle("workspace:get-settings", async () => ({
    workspaceRoot: workspaceModel.workspaceRoot,
    defaultTerminalCwd: workspaceModel.defaultTerminalCwd,
    noteRoots: workspaceModel.noteRoots.map((root) => root.path),
    projectRoots: workspaceModel.projectRoots.map((root) => root.path),
  }));
  ipcMain.handle("workspace:save-settings", async (_event, settings: WorkspaceSettings) => saveWorkspaceSettings(settings));
  ipcMain.handle("runtime:get-status", async () => terminalManager.getRuntimeConfig());
  ipcMain.handle("runtime:sync", async () => terminalManager.syncRuntimeContext());
  ipcMain.handle(
    "workspace:list-tree",
    async (_event, rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number }) =>
    listRootTree(rootPath, options),
  );
  ipcMain.handle("workspace:search-notes", async (_event, query: string) => searchNotes(workspaceModel, query));
  ipcMain.handle("workspace:search-workspace", async (_event, query: string) => searchWorkspace(workspaceModel, query));
  ipcMain.handle("workspace:search-semantic", async (_event, query: string): Promise<SemanticSearchResult[]> => {
    const runtimeConfig = resolveRuntimeConfig();
    const qmdConfig = buildQmdConfig(runtimeConfig.retrieval, workspaceModel.noteRoots.map((r) => r.path));
    if (!qmdConfig) return [];
    return searchQmd(query, qmdConfig);
  });
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

  ipcMain.handle("terminals:ensure-default", async () => terminalManager.ensureDefault());
  ipcMain.handle("terminals:list", async () => terminalManager.list());
  ipcMain.handle("terminals:create", async (_event, options: TerminalCreateOptions) => terminalManager.create(options));
  ipcMain.handle("terminals:write", async (_event, id: string, data: string) => terminalManager.write(id, data));
  ipcMain.handle("terminals:resize", async (_event, id: string, cols: number, rows: number) =>
    terminalManager.resize(id, cols, rows),
  );
  ipcMain.handle("terminals:kill", async (_event, id: string) => terminalManager.kill(id));
  ipcMain.handle("shell:open-external", async (_event, target: string) => shell.openExternal(target));
}

function startWorkspaceWatchers() {
  stopWorkspaceWatchers();

  const rootPaths = [...workspaceModel.noteRoots.map((root) => root.path), ...workspaceModel.projectRoots.map((root) => root.path)];
  const uniqueRootPaths = [...new Set(rootPaths)];

  for (const rootPath of uniqueRootPaths) {
    try {
      const watcher = watch(
        rootPath,
        { recursive: true },
        (eventType, filename) => {
          queueWorkspaceChange({
            rootPath,
            eventType,
            filePath: typeof filename === "string" && filename.length > 0 ? path.join(rootPath, filename) : null,
          });
        },
      );

      watcher.on("error", (error) => {
        console.warn("[exo] workspace watcher error", { rootPath, error: error instanceof Error ? error.message : String(error) });
      });

      workspaceWatchers.push(watcher);
    } catch (error) {
      console.warn("[exo] workspace watcher setup failed", { rootPath, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function stopWorkspaceWatchers() {
  for (const watcher of workspaceWatchers) {
    watcher.close();
  }
  workspaceWatchers = [];

  if (workspaceBroadcastTimer) {
    clearTimeout(workspaceBroadcastTimer);
    workspaceBroadcastTimer = null;
  }
  pendingWorkspaceEvents.clear();
}

function queueWorkspaceChange(event: { rootPath: string; eventType: string; filePath: string | null }) {
  const key = `${event.rootPath}:${event.filePath ?? ""}:${event.eventType}`;
  pendingWorkspaceEvents.set(key, event);

  if (workspaceBroadcastTimer) {
    return;
  }

  workspaceBroadcastTimer = setTimeout(() => {
    workspaceBroadcastTimer = null;
    const events = [...pendingWorkspaceEvents.values()];
    pendingWorkspaceEvents.clear();

    for (const nextEvent of events) {
      mainWindow?.webContents.send("workspace:changed", nextEvent);
    }
  }, 120);
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

function resolveWorkspaceSettingsPath(): string {
  return process.env.EXO_SETTINGS_PATH ?? path.join(app.getPath("userData"), "workspace-settings.json");
}

function normalizeWorkspaceSettings(input: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings | null {
  if (!input) {
    return null;
  }

  const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot.trim() : "";
  const defaultTerminalCwd = typeof input.defaultTerminalCwd === "string" ? input.defaultTerminalCwd.trim() : "";
  const noteRoots = Array.isArray(input.noteRoots)
    ? input.noteRoots.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
  const projectRoots = Array.isArray(input.projectRoots)
    ? input.projectRoots.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];

  if (!workspaceRoot || !defaultTerminalCwd || noteRoots.length === 0 || projectRoots.length === 0) {
    return null;
  }

  return {
    workspaceRoot,
    defaultTerminalCwd,
    noteRoots,
    projectRoots,
  };
}

async function loadWorkspaceSettings(): Promise<WorkspaceSettings | null> {
  try {
    const raw = await readFile(resolveWorkspaceSettingsPath(), "utf8");
    return normalizeWorkspaceSettings(JSON.parse(raw) as Partial<WorkspaceSettings>);
  } catch {
    return null;
  }
}

async function saveWorkspaceSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
  const normalized = normalizeWorkspaceSettings(settings);
  if (!normalized) {
    throw new Error("Workspace settings are incomplete.");
  }

  const settingsPath = resolveWorkspaceSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function applyWorkspaceSettings(settings: WorkspaceSettings | null) {
  if (!settings) {
    return;
  }

  process.env.EXO_WORKSPACE_ROOT = settings.workspaceRoot;
  process.env.EXO_DEFAULT_TERMINAL_CWD = settings.defaultTerminalCwd;
  process.env.EXO_NOTE_ROOTS = settings.noteRoots.join(path.delimiter);
  process.env.EXO_PROJECT_ROOTS = settings.projectRoots.join(path.delimiter);
}

app.whenReady().then(async () => {
  const forcedTheme = process.env.EXO_FORCE_THEME;
  if (forcedTheme === "light" || forcedTheme === "dark" || forcedTheme === "system") {
    nativeTheme.themeSource = forcedTheme;
  }

  applyWorkspaceSettings(await loadWorkspaceSettings());
  workspaceModel = resolveWorkspaceModel();
  logWorkspaceStartup(workspaceModel);
  terminalManager = new TerminalManager(workspaceModel.defaultTerminalCwd);
  registerIpcHandlers();
  broadcastTerminalData();
  startWorkspaceWatchers();
  await terminalManager.syncRuntimeContext();
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
    }
  });

  app.on("second-instance", () => {
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
  });
});

app.on("before-quit", () => {
  commandServer?.stop();
});

app.on("window-all-closed", () => {
  stopWorkspaceWatchers();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
