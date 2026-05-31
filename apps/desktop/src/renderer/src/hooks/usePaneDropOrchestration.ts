import {
  findNode,
  mapLeaves,
  paneId,
  pruneEmptyLeaves,
  removeNode,
  updateNode,
  type BrowserPaneContent,
  type EditorPaneContent,
  type PaneLeaf,
  type PaneNode,
  type PaneNodeId,
  type PaneTreeActions,
} from "./usePaneTree";
import {
  useDragManager,
  type DragManager,
  type DropEdge,
} from "./useDragManager";
import {
  addTerminalSessionToTargetLeaf,
  countTerminalSessions,
  removeTerminalSessionFromTree,
  treeContainsTerminalSession,
} from "../paneTreeSelectors";
import { directoryOf } from "../workspaceTree";

interface UsePaneDropOrchestrationOptions {
  editorTree: PaneNode;
  terminalTree: PaneNode;
  editorActions: PaneTreeActions;
  terminalActions: PaneTreeActions;
  setTerminalCollapsed: (collapsed: boolean) => void;
  setActiveTerminalId: (sessionId: string) => void;
  setActiveDocumentPath: (filePath: string) => void;
  setZoomSurface: (surface: "editor" | "terminal" | "explorer") => void;
  ensureDocumentLoaded: (filePath: string) => Promise<void>;
  moveWorkspacePathIntoDirectory: (sourcePath: string, targetDirectoryPath: string) => Promise<void>;
}

export function usePaneDropOrchestration(options: UsePaneDropOrchestrationOptions): DragManager {
  return useDragManager((target, payload) => {
    if (target.kind === "explorer") {
      if (payload.kind === "workspace-path") {
        const targetDirectoryPath = target.targetKind === "file" ? directoryOf(target.targetPath) : target.targetPath;
        void options.moveWorkspacePathIntoDirectory(payload.path, targetDirectoryPath).catch((error) => {
          console.error("[workspace] move failed", error);
        });
      }
      return;
    }

    if (payload.kind === "document") {
      handleDocumentDrop(options, target.leafId, target.edge, payload.filePath, payload.sourcePaneId);
    } else if (payload.kind === "workspace-path" && payload.nodeKind === "file") {
      handleDocumentDrop(options, target.leafId, target.edge, payload.path);
    } else if (payload.kind === "terminal") {
      handleTerminalDrop(options, target.leafId, target.edge, payload.sessionId);
    } else if (payload.kind === "browser") {
      handleBrowserDrop(options, target.leafId, target.edge, payload.url, payload.sourcePaneId);
    }
  });
}

function handleDocumentDrop(
  options: UsePaneDropOrchestrationOptions,
  leafId: PaneNodeId,
  edge: DropEdge,
  filePath: string,
  sourceLeafId?: string,
) {
  void options.ensureDocumentLoaded(filePath);
  const targetLeaf = findNode(options.editorTree, (n) => n.id === leafId && n.kind === "leaf") as PaneLeaf | undefined;
  const dropEdge = targetLeaf?.content.kind !== "editor" && edge === "center" ? "right" : edge;
  const isEmptyEditor = (leaf: PaneLeaf) =>
    leaf.content.kind === "editor" && leaf.content.openPaths.length === 0;

  if (dropEdge === "center") {
    options.editorActions.setTree((prev) => {
      let tree = mapLeaves(prev, (leaf) => {
        if (leaf.content.kind !== "editor") return leaf;
        if (sourceLeafId && leaf.id === sourceLeafId && leaf.id !== leafId) {
          const remaining = leaf.content.openPaths.filter((p) => p !== filePath);
          return {
            ...leaf,
            content: {
              ...leaf.content,
              openPaths: remaining,
              activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath,
            },
          };
        }
        if (leaf.id === leafId) {
          return {
            ...leaf,
            content: {
              ...leaf.content,
              activePath: filePath,
              openPaths: leaf.content.openPaths.includes(filePath) ? leaf.content.openPaths : [...leaf.content.openPaths, filePath],
            },
          };
        }
        return leaf;
      });
      tree = pruneEmptyLeaves(tree, isEmptyEditor);
      return tree;
    });
    options.editorActions.focusLeaf(leafId);
    options.setActiveDocumentPath(filePath);
    return;
  }

  if (sourceLeafId && sourceLeafId === leafId) {
    const src = findNode(options.editorTree, (n) => n.id === sourceLeafId) as PaneLeaf | undefined;
    if (src?.content.kind === "editor" && src.content.openPaths.length <= 1) {
      options.setActiveDocumentPath(filePath);
      return;
    }
  }

  const direction: "horizontal" | "vertical" = (dropEdge === "left" || dropEdge === "right") ? "horizontal" : "vertical";
  const position: "before" | "after" = (dropEdge === "left" || dropEdge === "top") ? "before" : "after";
  const newLeafId = paneId();
  const newContent: EditorPaneContent = { kind: "editor", openPaths: [filePath], activePath: filePath };

  options.editorActions.setTree((prev) => {
    const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: newContent };
    let tree = updateNode(prev, leafId, (node) => ({
      kind: "split" as const,
      id: paneId(),
      direction,
      ratio: 0.5,
      children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
    }));
    if (sourceLeafId) {
      tree = mapLeaves(tree, (leaf) => {
        if (leaf.id !== sourceLeafId || leaf.content.kind !== "editor") return leaf;
        const remaining = leaf.content.openPaths.filter((p) => p !== filePath);
        return {
          ...leaf,
          content: {
            ...leaf.content,
            openPaths: remaining,
            activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath,
          },
        };
      });
    }
    return pruneEmptyLeaves(tree, isEmptyEditor);
  });
  options.editorActions.focusLeaf(newLeafId);
  options.setActiveDocumentPath(filePath);
}

function handleTerminalDrop(
  options: UsePaneDropOrchestrationOptions,
  leafId: PaneNodeId,
  edge: DropEdge,
  sessionId: string,
) {
  const targetInEditorTree = findNode(options.editorTree, (node) => node.id === leafId);
  const targetInTerminalTree = findNode(options.terminalTree, (node) => node.id === leafId);
  if (!targetInEditorTree && !targetInTerminalTree) {
    return;
  }

  options.editorActions.setTree((prev) => {
    const withoutSession = removeTerminalSessionFromTree(prev, sessionId);
    const moved = targetInEditorTree
      ? addTerminalSessionToTargetLeaf(withoutSession, leafId, edge, sessionId)
      : withoutSession;
    return pruneEmptyLeaves(moved, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
  });

  options.terminalActions.setTree((prev) => {
    const withoutSession = removeTerminalSessionFromTree(prev, sessionId);
    const moved = targetInTerminalTree
      ? addTerminalSessionToTargetLeaf(withoutSession, leafId, edge, sessionId)
      : withoutSession;
    return pruneEmptyLeaves(moved, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
  });

  if (targetInEditorTree) {
    options.editorActions.focusLeaf(leafId);
    if (treeContainsTerminalSession(options.terminalTree, sessionId) && countTerminalSessions(options.terminalTree) <= 1) {
      options.setTerminalCollapsed(true);
    }
  } else {
    options.setTerminalCollapsed(false);
    options.terminalActions.focusLeaf(leafId);
  }
  options.setActiveTerminalId(sessionId);
}

function handleBrowserDrop(
  options: UsePaneDropOrchestrationOptions,
  leafId: PaneNodeId,
  edge: DropEdge,
  url: string,
  sourceLeafId: string,
) {
  const targetLeaf = findNode(options.editorTree, (node) => node.id === leafId && node.kind === "leaf") as PaneLeaf | undefined;
  if (!targetLeaf) {
    return;
  }
  if (sourceLeafId === leafId) {
    options.editorActions.focusLeaf(leafId);
    options.setZoomSurface("editor");
    return;
  }

  const browserContent: BrowserPaneContent = { kind: "browser", url };
  const dropEdge = targetLeaf.content.kind === "browser" ? edge : (edge === "center" ? "right" : edge);

  if (dropEdge === "center") {
    options.editorActions.setTree((prev) => {
      let tree = mapLeaves(prev, (leaf) =>
        leaf.id === leafId && leaf.content.kind === "browser"
          ? { ...leaf, content: browserContent }
          : leaf,
      );
      const withoutSource = removeNode(tree, sourceLeafId);
      tree = withoutSource ?? tree;
      return tree;
    });
    options.editorActions.focusLeaf(leafId);
    options.setZoomSurface("editor");
    return;
  }

  const direction: "horizontal" | "vertical" = (dropEdge === "left" || dropEdge === "right") ? "horizontal" : "vertical";
  const position: "before" | "after" = (dropEdge === "left" || dropEdge === "top") ? "before" : "after";
  const newLeafId = paneId();
  const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: browserContent };

  options.editorActions.setTree((prev) => {
    let tree = updateNode(prev, leafId, (node) => ({
      kind: "split" as const,
      id: paneId(),
      direction,
      ratio: 0.5,
      children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
    }));
    const withoutSource = removeNode(tree, sourceLeafId);
    return withoutSource ?? tree;
  });
  options.editorActions.focusLeaf(newLeafId);
  options.setZoomSurface("editor");
}
