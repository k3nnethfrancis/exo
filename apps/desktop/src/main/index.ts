import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { access } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
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
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  searchNotes,
  searchWorkspace,
  type SearchResult,
} from "@exo/core";
import type { TerminalCreateOptions } from "../shared/api";

import { TerminalManager } from "./terminal-manager";

const workspaceModel = resolveWorkspaceModel();
const terminalManager = new TerminalManager(workspaceModel.defaultTerminalCwd);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = resolvePreloadPath();
  const window = new BrowserWindow({
    width: 1680,
    height: 1060,
    minWidth: 1200,
    minHeight: 760,
    title: "Exo",
    backgroundColor: "#111318",
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

  mainWindow = window;
}

function resolvePreloadPath(): string {
  const candidatePaths = [path.join(currentDirectory, "../preload/index.js"), path.join(currentDirectory, "../preload/index.mjs")];
  const existing = candidatePaths.find((candidate) => existsSync(candidate));
  return existing ?? candidatePaths[0];
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
  ipcMain.handle(
    "workspace:list-tree",
    async (_event, rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number }) =>
    listRootTree(rootPath, options),
  );
  ipcMain.handle("workspace:search-notes", async (_event, query: string) => searchNotes(workspaceModel, query));
  ipcMain.handle("workspace:search-workspace", async (_event, query: string) => searchWorkspace(workspaceModel, query));
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

async function fileExists(targetPath: string): Promise<boolean> {
  return access(targetPath, constants.F_OK).then(
    () => true,
    () => false,
  );
}

app.whenReady().then(() => {
  registerIpcHandlers();
  broadcastTerminalData();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
