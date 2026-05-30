import { useRef, useState } from "react";
import type { TreeNode, WorkspaceModel } from "@exo/core";

import {
  replaceTreeChildrenInRoots,
  treeDirectoryHasChildrenInRoots,
  treeLoadKey,
} from "../workspaceTree";

export interface UseWorkspaceTreesOptions {
  noteTreeMaxDepth: number;
  projectTreeMaxDepth: number;
}

export function useWorkspaceTrees(options: UseWorkspaceTreesOptions) {
  const [noteTrees, setNoteTrees] = useState<Record<string, TreeNode[]>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, TreeNode[]>>({});
  const loadedTreeDirectoriesRef = useRef<Set<string>>(new Set());

  function replaceTreesForModel(
    model: WorkspaceModel,
    nextNoteTrees: Record<string, TreeNode[]>,
    nextProjectTrees: Record<string, TreeNode[]>,
  ): void {
    setNoteTrees(nextNoteTrees);
    setProjectTrees(nextProjectTrees);
    loadedTreeDirectoriesRef.current = loadedRootKeys(model);
  }

  async function reloadTreesForModel(model: WorkspaceModel): Promise<void> {
    const [nextNoteTrees, nextProjectTrees] = await loadInitialTrees(model, options);
    replaceTreesForModel(model, nextNoteTrees, nextProjectTrees);
  }

  async function expandTreeDirectory(directoryPath: string, rootKind: "notes" | "projects"): Promise<void> {
    const loadKey = treeLoadKey(rootKind, directoryPath);
    if (loadedTreeDirectoriesRef.current.has(loadKey)) {
      return;
    }
    const currentTrees = rootKind === "notes" ? noteTrees : projectTrees;
    if (treeDirectoryHasChildrenInRoots(currentTrees, directoryPath)) {
      loadedTreeDirectoriesRef.current.add(loadKey);
      return;
    }
    loadedTreeDirectoriesRef.current.add(loadKey);

    const children = await window.exo.workspace.listTree(directoryPath, {
      markdownOnly: rootKind === "notes",
      maxDepth: 1,
      includeEmptyDirectories: rootKind === "notes",
    });

    if (rootKind === "notes") {
      setNoteTrees((current) => replaceTreeChildrenInRoots(current, directoryPath, children));
    } else {
      setProjectTrees((current) => replaceTreeChildrenInRoots(current, directoryPath, children));
    }
  }

  return {
    noteTrees,
    projectTrees,
    replaceTreesForModel,
    reloadTreesForModel,
    expandTreeDirectory,
  };
}

export async function loadInitialTrees(
  model: WorkspaceModel,
  options: UseWorkspaceTreesOptions,
): Promise<[Record<string, TreeNode[]>, Record<string, TreeNode[]>]> {
  const [nextNoteTrees, nextProjectTrees] = await Promise.all([
    Promise.all(
      model.noteRoots.map(
        async (root) =>
          [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: options.noteTreeMaxDepth, includeEmptyDirectories: true })] as const,
      ),
    ),
    Promise.all(
      model.projectRoots.map(
        async (root) => [root.path, await window.exo.workspace.listTree(root.path, { maxDepth: options.projectTreeMaxDepth })] as const,
      ),
    ),
  ]);

  return [Object.fromEntries(nextNoteTrees), Object.fromEntries(nextProjectTrees)];
}

function loadedRootKeys(model: WorkspaceModel): Set<string> {
  return new Set([
    ...model.noteRoots.map((root) => treeLoadKey("notes", root.path)),
    ...model.projectRoots.map((root) => treeLoadKey("projects", root.path)),
  ]);
}
