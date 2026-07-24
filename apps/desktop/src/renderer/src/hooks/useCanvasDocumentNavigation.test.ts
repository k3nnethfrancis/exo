import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  hasNoOpenEditorPaths,
  notifyWhenLastEditorClosed,
  reconcileGraphReturnPathAfterDelete,
  reconcileGraphReturnPathAfterRename,
  reconcileDeletedPaths,
  reconcileRenamedPaths,
  resolveRecoveredEditorDestination,
  useCanvasDocumentNavigation,
} from "./useCanvasDocumentNavigation";
import { pruneEmptyLeaves, type PaneContent, type PaneNode } from "./usePaneTree";

describe("canvas document navigation reconciliation", () => {
  it("keeps a delayed same-pane open from overriding a direct tab selection", async () => {
    const load = deferred<void>();
    const updateLeafContent = vi.fn();
    let controller: ReturnType<typeof useCanvasDocumentNavigation> | null = null;
    const tree = editorTree("/notes", "/notes/current.md");

    function Harness() {
      controller = useCanvasDocumentNavigation({
        canvasTree: tree,
        focusedPaneId: "editor",
        canvasActions: {
          splitLeaf: vi.fn(),
          updateLeafContent,
          focusLeaf: vi.fn(),
          setTree: vi.fn(),
        },
        workspaceKey: "/workspace",
        ensureDocumentLoaded: () => load.promise,
        remapDocumentPaths: vi.fn(),
        deleteDocumentPaths: vi.fn(),
        onLastEditorClosed: vi.fn(),
      });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));

    const pendingOpen = controller!.openFile("/notes/delayed.md", "editor");
    controller!.setPaneActivePath("editor", "/notes/chosen.md");
    load.resolve();

    await expect(pendingOpen).resolves.toBeUndefined();
    expect(updateLeafContent).toHaveBeenCalledOnce();
    const directUpdater = updateLeafContent.mock.calls[0]![1] as (content: PaneContent) => PaneContent;
    expect(directUpdater((tree as Extract<PaneNode, { kind: "leaf" }>).content)).toMatchObject({
      activePath: "/notes/chosen.md",
    });
  });

  it.each([
    {
      label: "Terminal",
      leafId: "terminal",
      content: { kind: "terminal", terminalId: "shell" } satisfies PaneContent,
    },
    {
      label: "Graph",
      leafId: "graph",
      content: { kind: "graph" } satisfies PaneContent,
    },
    {
      label: "Preview",
      leafId: "browser",
      content: { kind: "browser", previewId: "preview" } satisfies PaneContent,
    },
  ])("keeps a delayed editor open from reclaiming focus after the user focuses a $label Pane", async ({ leafId, content }) => {
    const load = deferred<void>();
    const updateLeafContent = vi.fn();
    const focusLeaf = vi.fn();
    let controller: ReturnType<typeof useCanvasDocumentNavigation> | null = null;
    const tree: PaneNode = {
      kind: "split",
      id: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        editorTree("/notes", "/notes/current.md"),
        { kind: "leaf", id: leafId, content },
      ],
    };

    function Harness() {
      controller = useCanvasDocumentNavigation({
        canvasTree: tree,
        focusedPaneId: "editor",
        canvasActions: {
          splitLeaf: vi.fn(),
          updateLeafContent,
          focusLeaf,
          setTree: vi.fn(),
        },
        workspaceKey: "/workspace",
        ensureDocumentLoaded: () => load.promise,
        remapDocumentPaths: vi.fn(),
        deleteDocumentPaths: vi.fn(),
        onLastEditorClosed: vi.fn(),
      });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));

    const pendingOpen = controller!.openFile("/notes/delayed.md", "editor");
    controller!.focusPane(leafId);
    load.resolve();

    await expect(pendingOpen).resolves.toBeUndefined();
    expect(updateLeafContent).not.toHaveBeenCalled();
    expect(focusLeaf).toHaveBeenCalledOnce();
    expect(focusLeaf).toHaveBeenCalledWith(leafId);
  });

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

  it("recovers the daily Note beside a surviving terminal instead of targeting the pruned editor", () => {
    const terminalOnly: PaneNode = {
      kind: "leaf",
      id: "terminal",
      content: { kind: "terminal", terminalId: "shell" },
    };

    expect(resolveRecoveredEditorDestination(terminalOnly)).toEqual({
      kind: "split-beside",
      anchorLeafId: "terminal",
    });
  });

  it("does not let automatic daily recovery override an editor the user already reopened", () => {
    const reopened = editorTree("/notes", "/notes/chosen.md");

    expect(resolveRecoveredEditorDestination(reopened)).toEqual({ kind: "preserve-explicit-editor" });
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

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
