import type { TreeNode } from "@exo/core";
import type { WorkspaceGitChange } from "../../shared/api";

export interface ExplorerChangeView extends WorkspaceGitChange {
  rootPath: string;
  rootLabel: string;
}

export interface ExplorerChangeState {
  byPath: Map<string, ExplorerChangeView>;
  descendantCountByPath: Map<string, number>;
}

export function buildExplorerChangeState(nodes: TreeNode[], changes: ExplorerChangeView[]): ExplorerChangeState {
  const byPath = new Map<string, ExplorerChangeView>();
  for (const change of changes) {
    byPath.set(change.absolutePath, change);
  }

  const descendantCountByPath = new Map<string, number>();
  for (const node of nodes) {
    collectDescendantChangeCounts(node, changes, descendantCountByPath);
  }

  return { byPath, descendantCountByPath };
}

function collectDescendantChangeCounts(
  node: TreeNode,
  changes: ExplorerChangeView[],
  descendantCountByPath: Map<string, number>,
): void {
  if (node.kind === "directory") {
    const descendantCount = changes.filter((change) => isDescendantPath(node.path, change.absolutePath)).length;
    if (descendantCount > 0) {
      descendantCountByPath.set(node.path, descendantCount);
    }
  }

  for (const child of node.children ?? []) {
    collectDescendantChangeCounts(child, changes, descendantCountByPath);
  }
}

function isDescendantPath(directoryPath: string, targetPath: string): boolean {
  return targetPath.startsWith(`${directoryPath}/`);
}
