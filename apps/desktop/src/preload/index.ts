import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopApi } from "../shared/api";
import { invokeDesktop } from "./typed-ipc";

const droppedFilePathsByKey = new Map<string, string>();

window.addEventListener(
  "drop",
  (event) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    for (const file of files) {
      const filePath = webUtils.getPathForFile(file);
      if (filePath) {
        droppedFilePathsByKey.set(fileKey(file), filePath);
      }
    }

    while (droppedFilePathsByKey.size > 100) {
      const firstKey = droppedFilePathsByKey.keys().next().value;
      if (!firstKey) break;
      droppedFilePathsByKey.delete(firstKey);
    }
  },
  true,
);

const api: DesktopApi = {
  workspace: {
    getModel: () => invokeDesktop("workspace:get-model"),
    getSettings: () => invokeDesktop("workspace:get-settings"),
    getSetupState: () => invokeDesktop("workspace:get-setup-state"),
    markOnboardingComplete: () => invokeDesktop("workspace:mark-onboarding-complete"),
    listWorkspaces: () => invokeDesktop("workspace:list-workspaces"),
    activateWorkspace: (input) => invokeDesktop("workspace:activate-workspace", input),
    saveSettings: (request) => invokeDesktop("workspace:save-settings", request),
    selectFolder: (options) => invokeDesktop("workspace:select-folder", options),
    getIndexStatus: () => invokeDesktop("workspace:get-index-status"),
    resolvePreviewTarget: (target) => invokeDesktop("workspace:resolve-preview-target", target),
    launchAgentInvocation: (input) => invokeDesktop("workspace:launch-agent-invocation", input),
    getAgentCommandTrust: (handle) => invokeDesktop("workspace:get-agent-command-trust", handle),
    getAgentCommandLaunchFacts: (commandId) => invokeDesktop("workspace:get-agent-command-launch-facts", commandId),
    testAgentCommand: (input) => invokeDesktop("workspace:test-agent-command", input),
    endAgentInvocation: (invocationId) => invokeDesktop("workspace:end-agent-invocation", invocationId),
    getInvocationReview: (invocationId) => invokeDesktop("workspace:get-invocation-review", invocationId),
    keepInvocationReview: (invocationId) => invokeDesktop("workspace:keep-invocation-review", invocationId),
    rejectInvocationReview: (input) => invokeDesktop("workspace:reject-invocation-review", input),
    resumeInvocationInTerminal: (invocationId) => invokeDesktop("workspace:resume-invocation-in-terminal", invocationId),
    onInvocationUpdated: (callback) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on("workspace:invocation-updated", listener);
      return () => ipcRenderer.removeListener("workspace:invocation-updated", listener);
    },
    syncIndex: () => invokeDesktop("workspace:index-sync"),
    updateIndex: () => invokeDesktop("workspace:index-update"),
    embedIndex: () => invokeDesktop("workspace:index-embed"),
    listTree: (rootPath, options) => invokeDesktop("workspace:list-tree", rootPath, options),
    searchNotes: (query) => invokeDesktop("workspace:search-notes", query),
    searchWorkspace: (query) => invokeDesktop("workspace:search-workspace", query),
    searchIndex: (query, options) => invokeDesktop("workspace:search-index", query, options),
    searchTag: (tag) => invokeDesktop("workspace:search-tag", tag),
    getFolderIndexStatus: () => invokeDesktop("workspace:get-folder-index-status"),
    getFolderOverview: (directoryPath) => invokeDesktop("workspace:get-folder-overview", directoryPath),
    ensureFolderIndex: (directoryPath) => invokeDesktop("workspace:ensure-folder-index", directoryPath),
    createFile: (targetPath, content) => invokeDesktop("workspace:create-file", targetPath, content),
    createFolder: (targetPath) => invokeDesktop("workspace:create-folder", targetPath),
    renamePath: (sourcePath, nextPath) => invokeDesktop("workspace:rename-path", sourcePath, nextPath),
    deletePath: (targetPath) => invokeDesktop("workspace:delete-path", targetPath),
    onDidChange: (callback) => {
      const listener = (_event: unknown, payload: { rootPath: string; eventType: string; filePath: string | null }) =>
        callback(payload);
      ipcRenderer.on("workspace:changed", listener);
      return () => ipcRenderer.removeListener("workspace:changed", listener);
    },
    onIndexSyncState: (callback) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on("workspace:index-sync-state", listener);
      return () => ipcRenderer.removeListener("workspace:index-sync-state", listener);
    },
    onCommandOpenFile: (callback) => {
      const listener = (_event: unknown, filePath: string) => callback(filePath);
      ipcRenderer.on("command:open-file", listener);
      return () => ipcRenderer.removeListener("command:open-file", listener);
    },
    onCommandOpenPreview: (callback) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on("command:open-preview", listener);
      return () => ipcRenderer.removeListener("command:open-preview", listener);
    },
    onCommandFocusPreview: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("command:focus-preview", listener);
      return () => ipcRenderer.removeListener("command:focus-preview", listener);
    },
    onCommandClosePreview: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("command:close-preview", listener);
      return () => ipcRenderer.removeListener("command:close-preview", listener);
    },
    onCommandOpenSettings: (callback) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on("command:open-settings", listener);
      return () => ipcRenderer.removeListener("command:open-settings", listener);
    },
  },
  notes: {
    read: (filePath) => invokeDesktop("notes:read", filePath),
    save: (filePath, frontmatter, body) => invokeDesktop("notes:save", filePath, frontmatter, body),
    stat: (filePath) => invokeDesktop("notes:stat", filePath),
    getGraphContext: (filePath) => invokeDesktop("notes:get-graph-context", filePath),
    resolveTarget: (sourceFilePath, target) => invokeDesktop("notes:resolve-target", sourceFilePath, target),
    resolveMarkdownImage: (sourceFilePath, target) => invokeDesktop("notes:resolve-markdown-image", sourceFilePath, target),
    ensureTarget: (sourceFilePath, target) => invokeDesktop("notes:ensure-target", sourceFilePath, target),
    suggestTargets: (sourceFilePath, query) => invokeDesktop("notes:suggest-targets", sourceFilePath, query),
  },
  terminals: {
    ensureDefault: () => invokeDesktop("terminals:ensure-default"),
    list: () => invokeDesktop("terminals:list"),
    create: (options) => invokeDesktop("terminals:create", options),
    read: (id, options) => invokeDesktop("terminals:read", id, options),
    write: (id, data) => invokeDesktop("terminals:write", id, data),
    sendMessage: (id, message, submit) => invokeDesktop("terminals:send-message", id, message, submit),
    resize: (id, cols, rows) => invokeDesktop("terminals:resize", id, cols, rows),
    kill: (id) => invokeDesktop("terminals:kill", id),
    resolveDroppedFilePaths: (files) =>
      files
        .map((file) => webUtils.getPathForFile(file) || droppedFilePathsByKey.get(fileKey(file)) || "")
        .filter((filePath): filePath is string => filePath.length > 0),
    onCreated: (callback) => {
      const listener = (_event: unknown, session: Awaited<ReturnType<DesktopApi["terminals"]["create"]>>) =>
        callback(session);
      ipcRenderer.on("terminal:created", listener);
      return () => ipcRenderer.removeListener("terminal:created", listener);
    },
    onUpdated: (callback) => {
      const listener = (_event: unknown, session: Awaited<ReturnType<DesktopApi["terminals"]["create"]>>) =>
        callback(session);
      ipcRenderer.on("terminal:updated", listener);
      return () => ipcRenderer.removeListener("terminal:updated", listener);
    },
    onData: (callback) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (callback) => {
      const listener = (_event: unknown, payload: { id: string; exitCode?: number }) => callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
  },
  shell: {
    openExternal: (target) => invokeDesktop("shell:open-external", target),
    focusWindow: () => invokeDesktop("shell:focus-window"),
  },
};

contextBridge.exposeInMainWorld("exo", api);

function fileKey(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join("\0");
}
