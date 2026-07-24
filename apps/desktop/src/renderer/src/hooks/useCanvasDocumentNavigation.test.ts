import { describe, expect, it, vi } from "vitest";

import {
  hasNoOpenEditorPaths,
  notifyWhenLastEditorClosed,
  reconcileGraphReturnPathAfterDelete,
  reconcileGraphReturnPathAfterRename,
  reconcileDeletedPaths,
  reconcileRenamedPaths,
} from "./useCanvasDocumentNavigation";
import { pruneEmptyLeaves, type PaneNode } from "./usePaneTree";

describe("canvas document navigation reconciliation", () => {
  it("keeps the last-editor recovery condition true after the last editor leaf is pruned", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: [], activePath: null } },
        { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalId: "one" } },
      ],
    };
    const terminalOnly = pruneEmptyLeaves(tree, (leaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0);

    const onLastEditorClosed = vi.fn();

    expect(hasNoOpenEditorPaths(terminalOnly)).toBe(true);
    expect(notifyWhenLastEditorClosed(terminalOnly, onLastEditorClosed)).toBe(true);
    expect(onLastEditorClosed).toHaveBeenCalledOnce();
  });

  it("reconciles renamed note and Folder Overview paths together", () => {
    const tree = editorTree("/notes/project", "/notes/project/a.md");

    expect(reconcileRenamedPaths(tree, "/notes/project", "/notes/renamed")).toMatchObject({
      content: {
        openPaths: ["/notes/renamed/a.md"],
        activePath: "/notes/renamed/a.md",
        activeFolderPath: "/notes/renamed",
        activeFolderReturnPath: "/notes/renamed/a.md",
      },
    });
  });

  it("clears a deleted Folder Overview and its stale return Note", () => {
    const tree = editorTree("/notes/project", "/notes/project/a.md");

    expect(reconcileDeletedPaths(tree, "/notes/project")).toMatchObject({
      content: {
        openPaths: [],
        activePath: null,
        activeFolderPath: null,
        activeFolderReturnPath: null,
      },
    });
  });

  it("reconciles Graph Escape's historical return Note without creating an active-path mirror", () => {
    expect(reconcileGraphReturnPathAfterRename("/notes/project/a.md", "/notes/project", "/notes/renamed"))
      .toBe("/notes/renamed/a.md");
    expect(reconcileGraphReturnPathAfterDelete("/notes/renamed/a.md", "/notes/renamed")).toBeNull();
  });
});

function editorTree(folderPath: string, notePath: string): PaneNode {
  return {
    kind: "leaf",
    id: "editor",
    content: {
      kind: "editor",
      openPaths: [notePath],
      activePath: notePath,
      openFolderPaths: [folderPath],
      activeFolderPath: folderPath,
      activeFolderReturnPath: notePath,
    },
  };
}
