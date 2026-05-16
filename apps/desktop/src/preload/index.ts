import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { DesktopApi } from "../shared/api";

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
    getModel: () => ipcRenderer.invoke("workspace:get-model"),
    getSettings: () => ipcRenderer.invoke("workspace:get-settings"),
    saveSettings: (settings) => ipcRenderer.invoke("workspace:save-settings", settings),
    getIndexStatus: () => ipcRenderer.invoke("workspace:get-index-status"),
    updateIndex: () => ipcRenderer.invoke("workspace:index-update"),
    embedIndex: () => ipcRenderer.invoke("workspace:index-embed"),
    listTree: (rootPath, options) => ipcRenderer.invoke("workspace:list-tree", rootPath, options),
    searchNotes: (query) => ipcRenderer.invoke("workspace:search-notes", query),
    searchWorkspace: (query) => ipcRenderer.invoke("workspace:search-workspace", query),
    searchTag: (tag) => ipcRenderer.invoke("workspace:search-tag", tag),
    getGitStatus: (rootPath) => ipcRenderer.invoke("workspace:get-git-status", rootPath),
    createFile: (targetPath, content) => ipcRenderer.invoke("workspace:create-file", targetPath, content),
    createDirectory: (targetPath) => ipcRenderer.invoke("workspace:create-directory", targetPath),
    renamePath: (sourcePath, nextPath) => ipcRenderer.invoke("workspace:rename-path", sourcePath, nextPath),
    deletePath: (targetPath) => ipcRenderer.invoke("workspace:delete-path", targetPath),
    onDidChange: (callback) => {
      const listener = (_event: unknown, payload: { rootPath: string; eventType: string; filePath: string | null }) =>
        callback(payload);
      ipcRenderer.on("workspace:changed", listener);
      return () => ipcRenderer.removeListener("workspace:changed", listener);
    },
    onCommandOpenFile: (callback) => {
      const listener = (_event: unknown, filePath: string) => callback(filePath);
      ipcRenderer.on("command:open-file", listener);
      return () => ipcRenderer.removeListener("command:open-file", listener);
    },
  },
  notes: {
    read: (filePath) => ipcRenderer.invoke("notes:read", filePath),
    save: (filePath, frontmatter, body) => ipcRenderer.invoke("notes:save", filePath, frontmatter, body),
    stat: (filePath) => ipcRenderer.invoke("notes:stat", filePath),
    getKnowledge: (filePath) => ipcRenderer.invoke("notes:get-knowledge", filePath),
    resolveTarget: (sourceFilePath, target) => ipcRenderer.invoke("notes:resolve-target", sourceFilePath, target),
    ensureTarget: (sourceFilePath, target) => ipcRenderer.invoke("notes:ensure-target", sourceFilePath, target),
    suggestTargets: (sourceFilePath, query) => ipcRenderer.invoke("notes:suggest-targets", sourceFilePath, query),
    getBranchFamily: (filePath) => ipcRenderer.invoke("notes:get-branch-family", filePath),
    createBranch: (filePath, frontmatter, body) => ipcRenderer.invoke("notes:create-branch", filePath, frontmatter, body),
  },
  terminals: {
    ensureDefault: () => ipcRenderer.invoke("terminals:ensure-default"),
    list: () => ipcRenderer.invoke("terminals:list"),
    create: (options) => ipcRenderer.invoke("terminals:create", options),
    read: (id) => ipcRenderer.invoke("terminals:read", id),
    readTranscript: (id, tailChars) => ipcRenderer.invoke("terminals:read-transcript", id, tailChars),
    write: (id, data) => ipcRenderer.invoke("terminals:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("terminals:resize", id, cols, rows),
    setStreaming: (ids) => ipcRenderer.invoke("terminals:set-streaming", ids),
    kill: (id) => ipcRenderer.invoke("terminals:kill", id),
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
    onData: (callback) => {
      const listener = (_event: unknown, payload: { id: string; data: string }) => callback(payload);
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
    openExternal: (target) => ipcRenderer.invoke("shell:open-external", target),
  },
};

contextBridge.exposeInMainWorld("exo", api);

function fileKey(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join("\0");
}
