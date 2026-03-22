import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi } from "../shared/api";

const api: DesktopApi = {
  workspace: {
    getModel: () => ipcRenderer.invoke("workspace:get-model"),
    getSettings: () => ipcRenderer.invoke("workspace:get-settings"),
    saveSettings: (settings) => ipcRenderer.invoke("workspace:save-settings", settings),
    listTree: (rootPath, options) => ipcRenderer.invoke("workspace:list-tree", rootPath, options),
    searchNotes: (query) => ipcRenderer.invoke("workspace:search-notes", query),
    searchWorkspace: (query) => ipcRenderer.invoke("workspace:search-workspace", query),
    searchTag: (tag) => ipcRenderer.invoke("workspace:search-tag", tag),
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
  },
  notes: {
    read: (filePath) => ipcRenderer.invoke("notes:read", filePath),
    save: (filePath, frontmatter, body) => ipcRenderer.invoke("notes:save", filePath, frontmatter, body),
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
    write: (id, data) => ipcRenderer.invoke("terminals:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("terminals:resize", id, cols, rows),
    kill: (id) => ipcRenderer.invoke("terminals:kill", id),
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
