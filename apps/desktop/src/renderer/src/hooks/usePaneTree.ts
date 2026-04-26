import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaneNodeId = string;

export interface PaneLeaf {
  kind: "leaf";
  id: PaneNodeId;
  content: PaneContent;
}

export interface PaneSplit {
  kind: "split";
  id: PaneNodeId;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface EditorPaneContent {
  kind: "editor";
  openPaths: string[];
  activePath: string | null;
}

export interface TerminalPaneContent {
  kind: "terminal";
  terminalIds: string[];
  activeTerminalId: string | null;
}

export type PaneContent = EditorPaneContent | TerminalPaneContent;

export type DropEdge = "top" | "bottom" | "left" | "right" | "center";

// ---------------------------------------------------------------------------
// Pure tree functions
// ---------------------------------------------------------------------------

let _nextId = 0;
export function paneId(): PaneNodeId {
  _nextId += 1;
  return `pane-${_nextId}-${Date.now().toString(36)}`;
}

/** Walk tree and replace the node with matching id. */
export function updateNode(tree: PaneNode, id: PaneNodeId, updater: (node: PaneNode) => PaneNode): PaneNode {
  if (tree.id === id) return updater(tree);
  if (tree.kind === "leaf") return tree;
  const left = updateNode(tree.children[0], id, updater);
  const right = updateNode(tree.children[1], id, updater);
  if (left === tree.children[0] && right === tree.children[1]) return tree;
  return { ...tree, children: [left, right] };
}

/** Remove a leaf by id. Its parent split is replaced by the sibling. Returns null if tree is the leaf itself. */
export function removeNode(tree: PaneNode, id: PaneNodeId): PaneNode | null {
  if (tree.kind === "leaf") {
    return tree.id === id ? null : tree;
  }
  if (tree.children[0].id === id) return tree.children[1];
  if (tree.children[1].id === id) return tree.children[0];
  const left = removeNode(tree.children[0], id);
  const right = removeNode(tree.children[1], id);
  if (left === null) return right;
  if (right === null) return left;
  if (left === tree.children[0] && right === tree.children[1]) return tree;
  return { ...tree, children: [left, right] };
}

/** Wrap a leaf in a new split, inserting newContent as a sibling. */
export function insertSplit(
  tree: PaneNode,
  leafId: PaneNodeId,
  direction: "horizontal" | "vertical",
  newContent: PaneContent,
  position: "before" | "after",
): PaneNode {
  return updateNode(tree, leafId, (node) => {
    const newLeaf: PaneLeaf = { kind: "leaf", id: paneId(), content: newContent };
    const split: PaneSplit = {
      kind: "split",
      id: paneId(),
      direction,
      ratio: 0.5,
      children: position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf],
    };
    return split;
  });
}

/** DFS find the first node matching a predicate. */
export function findNode(tree: PaneNode, predicate: (node: PaneNode) => boolean): PaneNode | undefined {
  if (predicate(tree)) return tree;
  if (tree.kind === "split") {
    return findNode(tree.children[0], predicate) ?? findNode(tree.children[1], predicate);
  }
  return undefined;
}

/** Collect all leaves in DFS order. */
export function collectLeaves(tree: PaneNode): PaneLeaf[] {
  if (tree.kind === "leaf") return [tree];
  return [...collectLeaves(tree.children[0]), ...collectLeaves(tree.children[1])];
}

/** Find the first editor leaf. */
export function findEditorLeaf(tree: PaneNode): PaneLeaf | undefined {
  return findNode(tree, (n) => n.kind === "leaf" && n.content.kind === "editor") as PaneLeaf | undefined;
}

/** Find the first terminal leaf. */
export function findTerminalLeaf(tree: PaneNode): PaneLeaf | undefined {
  return findNode(tree, (n) => n.kind === "leaf" && n.content.kind === "terminal") as PaneLeaf | undefined;
}

/** Find the leaf containing a specific terminal session ID. */
export function findTerminalLeafBySessionId(tree: PaneNode, sessionId: string): PaneLeaf | undefined {
  return findNode(tree, (n) =>
    n.kind === "leaf" && n.content.kind === "terminal" && n.content.terminalIds.includes(sessionId),
  ) as PaneLeaf | undefined;
}

/** Find the leaf containing a specific file path. */
export function findEditorLeafByPath(tree: PaneNode, filePath: string): PaneLeaf | undefined {
  return findNode(tree, (n) =>
    n.kind === "leaf" && n.content.kind === "editor" && n.content.openPaths.includes(filePath),
  ) as PaneLeaf | undefined;
}

/** Count leaves of a specific content kind. */
export function countLeaves(tree: PaneNode, kind: "editor" | "terminal"): number {
  return collectLeaves(tree).filter((l) => l.content.kind === kind).length;
}

/** Map over all leaves, returning a new tree. */
export function mapLeaves(tree: PaneNode, fn: (leaf: PaneLeaf) => PaneLeaf): PaneNode {
  if (tree.kind === "leaf") return fn(tree);
  const left = mapLeaves(tree.children[0], fn);
  const right = mapLeaves(tree.children[1], fn);
  if (left === tree.children[0] && right === tree.children[1]) return tree;
  return { ...tree, children: [left, right] };
}

/**
 * Remove every leaf for which `isEmpty` returns true, collapsing parent splits as siblings promote.
 * Never returns null — if all leaves would be pruned, the original tree is preserved so the dock keeps a surface.
 */
export function pruneEmptyLeaves(tree: PaneNode, isEmpty: (leaf: PaneLeaf) => boolean): PaneNode {
  const ids = collectLeaves(tree).filter(isEmpty).map((l) => l.id);
  let next: PaneNode | null = tree;
  for (const id of ids) {
    if (!next) break;
    const result = removeNode(next, id);
    if (result === null) break;
    next = result;
  }
  return next ?? tree;
}

// ---------------------------------------------------------------------------
// Resize state
// ---------------------------------------------------------------------------

interface ResizeState {
  splitId: PaneNodeId;
  axis: "horizontal" | "vertical";
  startPos: number;
  startRatio: number;
  containerSize: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface PaneTreeActions {
  splitLeaf: (leafId: PaneNodeId, direction: "horizontal" | "vertical", newContent: PaneContent, position: "before" | "after") => PaneLeaf;
  removeLeaf: (leafId: PaneNodeId) => void;
  updateLeafContent: (leafId: PaneNodeId, updater: (content: PaneContent) => PaneContent) => void;
  startResize: (splitId: PaneNodeId, axis: "horizontal" | "vertical", clientPos: number, containerSize: number) => void;
  focusLeaf: (leafId: PaneNodeId) => void;
  setTree: (treeOrUpdater: PaneNode | ((prev: PaneNode) => PaneNode)) => void;
}

export function usePaneTree(initialTree: PaneNode) {
  const [tree, setTree] = useState<PaneNode>(initialTree);
  const [focusedLeafId, setFocusedLeafId] = useState<PaneNodeId>(
    () => collectLeaves(initialTree)[0]?.id ?? "",
  );

  const resizeRef = useRef<ResizeState | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  // Resize effect — window-level listeners during active resize
  const setTreeForResize = useCallback((updater: (prev: PaneNode) => PaneNode) => {
    setTree(updater);
  }, []);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const state = resizeRef.current;
      if (!state) return;
      const clientPos = state.axis === "horizontal" ? event.clientX : event.clientY;
      const delta = clientPos - state.startPos;
      const ratioDelta = delta / state.containerSize;
      const newRatio = clamp(state.startRatio + ratioDelta, MIN_RATIO, MAX_RATIO);
      setTreeForResize((prev) =>
        updateNode(prev, state.splitId, (node) => {
          if (node.kind !== "split") return node;
          return { ...node, ratio: newRatio };
        }),
      );
    }

    function onMouseUp() {
      resizeRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setTreeForResize]);

  const actions: PaneTreeActions = {
    splitLeaf(leafId, direction, newContent, position) {
      const newLeafId = paneId();
      setTree((prev) => {
        const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: newContent };
        return updateNode(prev, leafId, (node) => {
          const split: PaneSplit = {
            kind: "split",
            id: paneId(),
            direction,
            ratio: 0.5,
            children: position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf],
          };
          return split;
        });
      });
      return { kind: "leaf", id: newLeafId, content: newContent };
    },

    removeLeaf(leafId) {
      setTree((prev) => {
        const result = removeNode(prev, leafId);
        return result ?? prev;
      });
      setFocusedLeafId((prev) => {
        if (prev === leafId) {
          const leaves = collectLeaves(treeRef.current).filter((l) => l.id !== leafId);
          return leaves[0]?.id ?? prev;
        }
        return prev;
      });
    },

    updateLeafContent(leafId, updater) {
      setTree((prev) =>
        updateNode(prev, leafId, (node) => {
          if (node.kind !== "leaf") return node;
          return { ...node, content: updater(node.content) };
        }),
      );
    },

    startResize(splitId, axis, clientPos, containerSize) {
      const split = findNode(treeRef.current, (n) => n.id === splitId);
      if (!split || split.kind !== "split") return;
      resizeRef.current = {
        splitId,
        axis,
        startPos: clientPos,
        startRatio: split.ratio,
        containerSize,
      };
    },

    focusLeaf(leafId) {
      setFocusedLeafId(leafId);
    },

    setTree,
  };

  return { tree, focusedLeafId, actions };
}
