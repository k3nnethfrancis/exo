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
  splitLeaf: (
    leafId: PaneNodeId,
    direction: "horizontal" | "vertical",
    newContent: PaneContent,
    position: "before" | "after",
  ) => PaneLeaf;
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
  onLastEditorClosed: (openRecoveredFile: (filePath: string) => Promise<void>) => void;
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
  const optionsRef = useRef(options);
  const canvasTreeRef = useRef(options.canvasTree);
  optionsRef.current = options;
  canvasTreeRef.current = options.canvasTree;

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
    const currentOptions = optionsRef.current;
    const currentTree = canvasTreeRef.current;
    const targetLeafId = requestedLeafId ?? currentOptions.focusedPaneId;
    const targetLeaf = findNode(currentTree, (node) => node.id === targetLeafId && node.kind === "leaf") as PaneLeaf | undefined;
    const targetEditorLeaf = targetLeaf?.content.kind === "editor" ? targetLeaf : undefined;
    const fallbackLeaf = targetLeaf ?? collectLeaves(currentTree)[0];
    const editorLeafId = targetEditorLeaf?.id ?? findEditorLeaf(currentTree)?.id ?? fallbackLeaf?.id;
    if (!editorLeafId) return;
    latestNavigationRef.current.invalidatePane(editorLeafId);
    currentOptions.canvasActions.updateLeafContent(editorLeafId, (content) => content.kind === "editor"
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
    currentOptions.canvasActions.focusLeaf(editorLeafId);
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

  function focusPane(leafId: PaneNodeId) {
    for (const leaf of collectLeaves(options.canvasTree)) {
      if (leaf.id !== leafId) {
        latestNavigationRef.current.invalidatePane(leaf.id);
      }
    }
    options.canvasActions.focusLeaf(leafId);
    const leaf = findNode(options.canvasTree, (node) => node.id === leafId) as PaneLeaf | undefined;
    if (leaf?.content.kind === "editor" && leaf.content.activePath) setGraphReturnPath(leaf.content.activePath);
  }

  function setPaneActivePath(leafId: PaneNodeId, filePath: string) {
    latestNavigationRef.current.invalidatePane(leafId);
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
    latestNavigationRef.current.invalidatePane(editorLeaf.id);
    options.canvasActions.updateLeafContent(editorLeaf.id, (content) =>
      content.kind !== "editor" ? content : activateFolderOverviewContent(content, directoryPath));
    options.canvasActions.focusLeaf(editorLeaf.id);
  }

  function closeFolderOverview(leafId: PaneNodeId, directoryPath: string) {
    latestNavigationRef.current.invalidatePane(leafId);
    const transition = closeFolderOverviewInTree(options.canvasTree, leafId, directoryPath, options.focusedPaneId);
    canvasTreeRef.current = transition.tree;
    options.canvasActions.setTree(transition.tree);
    if (transition.activeDocumentPath) setGraphReturnPath(transition.activeDocumentPath);
  }

  function closeDocumentInPane(leafId: PaneNodeId, filePath: string) {
    latestNavigationRef.current.invalidatePane(leafId);
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
    canvasTreeRef.current = nextTree;
    options.canvasActions.setTree(nextTree);
    notifyWhenLastEditorClosed(
      nextTree,
      () => options.onLastEditorClosed(recoverLastEditor),
    );
  }

  function remapOpenPaths(sourcePath: string, nextPath: string) {
    invalidateEditorPaneNavigation(options.canvasTree);
    options.remapDocumentPaths(sourcePath, nextPath);
    const nextTree = reconcileRenamedPaths(options.canvasTree, sourcePath, nextPath);
    canvasTreeRef.current = nextTree;
    options.canvasActions.setTree(nextTree);
    setGraphReturnPath((current) => reconcileGraphReturnPathAfterRename(current, sourcePath, nextPath));
  }

  function removeDeletedPaths(targetPath: string) {
    invalidateEditorPaneNavigation(options.canvasTree);
    options.deleteDocumentPaths(targetPath);
    const nextTree = reconcileDeletedPaths(options.canvasTree, targetPath);
    canvasTreeRef.current = nextTree;
    options.canvasActions.setTree(nextTree);
    setGraphReturnPath((current) => reconcileGraphReturnPathAfterDelete(current, targetPath));
  }

  function rememberGraphReturnPath(filePath: string | null) {
    if (filePath) setGraphReturnPath(filePath);
  }

  function invalidateEditorPaneNavigation(tree: PaneNode) {
    for (const leaf of collectLeaves(tree)) {
      if (leaf.content.kind === "editor") latestNavigationRef.current.invalidatePane(leaf.id);
    }
  }

  async function recoverLastEditor(filePath: string) {
    await optionsRef.current.ensureDocumentLoaded(filePath);
    const destination = resolveRecoveredEditorDestination(canvasTreeRef.current);
    if (destination.kind === "preserve-explicit-editor" || destination.kind === "none") return;
    if (destination.kind === "activate-editor") {
      activateEditorDocument(filePath, destination.leafId);
      return;
    }
    const currentOptions = optionsRef.current;
    const recoveredLeaf = currentOptions.canvasActions.splitLeaf(
      destination.anchorLeafId,
      "horizontal",
      {
        kind: "editor",
        activePath: filePath,
        openPaths: [filePath],
        openFolderPaths: [],
        activeFolderPath: null,
        activeFolderReturnPath: null,
      },
      "before",
    );
    currentOptions.canvasActions.focusLeaf(recoveredLeaf.id);
    setGraphReturnPath(filePath);
  }

  return {
    editorRevealLineRequest,
    graphReturnPath,
    activateEditorDocument,
    openFile,
    focusPane,
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

export type RecoveredEditorDestination =
  | { kind: "activate-editor"; leafId: PaneNodeId }
  | { kind: "split-beside"; anchorLeafId: PaneNodeId }
  | { kind: "preserve-explicit-editor" }
  | { kind: "none" };

export function resolveRecoveredEditorDestination(tree: PaneNode): RecoveredEditorDestination {
  const editor = findEditorLeaf(tree);
  if (editor?.content.kind === "editor") {
    return editor.content.openPaths.length === 0
      ? { kind: "activate-editor", leafId: editor.id }
      : { kind: "preserve-explicit-editor" };
  }
  const anchor = collectLeaves(tree)[0];
  return anchor ? { kind: "split-beside", anchorLeafId: anchor.id } : { kind: "none" };
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
