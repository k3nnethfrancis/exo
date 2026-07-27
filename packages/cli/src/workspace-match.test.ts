import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@stem/core";
import { workspaceMatches } from "./workspace-match";

describe("workspaceMatches", () => {
  it("matches one explicit Workspace independent of Note Root order", () => {
    expect(workspaceMatches(
      model("/workspace", ["/workspace/notes", "/workspace/research"]),
      model("/workspace", ["/workspace/research", "/workspace/notes"]),
    )).toBe(true);
  });

  it("rejects a historical Workspace root or a different Note Root authority set", () => {
    expect(workspaceMatches(
      model("/workspace", ["/workspace/notes"]),
      model("/historical", ["/workspace/notes"]),
    )).toBe(false);
    expect(workspaceMatches(
      model("/workspace", ["/workspace/notes"]),
      model("/workspace", ["/workspace/notes", "/workspace/private"]),
    )).toBe(false);
  });
});

function model(workspaceRoot: string, noteRoots: string[]): WorkspaceModel {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: noteRoots.map((root, index) => ({
      id: `root-${index}`,
      label: `root-${index}`,
      path: root,
    })),
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    searchEngine: "filesystem",
  };
}
