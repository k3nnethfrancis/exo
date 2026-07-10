import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import path from "node:path";
import type { WorkspaceModel, WorkspaceSettings } from "@exo/core";

import type { DesktopApi, FileStatInfo, WorkspaceRegistryEntry } from "../shared/api";
import { handleDesktopInvoke } from "./typed-ipc";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];

export interface WorkspaceIpcHandlers {
  activateWorkspace: WorkspaceApi["activateWorkspace"];
  createBranch: NotesApi["createBranch"];
  createDirectory: WorkspaceApi["createDirectory"];
  createFile: WorkspaceApi["createFile"];
  deletePath: WorkspaceApi["deletePath"];
  embedIndex: WorkspaceApi["embedIndex"];
  ensureTarget: NotesApi["ensureTarget"];
  getAgentInstructionConfig: WorkspaceApi["getAgentInstructionConfig"];
  getBranchFamily: NotesApi["getBranchFamily"];
  getIndexStatus: WorkspaceApi["getIndexStatus"];
  launchAgentInvocation: WorkspaceApi["launchAgentInvocation"];
  endAgentInvocation: WorkspaceApi["endAgentInvocation"];
  resolvePreviewTarget: WorkspaceApi["resolvePreviewTarget"];
  getKnowledge: NotesApi["getKnowledge"];
  getMainWindow: () => BrowserWindow | null;
  getModel: () => WorkspaceModel;
  getRuntimeStatus: () => Promise<unknown> | unknown;
  getSettings: () => WorkspaceSettings;
  getSetupState: WorkspaceApi["getSetupState"];
  markOnboardingComplete: WorkspaceApi["markOnboardingComplete"];
  listAgentInstructionOverlays: WorkspaceApi["listAgentInstructionOverlays"];
  listTree: WorkspaceApi["listTree"];
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  readNote: NotesApi["read"];
  renamePath: WorkspaceApi["renamePath"];
  resolveTarget: NotesApi["resolveTarget"];
  applyGlobalExographContext: WorkspaceApi["applyGlobalExographContext"];
  syncAgentInstructionFilesFromProvider: WorkspaceApi["syncAgentInstructionFilesFromProvider"];
  saveAgentInstructionConfig: WorkspaceApi["saveAgentInstructionConfig"];
  saveNote: NotesApi["save"];
  saveSettings: WorkspaceApi["saveSettings"];
  searchIndex: WorkspaceApi["searchIndex"];
  searchNotes: WorkspaceApi["searchNotes"];
  searchTag: WorkspaceApi["searchTag"];
  searchWorkspace: WorkspaceApi["searchWorkspace"];
  statNote: (filePath: string) => Promise<FileStatInfo | null>;
  suggestTargets: NotesApi["suggestTargets"];
  syncIndex: WorkspaceApi["syncIndex"];
  syncRuntime: () => Promise<unknown>;
  updateIndex: WorkspaceApi["updateIndex"];
}

export function registerWorkspaceIpcHandlers(handlers: WorkspaceIpcHandlers) {
  handleDesktopInvoke("workspace:get-model", async () => handlers.getModel());
  handleDesktopInvoke("workspace:get-settings", async () => handlers.getSettings());
  handleDesktopInvoke("workspace:get-setup-state", async () => handlers.getSetupState());
  handleDesktopInvoke("workspace:mark-onboarding-complete", async () => handlers.markOnboardingComplete());
  handleDesktopInvoke("workspace:list-workspaces", async () => handlers.listWorkspaces());
  handleDesktopInvoke("workspace:activate-workspace", async (_event, workspaceId) => handlers.activateWorkspace(workspaceId));
  handleDesktopInvoke("workspace:get-index-status", async () => handlers.getIndexStatus());
  handleDesktopInvoke("workspace:resolve-preview-target", async (_event, target) => handlers.resolvePreviewTarget(target));
  handleDesktopInvoke("workspace:launch-agent-invocation", async (_event, input) => handlers.launchAgentInvocation(input));
  handleDesktopInvoke("workspace:end-agent-invocation", async (_event, invocationId) => handlers.endAgentInvocation(invocationId));
  handleDesktopInvoke("workspace:index-sync", async () => handlers.syncIndex());
  handleDesktopInvoke("workspace:index-update", async () => handlers.updateIndex());
  handleDesktopInvoke("workspace:index-embed", async () => handlers.embedIndex());
  handleDesktopInvoke("workspace:save-settings", async (_event, settings) => handlers.saveSettings(settings));
  handleDesktopInvoke(
    "workspace:select-folder",
    async (_event, options) => {
      if (process.env.EXO_TEST === "1" && process.env.EXO_TEST_SELECT_FOLDER_PATH) {
        return options?.allowMultiple
          ? process.env.EXO_TEST_SELECT_FOLDER_PATH.split(path.delimiter).filter(Boolean)
          : [process.env.EXO_TEST_SELECT_FOLDER_PATH];
      }

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
  handleDesktopInvoke("runtime:get-status", async () => handlers.getRuntimeStatus());
  handleDesktopInvoke("runtime:sync", async () => handlers.syncRuntime());
  handleDesktopInvoke(
    "workspace:list-tree",
    async (_event, rootPath, options) =>
      handlers.listTree(rootPath, options),
  );
  handleDesktopInvoke("workspace:search-notes", async (_event, query) => handlers.searchNotes(query));
  handleDesktopInvoke("workspace:search-workspace", async (_event, query) => handlers.searchWorkspace(query));
  handleDesktopInvoke(
    "workspace:search-index",
    async (_event, query, options) =>
      handlers.searchIndex(query, options),
  );
  handleDesktopInvoke("workspace:get-agent-instruction-config", async () => handlers.getAgentInstructionConfig());
  handleDesktopInvoke("workspace:save-agent-instruction-config", async (_event, input) =>
    handlers.saveAgentInstructionConfig(input),
  );
  handleDesktopInvoke("workspace:sync-agent-instruction-files-from-provider", async (_event, input) =>
    handlers.syncAgentInstructionFilesFromProvider(input),
  );
  handleDesktopInvoke("workspace:apply-global-exograph-context", async (_event, input) =>
    handlers.applyGlobalExographContext(input),
  );
  handleDesktopInvoke("workspace:list-agent-instruction-overlays", async () => handlers.listAgentInstructionOverlays());
  handleDesktopInvoke("workspace:create-file", async (_event, targetPath, content) => handlers.createFile(targetPath, content));
  handleDesktopInvoke("workspace:create-directory", async (_event, targetPath) => handlers.createDirectory(targetPath));
  handleDesktopInvoke("workspace:rename-path", async (_event, sourcePath, nextPath) => handlers.renamePath(sourcePath, nextPath));
  handleDesktopInvoke("workspace:delete-path", async (_event, targetPath) => handlers.deletePath(targetPath));
  handleDesktopInvoke("workspace:search-tag", async (_event, tag) => handlers.searchTag(tag));
  handleDesktopInvoke("notes:read", async (_event, filePath) => handlers.readNote(filePath));
  handleDesktopInvoke("notes:save", async (_event, filePath, frontmatter, body) =>
    handlers.saveNote(filePath, frontmatter, body),
  );
  handleDesktopInvoke("notes:stat", async (_event, filePath) => handlers.statNote(filePath));
  handleDesktopInvoke("notes:get-knowledge", async (_event, filePath) => handlers.getKnowledge(filePath));
  handleDesktopInvoke("notes:resolve-target", async (_event, sourceFilePath, target) => handlers.resolveTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:ensure-target", async (_event, sourceFilePath, target) => handlers.ensureTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:suggest-targets", async (_event, sourceFilePath, query) => handlers.suggestTargets(sourceFilePath, query));
  handleDesktopInvoke("notes:get-branch-family", async (_event, filePath) => handlers.getBranchFamily(filePath));
  handleDesktopInvoke("notes:create-branch", async (_event, filePath, frontmatter, body) =>
    handlers.createBranch(filePath, frontmatter, body),
  );
  handleDesktopInvoke("shell:open-external", async (_event, target) => shell.openExternal(target));
  handleDesktopInvoke("shell:focus-window", async () => {
    const window = handlers.getMainWindow();
    window?.focus();
    window?.webContents.focus();
  });
}
