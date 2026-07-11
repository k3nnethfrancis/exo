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

  function buildMonitorLeaf(id: string): PaneNode {
    return {
      kind: "leaf",
      id: terminalMonitorLeafId(id),
      content: {
        kind: "terminal",
        terminalIds: [id],
        activeTerminalId: id,
      },
    };
  }

  function buildColumns(ids: string[], depth: number): PaneNode {
    if (ids.length === 1) {
      return buildMonitorLeaf(ids[0]);
    }

    const midpoint = Math.ceil(ids.length / 2);
    return {
      kind: "split",
      id: terminalMonitorSplitId(ids, `column:${depth}`),
      direction: "horizontal",
      ratio: midpoint / ids.length,
      children: [
        buildColumns(ids.slice(0, midpoint), depth + 1),
        buildColumns(ids.slice(midpoint), depth + 1),
      ],
    };
  }

  function buildRows(rows: string[][], depth: number): PaneNode {
    if (rows.length === 1) {
      return buildColumns(rows[0], depth);
    }

    const midpoint = Math.ceil(rows.length / 2);
    return {
      kind: "split",
      id: terminalMonitorSplitId(rows.flat(), `row:${depth}`),
      direction: "vertical",
      ratio: midpoint / rows.length,
      children: [
        buildRows(rows.slice(0, midpoint), depth + 1),
        buildRows(rows.slice(midpoint), depth + 1),
      ],
    };
  }

  return buildRows(terminalMonitorRows(uniqueSessionIds), 0);
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

  if (isTerminalMonitorTree(tree)) {
    const sessionIds = [...collectMonitorSessionIds(tree), sessionId];
    const monitorTree = buildTerminalMonitorTree(sessionIds, sessionId);
    return {
      tree: monitorTree,
      leafId: terminalMonitorLeafId(sessionId),
    };
  }

  const targetLeaf = (
    targetLeafId
      ? collectLeaves(tree).find((leaf) => leaf.id === targetLeafId && leaf.content.kind === "terminal")
      : undefined
  ) ?? findTerminalLeaf(tree);
  if (!targetLeaf) {
    return { tree, leafId: tree.id };
  }

  if (targetLeaf.content.kind === "terminal" && targetLeaf.content.terminalIds.length === 0) {
    return {
      tree: updateNode(tree, targetLeaf.id, (node) => {
        if (node.kind !== "leaf" || node.content.kind !== "terminal") {
          return node;
        }
        return {
          ...node,
          content: {
            ...node.content,
            terminalIds: [sessionId],
            activeTerminalId: sessionId,
          },
        };
      }),
      leafId: targetLeaf.id,
    };
  }

  const newLeafId = paneId();
  const newLeaf: PaneLeaf = {
    kind: "leaf",
    id: newLeafId,
    content: {
      kind: "terminal",
      terminalIds: [sessionId],
      activeTerminalId: sessionId,
    },
  };

  return {
    tree: updateNode(tree, targetLeaf.id, (node) => {
      if (node.kind !== "leaf") {
        return node;
      }
      return {
        kind: "split",
        id: paneId(),
        direction: "horizontal",
        ratio: 0.5,
        children: [node, newLeaf],
      };
    }),
    leafId: newLeafId,
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

function terminalMonitorLeafId(sessionId: string): PaneNodeId {
  return `terminal-session:${sessionId}`;
}

function terminalMonitorSplitId(sessionIds: string[], scope: string): PaneNodeId {
  return `terminal-monitor:${scope}:${sessionIds.join("|")}`;
}

function terminalMonitorRows(sessionIds: string[]): string[][] {
  if (sessionIds.length <= 2) {
    return sessionIds.map((sessionId) => [sessionId]);
  }
  const rowCount = Math.max(2, Math.round(Math.sqrt(sessionIds.length)));
  const rows: string[][] = [];
  let cursor = 0;
  for (let rowIndex = 0; rowIndex < rowCount && cursor < sessionIds.length; rowIndex += 1) {
    const remainingRows = rowCount - rowIndex;
    const remainingSessions = sessionIds.length - cursor;
    const rowSize = Math.ceil(remainingSessions / remainingRows);
    rows.push(sessionIds.slice(cursor, cursor + rowSize));
    cursor += rowSize;
  }
  return rows;
}

function isTerminalMonitorTree(tree: PaneNode): boolean {
  const leaves = collectLeaves(tree);
  return leaves.length > 0 && leaves.every((leaf) =>
    leaf.content.kind === "terminal" &&
    leaf.content.terminalIds.length === 1 &&
    leaf.id === terminalMonitorLeafId(leaf.content.terminalIds[0]),
  );
}

function collectMonitorSessionIds(tree: PaneNode): string[] {
  return collectLeaves(tree).flatMap((leaf) =>
    leaf.content.kind === "terminal" ? leaf.content.terminalIds : [],
  );
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
