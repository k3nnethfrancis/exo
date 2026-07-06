import type { TreeNode } from "@exo/core";

import {
  collectLeaves,
  findTerminalLeaf,
  mapLeaves,
  paneId,
  pruneEmptyLeaves,
  updateNode,
  type DropEdge,
  type PaneLeaf,
  type PaneNode,
  type PaneNodeId,
  type TerminalPaneContent,
} from "./hooks/usePaneTree";

export function collectOpenEditorPaths(tree: PaneNode): Set<string> {
  const paths = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "editor") {
      continue;
    }
    for (const filePath of leaf.content.openPaths) {
      paths.add(filePath);
    }
  }
  return paths;
}

export function findActiveEditorPath(tree: PaneNode | undefined): string | null {
  if (!tree) {
    return null;
  }
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind === "editor" && leaf.content.activePath) {
      return leaf.content.activePath;
    }
  }
  return null;
}

export function collectActiveTerminalIds(tree: PaneNode): Set<string> {
  const ids = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind === "terminal" && leaf.content.activeTerminalId) {
      ids.add(leaf.content.activeTerminalId);
    }
  }
  return ids;
}

export function collectTerminalSessionIds(tree: PaneNode): Set<string> {
  const ids = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "terminal") {
      continue;
    }
    for (const id of leaf.content.terminalIds) {
      ids.add(id);
    }
  }
  return ids;
}

export function addTerminalSessionToFirstLeaf(tree: PaneNode, sessionId: string): PaneNode {
  const termLeaf = findTerminalLeaf(tree);
  if (!termLeaf) {
    return tree;
  }

  return updateNode(tree, termLeaf.id, (node) => {
    if (node.kind !== "leaf" || node.content.kind !== "terminal") {
      return node;
    }
    if (node.content.terminalIds.includes(sessionId)) {
      return {
        ...node,
        content: {
          ...node.content,
          activeTerminalId: sessionId,
        },
      };
    }
    return {
      ...node,
      content: {
        ...node.content,
        terminalIds: [...node.content.terminalIds, sessionId],
        activeTerminalId: sessionId,
      },
    };
  });
}

const TERMINAL_TABS_LEAF_ID = "terminal-tabs";

export function buildTerminalTabsTree(sessionIds: string[], activeSessionId: string | null): PaneNode {
  const uniqueSessionIds = uniqueTerminalSessionIds(sessionIds);
  const activeTerminalId = activeSessionId && uniqueSessionIds.includes(activeSessionId)
    ? activeSessionId
    : uniqueSessionIds.at(-1) ?? null;
  return {
    kind: "leaf",
    id: TERMINAL_TABS_LEAF_ID,
    content: {
      kind: "terminal",
      terminalIds: uniqueSessionIds,
      activeTerminalId,
    },
  };
}

export function buildTerminalMonitorTree(sessionIds: string[], activeSessionId: string | null): PaneNode {
  const uniqueSessionIds = uniqueTerminalSessionIds(sessionIds);
  if (uniqueSessionIds.length === 0) {
    return buildTerminalTabsTree(uniqueSessionIds, activeSessionId);
  }

  function buildBalanced(ids: string[], depth: number): PaneNode {
    if (ids.length === 1) {
      return {
        kind: "leaf",
        id: terminalMonitorLeafId(ids[0]),
        content: {
          kind: "terminal",
          terminalIds: ids,
          activeTerminalId: ids[0],
        },
      };
    }

    const midpoint = Math.ceil(ids.length / 2);
    return {
      kind: "split",
      id: terminalMonitorSplitId(ids, depth),
      direction: depth % 2 === 0 ? "horizontal" : "vertical",
      ratio: 0.5,
      children: [
        buildBalanced(ids.slice(0, midpoint), depth + 1),
        buildBalanced(ids.slice(midpoint), depth + 1),
      ],
    };
  }

  return buildBalanced(uniqueSessionIds, 0);
}

export function restoreTerminalTreeSnapshot(snapshot: PaneNode, sessionIds: string[], activeSessionId: string | null): PaneNode {
  const uniqueSessionIds = uniqueTerminalSessionIds(sessionIds);
  if (uniqueSessionIds.length === 0) {
    return buildTerminalTabsTree([], null);
  }

  let next = pruneEmptyLeaves(
    pruneStaleTerminalSessions(snapshot, new Set(uniqueSessionIds)),
    (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0,
  );
  if (!findTerminalLeaf(next)) {
    return buildTerminalTabsTree(uniqueSessionIds, activeSessionId);
  }

  for (const sessionId of uniqueSessionIds) {
    if (!treeContainsTerminalSession(next, sessionId)) {
      next = addTerminalSessionToFirstLeaf(next, sessionId);
    }
  }

  return setActiveTerminalSessionInTree(next, uniqueSessionIds, activeSessionId);
}

export function addTerminalSessionAsSplit(tree: PaneNode, sessionId: string, targetLeafId?: PaneNodeId | null): { tree: PaneNode; leafId: PaneNodeId } {
  if (treeContainsTerminalSession(tree, sessionId)) {
    const existingLeaf = collectLeaves(tree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(sessionId),
    );
    return {
      tree,
      leafId: existingLeaf?.id ?? targetLeafId ?? findTerminalLeaf(tree)?.id ?? tree.id,
    };
  }

  const existingSessionIds = collectTerminalSessionIdsInOrder(tree);
  if (existingSessionIds.length === 0 && !findTerminalLeaf(tree)) {
    return { tree, leafId: tree.id };
  }

  return {
    tree: buildTerminalMonitorTree([...existingSessionIds, sessionId], sessionId),
    leafId: terminalMonitorLeafId(sessionId),
  };
}

export function removeTerminalSessionFromTree(tree: PaneNode, sessionId: string): PaneNode {
  return mapLeaves(tree, (leaf) => {
    if (leaf.content.kind !== "terminal" || !leaf.content.terminalIds.includes(sessionId)) {
      return leaf;
    }
    const terminalIds = leaf.content.terminalIds.filter((id) => id !== sessionId);
    return {
      ...leaf,
      content: {
        ...leaf.content,
        terminalIds,
        activeTerminalId: leaf.content.activeTerminalId === sessionId ? (terminalIds.at(-1) ?? null) : leaf.content.activeTerminalId,
      },
    };
  });
}

export function pruneStaleTerminalSessions(tree: PaneNode, activeSessionIds: Set<string>): PaneNode {
  return mapLeaves(tree, (leaf) => {
    if (leaf.content.kind !== "terminal") {
      return leaf;
    }
    const terminalIds = leaf.content.terminalIds.filter((id) => activeSessionIds.has(id));
    return {
      ...leaf,
      content: {
        ...leaf.content,
        terminalIds,
        activeTerminalId: leaf.content.activeTerminalId && terminalIds.includes(leaf.content.activeTerminalId)
          ? leaf.content.activeTerminalId
          : terminalIds.at(-1) ?? null,
      },
    };
  });
}

export function addTerminalSessionToTargetLeaf(tree: PaneNode, leafId: PaneNodeId, edge: DropEdge, sessionId: string): PaneNode {
  const terminalContent: TerminalPaneContent = {
    kind: "terminal",
    terminalIds: [sessionId],
    activeTerminalId: sessionId,
  };

  return updateNode(tree, leafId, (node) => {
    if (node.kind !== "leaf") {
      return node;
    }

    if (edge === "center" && node.content.kind === "terminal") {
      return {
        ...node,
        content: {
          ...node.content,
          terminalIds: node.content.terminalIds.includes(sessionId) ? node.content.terminalIds : [...node.content.terminalIds, sessionId],
          activeTerminalId: sessionId,
        },
      };
    }

    if (node.content.kind === "terminal" && node.content.terminalIds.length === 0) {
      return { ...node, content: terminalContent };
    }

    const direction: "horizontal" | "vertical" = (edge === "left" || edge === "right") ? "horizontal" : "vertical";
    const position: "before" | "after" = (edge === "left" || edge === "top") ? "before" : "after";
    const newLeaf: PaneLeaf = { kind: "leaf", id: paneId(), content: terminalContent };
    const splitChildren = position === "before"
      ? [newLeaf, node] as [PaneNode, PaneNode]
      : [node, newLeaf] as [PaneNode, PaneNode];

    return {
      kind: "split",
      id: paneId(),
      direction: edge === "center" ? "horizontal" : direction,
      ratio: 0.5,
      children: edge === "center" ? [node, newLeaf] as [PaneNode, PaneNode] : splitChildren,
    };
  });
}

export function treeContainsTerminalSession(tree: PaneNode, sessionId: string): boolean {
  return collectLeaves(tree).some((leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(sessionId));
}

export function countTerminalSessions(tree: PaneNode): number {
  return collectLeaves(tree).reduce((count, leaf) =>
    leaf.content.kind === "terminal" ? count + leaf.content.terminalIds.length : count,
  0);
}

function uniqueTerminalSessionIds(sessionIds: string[]): string[] {
  return Array.from(new Set(sessionIds));
}

function collectTerminalSessionIdsInOrder(tree: PaneNode): string[] {
  const ids: string[] = [];
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "terminal") {
      continue;
    }
    for (const id of leaf.content.terminalIds) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function terminalMonitorLeafId(sessionId: string): PaneNodeId {
  return `terminal-session:${sessionId}`;
}

function terminalMonitorSplitId(sessionIds: string[], depth: number): PaneNodeId {
  return `terminal-monitor:${depth}:${sessionIds.join("|")}`;
}

function setActiveTerminalSessionInTree(tree: PaneNode, sessionIds: string[], activeSessionId: string | null): PaneNode {
  const activeTerminalId = activeSessionId && sessionIds.includes(activeSessionId)
    ? activeSessionId
    : sessionIds.at(-1) ?? null;

  return mapLeaves(tree, (leaf) => {
    if (leaf.content.kind !== "terminal") {
      return leaf;
    }
    const leafActiveTerminalId = activeTerminalId && leaf.content.terminalIds.includes(activeTerminalId)
      ? activeTerminalId
      : leaf.content.activeTerminalId && leaf.content.terminalIds.includes(leaf.content.activeTerminalId)
        ? leaf.content.activeTerminalId
        : leaf.content.terminalIds.at(-1) ?? null;
    if (leafActiveTerminalId === leaf.content.activeTerminalId) {
      return leaf;
    }
    return {
      ...leaf,
      content: {
        ...leaf.content,
        activeTerminalId: leafActiveTerminalId,
      },
    };
  });
}

export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [node];
    }

    return node.children ? flattenFiles(node.children) : [];
  });
}
