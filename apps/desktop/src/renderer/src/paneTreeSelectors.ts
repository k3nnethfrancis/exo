import type { TreeNode } from "@exo/core";

import { collectLeaves, type PaneNode } from "./hooks/usePaneTree";

export function collectOpenEditorPaths(tree: PaneNode): Set<string> {
  const paths = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "editor") continue;
    for (const filePath of leaf.content.openPaths) paths.add(filePath);
  }
  return paths;
}

export function findActiveEditorPath(tree: PaneNode | undefined): string | null {
  const activeLeaf = tree ? collectLeaves(tree).find((leaf) => leaf.content.kind === "editor" && leaf.content.activePath) : undefined;
  return activeLeaf?.content.kind === "editor" ? activeLeaf.content.activePath : null;
}

export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => node.kind === "file" ? [node] : (node.children ? flattenFiles(node.children) : []));
}
