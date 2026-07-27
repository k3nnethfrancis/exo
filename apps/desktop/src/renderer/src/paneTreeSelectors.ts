import type { TreeNode } from "@stem/core";

import { collectLeaves, findNode, type PaneNode, type PaneNodeId } from "./hooks/usePaneTree";

export function collectOpenEditorPaths(tree: PaneNode): Set<string> {
  const paths = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "editor") continue;
    for (const filePath of leaf.content.openPaths) paths.add(filePath);
  }
  return paths;
}

/** The focused canvas leaf is the sole renderer owner of an active document. */
export function findFocusedEditorPath(tree: PaneNode | undefined, focusedLeafId: PaneNodeId): string | null {
  if (!tree) return null;
  const focused = findNode(tree, (node) => node.id === focusedLeafId);
  return focused?.kind === "leaf" && focused.content.kind === "editor"
    ? focused.content.activePath
    : null;
}

export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => node.kind === "file" ? [node] : (node.children ? flattenFiles(node.children) : []));
}
