import { useEffect, useRef, useState } from "react";

import { LatestPaneNavigation } from "../latestPaneNavigation";
import {
  activateFolderOverviewContent,
  closeFolderOverviewInTree,
  collectLeaves,
  findEditorLeaf,
  findNode,
  mapLeaves,
  pruneEmptyLeaves,
  resolveFolderOverviewEditorLeaf,
  type PaneContent,
  type PaneLeaf,
  type PaneNode,
  type PaneNodeId,
} from "./usePaneTree";

interface CanvasActions {
  updateLeafContent: (leafId: PaneNodeId, updater: (content: PaneContent) => PaneContent) => void;
  focusLeaf: (leafId: PaneNodeId) => void;
  setTree: (tree: PaneNode) => void;
}

interface UseCanvasDocumentNavigationOptions {
  canvasTree: PaneNode;
  focusedPaneId: PaneNodeId;
  canvasActions: CanvasActions;
  /** Historical graph context must not cross a Workspace activation. */
  workspaceKey: string | null;
  ensureDocumentLoaded: (filePath: string) => Promise<void>;
  remapDocumentPaths: (sourcePath: string, nextPath: string) => void;
  deleteDocumentPaths: (targetPath: string) => void;
  onLastEditorClosed: () => void;
}

export interface EditorRevealLineRequest {
  filePath: string;
  line: number;
  nonce: number;
}

/**
 * Local canvas navigation state. Focused pane-tree selection remains the sole
 * current-document authority; graphReturnPath is deliberately historical.
 */
export function useCanvasDocumentNavigation(options: UseCanvasDocumentNavigationOptions) {
  const latestNavigationRef = useRef(new LatestPaneNavigation());
  const [editorRevealLineRequest, setEditorRevealLineRequest] = useState<EditorRevealLineRequest | null>(null);
  const [graphReturnPath, setGraphReturnPath] = useState<string | null>(null);
  const workspaceKeyRef = useRef(options.workspaceKey);

  useEffect(() => {
    if (workspaceKeyRef.current === options.workspaceKey) return;
    workspaceKeyRef.current = options.workspaceKey;
    setGraphReturnPath(null);
  }, [options.workspaceKey]);

  useEffect(() => {
    latestNavigationRef.current.invalidateUnavailablePanes(new Set(
      collectLeaves(options.canvasTree)
        .filter((leaf) => leaf.content.kind === "editor")
        .map((leaf) => leaf.id),
    ));
  }, [options.canvasTree]);

  function activateEditorDocument(filePath: string, requestedLeafId?: PaneNodeId) {
    const targetLeafId = requestedLeafId ?? options.focusedPaneId;
    const targetLeaf = findNode(options.canvasTree, (node) => node.id === targetLeafId && node.kind === "leaf") as PaneLeaf | undefined;
    const targetEditorLeaf = targetLeaf?.content.kind === "editor" ? targetLeaf : undefined;
    const fallbackLeaf = targetLeaf ?? collectLeaves(options.canvasTree)[0];
    const editorLeafId = targetEditorLeaf?.id ?? findEditorLeaf(options.canvasTree)?.id ?? fallbackLeaf?.id;
    if (!editorLeafId) return;
    options.canvasActions.updateLeafContent(editorLeafId, (content) => content.kind === "editor"
      ? {
          ...content,
          activePath: filePath,
          activeFolderPath: null,
          activeFolderReturnPath: null,
          openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
        }
      : {
          kind: "editor",
          activePath: filePath,
          openPaths: [filePath],
          openFolderPaths: [],
          activeFolderPath: null,
          activeFolderReturnPath: null,
        });
    options.canvasActions.focusLeaf(editorLeafId);
    setGraphReturnPath(filePath);
  }

  async function openFile(filePath: string, leafId?: PaneNodeId, navigationOptions?: { line?: number | null }) {
    const targetLeafId = leafId ?? options.focusedPaneId;
    const targetLeaf = findNode(options.canvasTree, (node) => node.id === targetLeafId && node.kind === "leaf") as PaneLeaf | undefined;
    const targetEditorLeaf = targetLeaf?.content.kind === "editor" ? targetLeaf : undefined;
    const fallbackLeaf = targetLeaf ?? collectLeaves(options.canvasTree)[0];
    const editorLeafId = targetEditorLeaf?.id ?? findEditorLeaf(options.canvasTree)?.id ?? fallbackLeaf?.id;
    await latestNavigationRef.current.commitLatest(
      editorLeafId ?? targetLeafId,
      () => options.ensureDocumentLoaded(filePath),
      () => {
        activateEditorDocument(filePath, editorLeafId);
        if (navigationOptions?.line && navigationOptions.line > 0) {
          setEditorRevealLineRequest({ filePath, line: navigationOptions.line, nonce: Date.now() });
        }
      },
    );
  }

  function focusEditorPane(leafId: PaneNodeId) {
    options.canvasActions.focusLeaf(leafId);
    const leaf = findNode(options.canvasTree, (node) => node.id === leafId) as PaneLeaf | undefined;
    if (leaf?.content.kind === "editor" && leaf.content.activePath) setGraphReturnPath(leaf.content.activePath);
  }

  function setPaneActivePath(leafId: PaneNodeId, filePath: string) {
    options.canvasActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "editor") return content;
      return {
        ...content,
        activePath: filePath,
        activeFolderPath: null,
        activeFolderReturnPath: null,
        openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
      };
    });
    options.canvasActions.focusLeaf(leafId);
    setGraphReturnPath(filePath);
  }

  function openFolderOverview(directoryPath: string, leafId = options.focusedPaneId) {
    const editorLeaf = resolveFolderOverviewEditorLeaf(options.canvasTree, options.focusedPaneId, leafId);
    if (!editorLeaf) return;
    options.canvasActions.updateLeafContent(editorLeaf.id, (content) =>
      content.kind !== "editor" ? content : activateFolderOverviewContent(content, directoryPath));
    options.canvasActions.focusLeaf(editorLeaf.id);
  }

  function closeFolderOverview(leafId: PaneNodeId, directoryPath: string) {
    const transition = closeFolderOverviewInTree(options.canvasTree, leafId, directoryPath, options.focusedPaneId);
    options.canvasActions.setTree(transition.tree);
    if (transition.activeDocumentPath) setGraphReturnPath(transition.activeDocumentPath);
  }

  function closeDocumentInPane(leafId: PaneNodeId, filePath: string) {
    const nextTree = pruneEmptyLeaves(
      mapLeaves(options.canvasTree, (leaf) => {
        if (leaf.id !== leafId || leaf.content.kind !== "editor") return leaf;
        const nextOpenPaths = leaf.content.openPaths.filter((path) => path !== filePath);
        const closedIndex = leaf.content.openPaths.indexOf(filePath);
        return {
          ...leaf,
          content: {
            ...leaf.content,
            openPaths: nextOpenPaths,
            activePath: leaf.content.activePath === filePath
              ? (nextOpenPaths[Math.max(0, closedIndex - 1)] ?? nextOpenPaths[0] ?? null)
              : leaf.content.activePath,
            activeFolderReturnPath: leaf.content.activeFolderReturnPath === filePath
              ? null
              : leaf.content.activeFolderReturnPath,
          },
        };
      }),
      (leaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0,
    );
    options.canvasActions.setTree(nextTree);
    notifyWhenLastEditorClosed(nextTree, options.onLastEditorClosed);
  }

  function remapOpenPaths(sourcePath: string, nextPath: string) {
    options.remapDocumentPaths(sourcePath, nextPath);
    options.canvasActions.setTree(reconcileRenamedPaths(options.canvasTree, sourcePath, nextPath));
    setGraphReturnPath((current) => reconcileGraphReturnPathAfterRename(current, sourcePath, nextPath));
  }

  function removeDeletedPaths(targetPath: string) {
    options.deleteDocumentPaths(targetPath);
    options.canvasActions.setTree(reconcileDeletedPaths(options.canvasTree, targetPath));
    setGraphReturnPath((current) => reconcileGraphReturnPathAfterDelete(current, targetPath));
  }

  function rememberGraphReturnPath(filePath: string | null) {
    if (filePath) setGraphReturnPath(filePath);
  }

  return {
    editorRevealLineRequest,
    graphReturnPath,
    activateEditorDocument,
    openFile,
    focusEditorPane,
    setPaneActivePath,
    openFolderOverview,
    closeFolderOverview,
    closeDocumentInPane,
    remapOpenPaths,
    removeDeletedPaths,
    rememberGraphReturnPath,
  };
}

export function reconcileRenamedPaths(tree: PaneNode, sourcePath: string, nextPath: string): PaneNode {
  return mapLeaves(tree, (leaf) => {
    if (leaf.content.kind !== "editor") return leaf;
    return {
      ...leaf,
      content: {
        ...leaf.content,
        openPaths: leaf.content.openPaths.map((path) => remapPathWithin(path, sourcePath, nextPath) ?? path),
        openFolderPaths: (leaf.content.openFolderPaths ?? []).map((path) => remapPathWithin(path, sourcePath, nextPath) ?? path),
        activePath: remapPathWithin(leaf.content.activePath, sourcePath, nextPath),
        activeFolderPath: remapPathWithin(leaf.content.activeFolderPath, sourcePath, nextPath),
        activeFolderReturnPath: remapPathWithin(leaf.content.activeFolderReturnPath, sourcePath, nextPath),
      },
    };
  });
}

export function reconcileDeletedPaths(tree: PaneNode, targetPath: string): PaneNode {
  return mapLeaves(tree, (leaf) => {
    if (leaf.content.kind !== "editor") return leaf;
    const openPaths = leaf.content.openPaths.filter((path) => !isPathWithin(targetPath, path));
    return {
      ...leaf,
      content: {
        ...leaf.content,
        openPaths,
        openFolderPaths: (leaf.content.openFolderPaths ?? []).filter((path) => !isPathWithin(targetPath, path)),
        activePath: leaf.content.activePath && !isPathWithin(targetPath, leaf.content.activePath)
          ? leaf.content.activePath
          : openPaths.at(-1) ?? null,
        activeFolderPath: leaf.content.activeFolderPath && !isPathWithin(targetPath, leaf.content.activeFolderPath)
          ? leaf.content.activeFolderPath
          : null,
        activeFolderReturnPath: leaf.content.activeFolderReturnPath && !isPathWithin(targetPath, leaf.content.activeFolderReturnPath)
          ? leaf.content.activeFolderReturnPath
          : null,
      },
    };
  });
}

export function hasNoOpenEditorPaths(tree: PaneNode): boolean {
  return collectLeaves(tree).every((leaf) => leaf.content.kind !== "editor" || leaf.content.openPaths.length === 0);
}

export function notifyWhenLastEditorClosed(tree: PaneNode, onLastEditorClosed: () => void): boolean {
  if (!hasNoOpenEditorPaths(tree)) return false;
  onLastEditorClosed();
  return true;
}

export function reconcileGraphReturnPathAfterRename(
  graphReturnPath: string | null,
  sourcePath: string,
  nextPath: string,
): string | null {
  return remapPathWithin(graphReturnPath, sourcePath, nextPath);
}

export function reconcileGraphReturnPathAfterDelete(graphReturnPath: string | null, targetPath: string): string | null {
  return graphReturnPath && isPathWithin(targetPath, graphReturnPath) ? null : graphReturnPath;
}

function remapPathWithin(path: string | null | undefined, sourcePath: string, nextPath: string): string | null {
  if (!path || !isPathWithin(sourcePath, path)) return path ?? null;
  return path.replace(sourcePath, nextPath);
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}
