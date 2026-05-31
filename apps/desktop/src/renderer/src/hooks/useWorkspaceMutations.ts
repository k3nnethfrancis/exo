import { useState } from "react";
import type { WorkspaceModel } from "@exo/core";

import type { PaneNodeId } from "./usePaneTree";
import { directoryOf, pathLabel } from "../workspaceTree";

export type WorkspaceDialogState =
  | {
      kind: "create-file";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "create-directory";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "rename";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "delete";
      targetPath: string;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "move-conflict";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "attach-project";
      title: string;
      message: string;
      confirmLabel: string;
    };

interface UseWorkspaceMutationsOptions {
  workspaceModel: WorkspaceModel | null;
  activeDocumentPath: string | null;
  editorFocusedLeafId: PaneNodeId;
  reloadTrees: () => Promise<void>;
  openFile: (filePath: string, leafId?: PaneNodeId) => Promise<void>;
  openWorkspaceSettings: () => Promise<void>;
  remapOpenPaths: (sourcePath: string, nextPath: string) => void;
  removeDeletedPaths: (targetPath: string) => void;
  setActiveDocumentPath: (filePath: string | null) => void;
  resolveActiveEditorPathAfterDelete: () => string | null;
  revealExplorerPath: (path: string) => void;
}

export function useWorkspaceMutations(options: UseWorkspaceMutationsOptions) {
  const [dialog, setDialog] = useState<WorkspaceDialogState | null>(null);

  function createFileInDirectory(directoryPath: string) {
    if (!options.workspaceModel) {
      return;
    }

    const noteRootPaths = options.workspaceModel.noteRoots.map((root) => root.path);
    const suggested = isInsideAttachedRoot(directoryPath, noteRootPaths) ? "new-note.md" : "new-file.txt";
    setDialog({
      kind: "create-file",
      targetPath: directoryPath,
      value: suggested,
      title: "Create file",
      confirmLabel: "Create",
    });
  }

  async function commitCreateFile(directoryPath: string, name: string) {
    if (!options.workspaceModel) {
      return;
    }

    const noteRootPaths = options.workspaceModel.noteRoots.map((root) => root.path);
    const nextPath = await window.exo.workspace.createFile(
      joinPath(directoryPath, ensureDefaultExtension(name, directoryPath, noteRootPaths)),
    );
    await options.reloadTrees();
    await options.openFile(nextPath, options.editorFocusedLeafId);
  }

  function createDirectoryInDirectory(directoryPath: string) {
    setDialog({
      kind: "create-directory",
      targetPath: directoryPath,
      value: "new-folder",
      title: "Create folder",
      confirmLabel: "Create",
    });
  }

  async function commitCreateDirectory(directoryPath: string, name: string) {
    await window.exo.workspace.createDirectory(joinPath(directoryPath, name));
    await options.reloadTrees();
  }

  function renameWorkspacePath(sourcePath: string) {
    const currentName = sourcePath.split("/").at(-1) ?? sourcePath;
    setDialog({
      kind: "rename",
      targetPath: sourcePath,
      value: currentName,
      title: "Rename",
      confirmLabel: "Rename",
    });
  }

  async function commitRenameWorkspacePath(sourcePath: string, nextName: string) {
    const currentName = sourcePath.split("/").at(-1) ?? sourcePath;
    if (!nextName || nextName === currentName) {
      return;
    }
    const nextPath = joinPath(directoryOf(sourcePath), nextName);
    const previousPath = sourcePath;
    await window.exo.workspace.renamePath(sourcePath, nextPath);
    options.remapOpenPaths(previousPath, nextPath);
    await options.reloadTrees();
    if (previousPath === options.activeDocumentPath) {
      await options.openFile(nextPath, options.editorFocusedLeafId);
    }
  }

  async function moveWorkspacePathIntoDirectory(sourcePath: string, targetDirectoryPath: string) {
    const sourceLabel = pathLabel(sourcePath);
    const targetLabel = pathLabel(targetDirectoryPath);
    if (sourcePath === targetDirectoryPath) {
      return;
    }
    if (directoryOf(sourcePath) === targetDirectoryPath) {
      return;
    }
    if (isPathWithin(sourcePath, targetDirectoryPath)) {
      return;
    }

    const nextPath = joinPath(targetDirectoryPath, sourceLabel);
    try {
      await window.exo.workspace.renamePath(sourcePath, nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Destination already exists")) {
        setDialog({
          kind: "move-conflict",
          title: "Destination already exists",
          message: `${sourceLabel} cannot be moved into ${targetLabel} because ${pathLabel(nextPath)} already exists there. Exo will not merge or overwrite folders automatically.`,
          confirmLabel: "OK",
        });
      }
      throw error;
    }
    options.remapOpenPaths(sourcePath, nextPath);
    await options.reloadTrees();
    options.revealExplorerPath(targetDirectoryPath);
    if (sourcePath === options.activeDocumentPath) {
      await options.openFile(nextPath, options.editorFocusedLeafId);
    }
  }

  function deleteWorkspacePath(targetPath: string) {
    setDialog({
      kind: "delete",
      targetPath,
      title: "Delete path",
      message: `Delete ${targetPath.split("/").at(-1) ?? targetPath}?`,
      confirmLabel: "Delete",
    });
  }

  async function commitDeleteWorkspacePath(targetPath: string) {
    await window.exo.workspace.deletePath(targetPath);
    options.removeDeletedPaths(targetPath);
    if (options.activeDocumentPath && isPathWithin(targetPath, options.activeDocumentPath)) {
      options.setActiveDocumentPath(options.resolveActiveEditorPathAfterDelete());
    }
    await options.reloadTrees();
  }

  function showAttachProjectDialog() {
    setDialog({
      kind: "attach-project",
      title: "Attach project to review changes",
      message: "Changed files belong to a folder that is not attached to this workspace. Attach or import the project before opening its changed files.",
      confirmLabel: "Open Settings",
    });
  }

  async function submitDialog() {
    if (!dialog) {
      return;
    }

    if (dialog.kind === "move-conflict") {
      setDialog(null);
      return;
    }

    if (dialog.kind === "attach-project") {
      setDialog(null);
      await options.openWorkspaceSettings();
      return;
    }

    if (dialog.kind === "delete") {
      await commitDeleteWorkspacePath(dialog.targetPath);
      setDialog(null);
      return;
    }

    const value = dialog.value.trim();
    if (!value) {
      return;
    }

    if (dialog.kind === "create-file") {
      await commitCreateFile(dialog.targetPath, value);
    } else if (dialog.kind === "create-directory") {
      await commitCreateDirectory(dialog.targetPath, value);
    } else {
      await commitRenameWorkspacePath(dialog.targetPath, value);
    }

    setDialog(null);
  }

  return {
    dialog,
    setDialog,
    createFileInDirectory,
    createDirectoryInDirectory,
    renameWorkspacePath,
    deleteWorkspacePath,
    moveWorkspacePathIntoDirectory,
    showAttachProjectDialog,
    submitDialog,
  };
}

function joinPath(parentPath: string, name: string): string {
  return `${parentPath.replace(/\/$/, "")}/${name.replace(/^\//, "")}`;
}

function isInsideAttachedRoot(targetPath: string, rootPaths: string[]): boolean {
  return rootPaths.some((rootPath) => isPathWithin(rootPath, targetPath));
}

function ensureDefaultExtension(name: string, directoryPath: string, noteRootPaths: string[]): string {
  if (name.includes(".")) {
    return name;
  }

  return isInsideAttachedRoot(directoryPath, noteRootPaths) ? `${name}.md` : name;
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}
