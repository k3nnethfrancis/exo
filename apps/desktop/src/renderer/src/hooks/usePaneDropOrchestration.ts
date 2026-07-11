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
import { useDragManager, type DragManager, type DropEdge } from "./useDragManager";
import {
  addTerminalSessionToTargetLeaf,
  pruneEmptyTerminalLeaves,
  removeTerminalSessionFromTree,
} from "../paneTreeSelectors";
import { directoryOf } from "../workspaceTree";

interface UsePaneDropOrchestrationOptions {
  canvasTree: PaneNode;
  canvasActions: PaneTreeActions;
  setActiveTerminalId: (sessionId: string) => void;
  setActiveDocumentPath: (filePath: string) => void;
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
  const targetLeaf = findNode(options.canvasTree, (node) => node.id === leafId && node.kind === "leaf") as PaneLeaf | undefined;
  if (!targetLeaf) {
    return;
  }
  const dropEdge = targetLeaf.content.kind !== "editor" && edge === "center" ? "right" : edge;
  const isEmptyEditor = (leaf: PaneLeaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0;

  if (dropEdge === "center") {
    options.canvasActions.setTree((previous) => {
      let tree = mapLeaves(previous, (leaf) => {
        if (leaf.content.kind !== "editor") return leaf;
        if (sourceLeafId && leaf.id === sourceLeafId && leaf.id !== leafId) {
          const remaining = leaf.content.openPaths.filter((path) => path !== filePath);
          return { ...leaf, content: { ...leaf.content, openPaths: remaining, activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath } };
        }
        if (leaf.id === leafId) {
          return { ...leaf, content: { ...leaf.content, activePath: filePath, openPaths: leaf.content.openPaths.includes(filePath) ? leaf.content.openPaths : [...leaf.content.openPaths, filePath] } };
        }
        return leaf;
      });
      return pruneEmptyLeaves(tree, isEmptyEditor);
    });
    options.canvasActions.focusLeaf(leafId);
    options.setActiveDocumentPath(filePath);
    return;
  }

  if (sourceLeafId === leafId && targetLeaf.content.kind === "editor" && targetLeaf.content.openPaths.length <= 1) {
    options.setActiveDocumentPath(filePath);
    return;
  }

  const direction: "horizontal" | "vertical" = dropEdge === "left" || dropEdge === "right" ? "horizontal" : "vertical";
  const position: "before" | "after" = dropEdge === "left" || dropEdge === "top" ? "before" : "after";
  const newLeafId = paneId();
  const newContent: EditorPaneContent = { kind: "editor", openPaths: [filePath], activePath: filePath };

  options.canvasActions.setTree((previous) => {
    const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: newContent };
    let tree = updateNode(previous, leafId, (node) => ({
      kind: "split" as const,
      id: paneId(),
      direction,
      ratio: 0.5,
      children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
    }));
    if (sourceLeafId) {
      tree = mapLeaves(tree, (leaf) => {
        if (leaf.id !== sourceLeafId || leaf.content.kind !== "editor") return leaf;
        const remaining = leaf.content.openPaths.filter((path) => path !== filePath);
        return { ...leaf, content: { ...leaf.content, openPaths: remaining, activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath } };
      });
    }
    return pruneEmptyLeaves(tree, isEmptyEditor);
  });
  options.canvasActions.focusLeaf(newLeafId);
  options.setActiveDocumentPath(filePath);
}

function handleTerminalDrop(
  options: UsePaneDropOrchestrationOptions,
  leafId: PaneNodeId,
  edge: DropEdge,
  sessionId: string,
) {
  if (!findNode(options.canvasTree, (node) => node.id === leafId)) {
    return;
  }
  options.canvasActions.setTree((previous) =>
    pruneEmptyTerminalLeaves(addTerminalSessionToTargetLeaf(removeTerminalSessionFromTree(previous, sessionId), leafId, edge, sessionId)),
  );
  options.canvasActions.focusLeaf(leafId);
  options.setActiveTerminalId(sessionId);
}

function handleBrowserDrop(
  options: UsePaneDropOrchestrationOptions,
  leafId: PaneNodeId,
  edge: DropEdge,
  url: string,
  sourceLeafId: string,
) {
  const targetLeaf = findNode(options.canvasTree, (node) => node.id === leafId && node.kind === "leaf") as PaneLeaf | undefined;
  if (!targetLeaf) {
    return;
  }
  if (sourceLeafId === leafId) {
    options.canvasActions.focusLeaf(leafId);
    return;
  }

  const browserContent: BrowserPaneContent = { kind: "browser", url };
  const dropEdge = targetLeaf.content.kind === "browser" ? edge : edge === "center" ? "right" : edge;
  if (dropEdge === "center") {
    options.canvasActions.setTree((previous) => {
      let tree = mapLeaves(previous, (leaf) => leaf.id === leafId && leaf.content.kind === "browser" ? { ...leaf, content: browserContent } : leaf);
      const withoutSource = removeNode(tree, sourceLeafId);
      return withoutSource ?? tree;
    });
    options.canvasActions.focusLeaf(leafId);
    return;
  }

  const direction: "horizontal" | "vertical" = dropEdge === "left" || dropEdge === "right" ? "horizontal" : "vertical";
  const position: "before" | "after" = dropEdge === "left" || dropEdge === "top" ? "before" : "after";
  const newLeafId = paneId();
  const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: browserContent };
  options.canvasActions.setTree((previous) => {
    const tree = updateNode(previous, leafId, (node) => ({
      kind: "split" as const,
      id: paneId(),
      direction,
      ratio: 0.5,
      children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
    }));
    const withoutSource = removeNode(tree, sourceLeafId);
    return withoutSource ?? tree;
  });
  options.canvasActions.focusLeaf(newLeafId);
}
