import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import path from "node:path";
import { WorkspaceFiles, type WorkspaceModel } from "@exo/core";

import type { DesktopApi, FileStatInfo, WorkspaceRegistryEntry } from "../shared/api";
import { handleDesktopInvoke } from "./typed-ipc";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];

export interface WorkspaceIpcHandlers {
  activateWorkspace: WorkspaceApi["activateWorkspace"];
  createFolder: WorkspaceApi["createFolder"];
  createFile: WorkspaceApi["createFile"];
  deletePath: WorkspaceApi["deletePath"];
  embedIndex: WorkspaceApi["embedIndex"];
  ensureTarget: NotesApi["ensureTarget"];
  getIndexStatus: WorkspaceApi["getIndexStatus"];
  getFolderIndexStatus: WorkspaceApi["getFolderIndexStatus"];
  getFolderOverview: WorkspaceApi["getFolderOverview"];
  ensureFolderIndex: WorkspaceApi["ensureFolderIndex"];
  launchAgentInvocation: WorkspaceApi["launchAgentInvocation"];
  getAgentCommandTrust: WorkspaceApi["getAgentCommandTrust"];
  getAgentCommandLaunchFacts: WorkspaceApi["getAgentCommandLaunchFacts"];
  getAgentCommandContinuity: WorkspaceApi["getAgentCommandContinuity"];
  resetAgentCommandContinuity: WorkspaceApi["resetAgentCommandContinuity"];
  testAgentCommand: WorkspaceApi["testAgentCommand"];
  configureProviderMcp: WorkspaceApi["configureProviderMcp"];
  getCliInstallationStatus: WorkspaceApi["getCliInstallationStatus"];
  endAgentInvocation: WorkspaceApi["endAgentInvocation"];
  getInvocationReview: WorkspaceApi["getInvocationReview"];
  keepInvocationReview: WorkspaceApi["keepInvocationReview"];
  rejectInvocationReview: WorkspaceApi["rejectInvocationReview"];
  resumeInvocationInTerminal: WorkspaceApi["resumeInvocationInTerminal"];
  resolvePreviewTarget: WorkspaceApi["resolvePreviewTarget"];
  getGraphContext: NotesApi["getGraphContext"];
  getGraphView: NotesApi["getGraphView"];
  getGraphConceptDetail: NotesApi["getGraphConceptDetail"];
  getMainWindow: () => BrowserWindow | null;
  getModel: () => WorkspaceModel;
  getSettings: WorkspaceApi["getSettings"];
  getSetupState: WorkspaceApi["getSetupState"];
  markOnboardingComplete: WorkspaceApi["markOnboardingComplete"];
  listTree: WorkspaceApi["listTree"];
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  readNote: NotesApi["read"];
  renamePath: WorkspaceApi["renamePath"];
  resolveTarget: NotesApi["resolveTarget"];
  resolveMarkdownImage: NotesApi["resolveMarkdownImage"];
  saveNote: NotesApi["save"];
  saveSettings: WorkspaceApi["saveSettings"];
  searchIndex: WorkspaceApi["searchIndex"];
  searchNotes: WorkspaceApi["searchNotes"];
  searchTag: WorkspaceApi["searchTag"];
  searchWorkspace: WorkspaceApi["searchWorkspace"];
  statNote: (filePath: string) => Promise<FileStatInfo | null>;
  suggestTargets: NotesApi["suggestTargets"];
  syncIndex: WorkspaceApi["syncIndex"];
  updateIndex: WorkspaceApi["updateIndex"];
}

export function registerWorkspaceIpcHandlers(handlers: WorkspaceIpcHandlers) {
  const workspaceFiles = () => new WorkspaceFiles(handlers.getModel().noteRoots.map((root) => root.path));

  handleDesktopInvoke("workspace:get-model", async () => handlers.getModel());
  handleDesktopInvoke("workspace:get-settings", async () => handlers.getSettings());
  handleDesktopInvoke("workspace:get-setup-state", async () => handlers.getSetupState());
  handleDesktopInvoke("workspace:mark-onboarding-complete", async () => handlers.markOnboardingComplete());
  handleDesktopInvoke("workspace:list-workspaces", async () => handlers.listWorkspaces());
  handleDesktopInvoke("workspace:activate-workspace", async (_event, input) => handlers.activateWorkspace(input));
  handleDesktopInvoke("workspace:get-index-status", async () => handlers.getIndexStatus());
  handleDesktopInvoke("workspace:get-folder-index-status", async () => handlers.getFolderIndexStatus());
  handleDesktopInvoke("workspace:get-folder-overview", async (_event, directoryPath) => {
    const authorizedDirectory = await workspaceFiles().existing(directoryPath);
    return handlers.getFolderOverview(authorizedDirectory);
  });
  handleDesktopInvoke("workspace:resolve-preview-target", async (_event, target) => handlers.resolvePreviewTarget(target));
  handleDesktopInvoke("workspace:launch-agent-invocation", async (_event, input) => {
    const documentPath = await workspaceFiles().existing(input.documentPath);
    return handlers.launchAgentInvocation({ ...input, documentPath });
  });
  handleDesktopInvoke("workspace:get-agent-command-trust", async (_event, handle) => handlers.getAgentCommandTrust(handle));
  handleDesktopInvoke("workspace:get-agent-command-launch-facts", async (_event, commandId) =>
    handlers.getAgentCommandLaunchFacts(commandId),
  );
  handleDesktopInvoke("workspace:get-agent-command-continuity", async (_event, commandId) => handlers.getAgentCommandContinuity(commandId));
  handleDesktopInvoke("workspace:reset-agent-command-continuity", async (_event, commandId) => handlers.resetAgentCommandContinuity(commandId));
  handleDesktopInvoke("workspace:test-agent-command", async (_event, input) => handlers.testAgentCommand(input));
  handleDesktopInvoke("workspace:configure-provider-mcp", async (_event, input) => handlers.configureProviderMcp(input));
  handleDesktopInvoke("workspace:get-cli-installation-status", async () => handlers.getCliInstallationStatus());
  handleDesktopInvoke("workspace:end-agent-invocation", async (_event, invocationId) => handlers.endAgentInvocation(invocationId));
  handleDesktopInvoke("workspace:get-invocation-review", async (_event, invocationId) => handlers.getInvocationReview(invocationId));
  handleDesktopInvoke("workspace:keep-invocation-review", async (_event, invocationId) => handlers.keepInvocationReview(invocationId));
  handleDesktopInvoke("workspace:reject-invocation-review", async (_event, input) => handlers.rejectInvocationReview(input));
  handleDesktopInvoke("workspace:resume-invocation-in-terminal", async (_event, invocationId) => handlers.resumeInvocationInTerminal(invocationId));
  handleDesktopInvoke("workspace:index-sync", async () => handlers.syncIndex());
  handleDesktopInvoke("workspace:index-update", async () => handlers.updateIndex());
  handleDesktopInvoke("workspace:index-embed", async () => handlers.embedIndex());
  handleDesktopInvoke("workspace:save-settings", async (_event, request) => handlers.saveSettings(request));
  handleDesktopInvoke(
    "workspace:select-folder",
    async (_event, options) => {
      if (process.env.EXO_TEST === "1" && process.env.EXO_TEST_SELECT_FOLDER_CANCEL === "1") {
        return [];
      }
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
  handleDesktopInvoke("workspace:create-file", async (_event, targetPath, content) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.createFile(authorizedPath, content);
  });
  handleDesktopInvoke("workspace:create-folder", async (_event, targetPath) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.createFolder(authorizedPath);
  });
  handleDesktopInvoke("workspace:ensure-folder-index", async (_event, directoryPath) => {
    const files = workspaceFiles();
    const authorizedDirectory = await files.existing(directoryPath);
    await files.writable(path.join(authorizedDirectory, "index.md"));
    return handlers.ensureFolderIndex(authorizedDirectory);
  });
  handleDesktopInvoke("workspace:rename-path", async (_event, sourcePath, nextPath) => {
    const files = workspaceFiles();
    const [authorizedSourcePath, authorizedNextPath] = await Promise.all([
      files.writable(sourcePath),
      files.writable(nextPath),
    ]);
    return handlers.renamePath(authorizedSourcePath, authorizedNextPath);
  });
  handleDesktopInvoke("workspace:delete-path", async (_event, targetPath) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.deletePath(authorizedPath);
  });
  handleDesktopInvoke("workspace:search-tag", async (_event, tag) => handlers.searchTag(tag));
  handleDesktopInvoke("notes:read", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().existing(filePath);
    return handlers.readNote(authorizedPath);
  });
  handleDesktopInvoke("notes:save", async (_event, filePath, frontmatter, body) => {
    const authorizedPath = await workspaceFiles().writable(filePath);
    return handlers.saveNote(authorizedPath, frontmatter, body);
  });
  handleDesktopInvoke("notes:stat", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().writable(filePath);
    return handlers.statNote(authorizedPath);
  });
  handleDesktopInvoke("notes:get-graph-context", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().existing(filePath);
    return handlers.getGraphContext(authorizedPath);
  });
  handleDesktopInvoke("notes:get-graph-view", async (_event, profileId) => handlers.getGraphView(profileId));
  handleDesktopInvoke("notes:get-graph-concept-detail", async (_event, conceptId, sourceSnapshotId, profileId) =>
    handlers.getGraphConceptDetail(conceptId, sourceSnapshotId, profileId),
  );
  handleDesktopInvoke("notes:resolve-target", async (_event, sourceFilePath, target) => handlers.resolveTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:resolve-markdown-image", async (_event, sourceFilePath, target) =>
    handlers.resolveMarkdownImage(sourceFilePath, target),
  );
  handleDesktopInvoke("notes:ensure-target", async (_event, sourceFilePath, target) => handlers.ensureTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:suggest-targets", async (_event, sourceFilePath, query) => handlers.suggestTargets(sourceFilePath, query));
  handleDesktopInvoke("shell:open-external", async (_event, target) => shell.openExternal(target));
  handleDesktopInvoke("shell:focus-window", async () => {
    const window = handlers.getMainWindow();
    window?.focus();
    window?.webContents.focus();
  });
}
