import { useEffect } from "react";
import type { WorkspaceModel } from "@exo/core";
import type { WorkspaceSettingsSection } from "../../../shared/api";

interface UseWorkspaceCommandHandlersOptions {
  workspaceModel: WorkspaceModel | null;
  openFile: (filePath: string) => Promise<void>;
  openPreview: (url: string) => void;
  focusPreview: () => void;
  closePreview: () => void;
  openSettings: (section: WorkspaceSettingsSection) => Promise<void>;
  reloadTrees: () => Promise<void>;
  scheduleOpenDocumentRefresh: (filePath: string) => void;
  recordObservedWorkspaceWrite: (rootPath: string, filePath: string) => void;
  refreshProjectGitStatus: (model: WorkspaceModel) => Promise<void>;
}

export function useWorkspaceCommandHandlers(options: UseWorkspaceCommandHandlersOptions) {
  useEffect(() => {
    return window.exo.workspace.onCommandOpenFile((filePath: string) => {
      void options.openFile(filePath);
    });
  }, [options.openFile]);

  useEffect(() => {
    return window.exo.workspace.onCommandOpenPreview((event) => {
      options.openPreview(event.url);
    });
  }, [options.openPreview]);

  useEffect(() => {
    return window.exo.workspace.onCommandFocusPreview(() => {
      options.focusPreview();
    });
  }, [options.focusPreview]);

  useEffect(() => {
    return window.exo.workspace.onCommandClosePreview(() => {
      options.closePreview();
    });
  }, [options.closePreview]);

  useEffect(() => {
    return window.exo.workspace.onCommandOpenSettings((event) => {
      void options.openSettings(event.section);
    });
  }, [options.openSettings]);

  useEffect(() => {
    const removeWorkspaceChangeListener = window.exo.workspace.onDidChange((event) => {
      if (event.eventType === "rename" || !event.filePath) {
        void options.reloadTrees();
      }
      if (event.filePath) {
        const filePath = event.filePath;
        options.scheduleOpenDocumentRefresh(filePath);
        options.recordObservedWorkspaceWrite(event.rootPath, filePath);
        if (options.workspaceModel?.projectRoots.some((root) => isPathWithin(root.path, filePath))) {
          void options.refreshProjectGitStatus(options.workspaceModel);
        }
      }
    });

    return () => {
      removeWorkspaceChangeListener();
    };
  }, [
    options.workspaceModel,
    options.reloadTrees,
    options.scheduleOpenDocumentRefresh,
    options.recordObservedWorkspaceWrite,
    options.refreshProjectGitStatus,
  ]);
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}
