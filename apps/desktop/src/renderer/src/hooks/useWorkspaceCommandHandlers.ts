import { useEffect } from "react";
import type { WorkspaceModel } from "@exo/core";

interface UseWorkspaceCommandHandlersOptions {
  workspaceModel: WorkspaceModel | null;
  openFile: (filePath: string) => Promise<void>;
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
