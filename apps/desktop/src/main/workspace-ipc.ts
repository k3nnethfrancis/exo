import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import type { WorkspaceModel, WorkspaceSettings } from "@exo/core";

import type { FileStatInfo, WorkspaceRegistryEntry } from "../shared/api";

export interface WorkspaceIpcHandlers {
  activateWorkspace: (workspaceId: string) => Promise<WorkspaceSettings>;
  createBranch: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<unknown>;
  createDirectory: (targetPath: string) => Promise<unknown>;
  createFile: (targetPath: string, content?: string) => Promise<unknown>;
  deletePath: (targetPath: string) => Promise<void>;
  embedIndex: () => Promise<unknown>;
  ensureTarget: (sourceFilePath: string, target: string) => Promise<string>;
  getAgentInstructionConfig: () => Promise<unknown>;
  getBranchFamily: (filePath: string) => Promise<unknown>;
  getGitStatus: (rootPath: string) => Promise<unknown>;
  getIndexStatus: () => Promise<unknown>;
  getKnowledge: (filePath: string) => Promise<unknown>;
  getMainWindow: () => BrowserWindow | null;
  getModel: () => WorkspaceModel;
  getRuntimeStatus: () => Promise<unknown> | unknown;
  getSettings: () => WorkspaceSettings;
  getSetupState: () => { complete: boolean; settingsPath: string };
  listAgentInstructionOverlays: () => Promise<unknown>;
  listTree: (rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number; includeEmptyDirectories?: boolean }) => Promise<unknown>;
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  readNote: (filePath: string) => Promise<unknown>;
  renamePath: (sourcePath: string, nextPath: string) => Promise<unknown>;
  resolveTarget: (sourceFilePath: string, target: string) => Promise<string | null>;
  saveAgentInstructionConfig: (input: { scopeId: "global" | "exocortex"; body: string }) => Promise<unknown>;
  saveNote: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<void>;
  saveSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
  searchIndex: (query: string, options?: { limit?: number; forceMode?: "lexical" | "semantic" | "hybrid" }) => Promise<unknown>;
  searchNotes: (query: string) => Promise<unknown>;
  searchTag: (tag: string) => Promise<unknown>;
  searchWorkspace: (query: string) => Promise<unknown>;
  statNote: (filePath: string) => Promise<FileStatInfo | null>;
  suggestTargets: (sourceFilePath: string, query: string) => Promise<unknown>;
  syncIndex: () => Promise<unknown>;
  syncRuntime: () => Promise<unknown>;
  updateIndex: () => Promise<unknown>;
}

export function registerWorkspaceIpcHandlers(handlers: WorkspaceIpcHandlers) {
  ipcMain.handle("workspace:get-model", async () => handlers.getModel());
  ipcMain.handle("workspace:get-settings", async () => handlers.getSettings());
  ipcMain.handle("workspace:get-setup-state", async () => handlers.getSetupState());
  ipcMain.handle("workspace:list-workspaces", async () => handlers.listWorkspaces());
  ipcMain.handle("workspace:activate-workspace", async (_event, workspaceId: string) => handlers.activateWorkspace(workspaceId));
  ipcMain.handle("workspace:get-index-status", async () => handlers.getIndexStatus());
  ipcMain.handle("workspace:index-sync", async () => handlers.syncIndex());
  ipcMain.handle("workspace:index-update", async () => handlers.updateIndex());
  ipcMain.handle("workspace:index-embed", async () => handlers.embedIndex());
  ipcMain.handle("workspace:save-settings", async (_event, settings: WorkspaceSettings) => handlers.saveSettings(settings));
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
      const mainWindow = handlers.getMainWindow();
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? [] : result.filePaths;
    },
  );
  ipcMain.handle("runtime:get-status", async () => handlers.getRuntimeStatus());
  ipcMain.handle("runtime:sync", async () => handlers.syncRuntime());
  ipcMain.handle(
    "workspace:list-tree",
    async (_event, rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number; includeEmptyDirectories?: boolean }) =>
      handlers.listTree(rootPath, options),
  );
  ipcMain.handle("workspace:search-notes", async (_event, query: string) => handlers.searchNotes(query));
  ipcMain.handle("workspace:search-workspace", async (_event, query: string) => handlers.searchWorkspace(query));
  ipcMain.handle(
    "workspace:search-index",
    async (_event, query: string, options?: { limit?: number; forceMode?: "lexical" | "semantic" | "hybrid" }) =>
      handlers.searchIndex(query, options),
  );
  ipcMain.handle("workspace:get-git-status", async (_event, rootPath: string) => handlers.getGitStatus(rootPath));
  ipcMain.handle("workspace:get-agent-instruction-config", async () => handlers.getAgentInstructionConfig());
  ipcMain.handle("workspace:save-agent-instruction-config", async (_event, input: { scopeId: "global" | "exocortex"; body: string }) =>
    handlers.saveAgentInstructionConfig(input),
  );
  ipcMain.handle("workspace:list-agent-instruction-overlays", async () => handlers.listAgentInstructionOverlays());
  ipcMain.handle("workspace:create-file", async (_event, targetPath: string, content?: string) => handlers.createFile(targetPath, content));
  ipcMain.handle("workspace:create-directory", async (_event, targetPath: string) => handlers.createDirectory(targetPath));
  ipcMain.handle("workspace:rename-path", async (_event, sourcePath: string, nextPath: string) => handlers.renamePath(sourcePath, nextPath));
  ipcMain.handle("workspace:delete-path", async (_event, targetPath: string) => handlers.deletePath(targetPath));
  ipcMain.handle("workspace:search-tag", async (_event, tag: string) => handlers.searchTag(tag));
  ipcMain.handle("notes:read", async (_event, filePath: string) => handlers.readNote(filePath));
  ipcMain.handle("notes:save", async (_event, filePath: string, frontmatter: Record<string, unknown>, body: string) =>
    handlers.saveNote(filePath, frontmatter, body),
  );
  ipcMain.handle("notes:stat", async (_event, filePath: string) => handlers.statNote(filePath));
  ipcMain.handle("notes:get-knowledge", async (_event, filePath: string) => handlers.getKnowledge(filePath));
  ipcMain.handle("notes:resolve-target", async (_event, sourceFilePath: string, target: string) => handlers.resolveTarget(sourceFilePath, target));
  ipcMain.handle("notes:ensure-target", async (_event, sourceFilePath: string, target: string) => handlers.ensureTarget(sourceFilePath, target));
  ipcMain.handle("notes:suggest-targets", async (_event, sourceFilePath: string, query: string) => handlers.suggestTargets(sourceFilePath, query));
  ipcMain.handle("notes:get-branch-family", async (_event, filePath: string) => handlers.getBranchFamily(filePath));
  ipcMain.handle("notes:create-branch", async (_event, filePath: string, frontmatter: Record<string, unknown>, body: string) =>
    handlers.createBranch(filePath, frontmatter, body),
  );
  ipcMain.handle("shell:open-external", async (_event, target: string) => shell.openExternal(target));
}
