import path from "node:path";

import type { WorkspaceModel } from "@exograph/core";

export function workspaceMatches(expected: WorkspaceModel, actual: WorkspaceModel): boolean {
  if (path.resolve(actual.workspaceRoot) !== path.resolve(expected.workspaceRoot)) {
    return false;
  }
  const actualRoots = actual.noteRoots.map((root) => path.resolve(root.path)).sort();
  const expectedRoots = expected.noteRoots.map((root) => path.resolve(root.path)).sort();
  return actualRoots.length === expectedRoots.length
    && actualRoots.every((root, index) => root === expectedRoots[index]);
}
