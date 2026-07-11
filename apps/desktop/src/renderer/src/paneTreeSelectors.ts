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

export function addTerminalSessionToCanvas(tree: PaneNode, sessionId: string, focusedLeafId?: PaneNodeId | null): { tree: PaneNode; leafId: PaneNodeId } {
  if (treeContainsTerminalSession(tree, sessionId)) {
    const existingLeaf = collectLeaves(tree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(sessionId),
    );
    return {
      tree: existingLeaf ? updateNode(tree, existingLeaf.id, (node) => {
        if (node.kind !== "leaf" || node.content.kind !== "terminal") {
          return node;
        }
        return { ...node, content: { ...node.content, activeTerminalId: sessionId } };
      }) : tree,
      leafId: existingLeaf?.id ?? focusedLeafId ?? tree.id,
    };
  }

  const targetLeaf = (
    focusedLeafId
      ? collectLeaves(tree).find((leaf) => leaf.id === focusedLeafId)
      : undefined
  ) ?? findTerminalLeaf(tree) ?? collectLeaves(tree)[0];
  if (!targetLeaf) {
    return { tree, leafId: tree.id };
  }
  const next = addTerminalSessionToTargetLeaf(
    tree,
    targetLeaf.id,
    targetLeaf.content.kind === "terminal" ? "center" : "right",
    sessionId,
  );
  const terminalLeaf = collectLeaves(next).find((leaf) =>
    leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(sessionId),
  );
  return { tree: next, leafId: terminalLeaf?.id ?? targetLeaf.id };
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

export function pruneEmptyTerminalLeaves(tree: PaneNode): PaneNode {
  return pruneEmptyLeaves(tree, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
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

export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [node];
    }

    return node.children ? flattenFiles(node.children) : [];
  });
}
