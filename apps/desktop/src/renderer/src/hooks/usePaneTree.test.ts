import { describe, expect, it } from "vitest";

import {
  activateFolderOverviewContent,
  closeFolderOverviewContent,
  closeFolderOverviewInTree,
  decodeCanvas,
  resolveFolderOverviewEditorLeaf,
  type EditorPaneContent,
  type PaneNode,
} from "./usePaneTree";

describe("Folder Overview editor ownership", () => {
  it("restores the exact reactivated Note instead of the last-opened Note", () => {
    const editor = content({
      openPaths: ["/notes/a.md", "/notes/b.md"],
      activePath: "/notes/a.md",
    });

    const overview = activateFolderOverviewContent(editor, "/notes/projects");
    expect(overview).toMatchObject({
      activePath: null,
      activeFolderPath: "/notes/projects",
      activeFolderReturnPath: "/notes/a.md",
    });

    const closed = closeFolderOverviewContent(overview, "/notes/projects");
    expect(closed).toMatchObject({
      closedActiveOverview: true,
      restoredPath: "/notes/a.md",
      content: {
        activePath: "/notes/a.md",
        activeFolderPath: null,
        activeFolderReturnPath: null,
      },
    });
  });

  it.each([
    { name: "zero Notes", openPaths: [], activePath: null, restoredPath: null },
    { name: "one Note", openPaths: ["/notes/a.md"], activePath: "/notes/a.md", restoredPath: "/notes/a.md" },
  ])("closes deterministically with $name", ({ openPaths, activePath, restoredPath }) => {
    const overview = activateFolderOverviewContent(
      content({ openPaths, activePath }),
      "/notes/projects",
    );

    expect(closeFolderOverviewContent(overview, "/notes/projects").restoredPath).toBe(restoredPath);
  });

  it("keeps the underlying Note while switching and closing inactive overview tabs", () => {
    const first = activateFolderOverviewContent(
      content({ openPaths: ["/notes/a.md"], activePath: "/notes/a.md" }),
      "/notes/one",
    );
    const second = activateFolderOverviewContent(first, "/notes/two");
    const inactiveClose = closeFolderOverviewContent(second, "/notes/one");

    expect(inactiveClose).toMatchObject({
      closedActiveOverview: false,
      content: {
        activeFolderPath: "/notes/two",
        activeFolderReturnPath: "/notes/a.md",
      },
    });
    expect(closeFolderOverviewContent(inactiveClose.content, "/notes/two").restoredPath).toBe("/notes/a.md");
  });

  it("restores a reachable review virtual document exactly", () => {
    const virtualPath = "exo-review://invocation/file";
    const overview = activateFolderOverviewContent(
      content({
        openPaths: ["/notes/a.md", virtualPath],
        activePath: virtualPath,
      }),
      "/notes/projects",
    );

    expect(closeFolderOverviewContent(overview, "/notes/projects").restoredPath).toBe(virtualPath);
  });

  it("falls back explicitly after the exact return Note is deleted", () => {
    const afterDelete = content({
      openPaths: ["/notes/b.md"],
      activePath: null,
      openFolderPaths: ["/notes/projects"],
      activeFolderPath: "/notes/projects",
      activeFolderReturnPath: "/notes/a.md",
    });

    expect(closeFolderOverviewContent(afterDelete, "/notes/projects").restoredPath).toBe("/notes/b.md");
  });

  it("restores a renamed return Note when pane paths were remapped", () => {
    const afterRename = content({
      openPaths: ["/notes/renamed.md", "/notes/b.md"],
      activePath: null,
      openFolderPaths: ["/notes/projects"],
      activeFolderPath: "/notes/projects",
      activeFolderReturnPath: "/notes/renamed.md",
    });

    expect(closeFolderOverviewContent(afterRename, "/notes/projects").restoredPath).toBe("/notes/renamed.md");
  });

  it("decodes the persisted exact return path and safely accepts legacy layouts without one", () => {
    const persisted = {
      kind: "leaf",
      id: "editor",
      content: {
        kind: "editor",
        openPaths: ["/notes/a.md", "/notes/b.md"],
        activePath: null,
        openFolderPaths: ["/notes/projects"],
        activeFolderPath: "/notes/projects",
        activeFolderReturnPath: "/notes/a.md",
      },
    };

    const restored = decodeCanvas(persisted);
    expect(restored).toEqual(persisted);
    expect(restored?.kind).toBe("leaf");
    if (restored?.kind !== "leaf" || restored.content.kind !== "editor") {
      throw new Error("expected restored editor pane");
    }
    expect(closeFolderOverviewContent(restored.content, "/notes/projects").restoredPath).toBe("/notes/a.md");

    const legacy = decodeCanvas({
      ...persisted,
      content: {
        ...persisted.content,
        activeFolderReturnPath: undefined,
      },
    });
    expect(legacy).toMatchObject({
      content: {
        activeFolderPath: "/notes/projects",
        activePath: null,
      },
    });
    expect(legacy?.kind).toBe("leaf");
    if (legacy?.kind !== "leaf" || legacy.content.kind !== "editor") {
      throw new Error("expected legacy editor pane");
    }
    expect(closeFolderOverviewContent(legacy.content, "/notes/projects").restoredPath).toBe("/notes/b.md");
  });

  it("leaves document ownership with a different focused pane when an overview closes", () => {
    const tree = splitEditors(
      activateFolderOverviewContent(
        content({ openPaths: ["/notes/a.md"], activePath: "/notes/a.md" }),
        "/notes/projects",
      ),
      content({ openPaths: ["/notes/b.md"], activePath: "/notes/b.md" }),
    );

    const closed = closeFolderOverviewInTree(tree, "left", "/notes/projects", "right");

    expect(closed.activeDocumentPath).toBeUndefined();
    expect(closed.tree).toMatchObject({
      children: [
        { content: { activePath: "/notes/a.md", activeFolderPath: null } },
        { content: { activePath: "/notes/b.md" } },
      ],
    });
  });

  it("synchronously restores document ownership when the focused overview closes", () => {
    const tree = splitEditors(
      activateFolderOverviewContent(
        content({ openPaths: ["/notes/a.md"], activePath: "/notes/a.md" }),
        "/notes/projects",
      ),
      content({ openPaths: ["/notes/b.md"], activePath: "/notes/b.md" }),
    );

    const closed = closeFolderOverviewInTree(tree, "left", "/notes/projects", "left");

    expect(closed.activeDocumentPath).toBe("/notes/a.md");
    expect(closed.tree).toMatchObject({
      children: [
        { content: { activePath: "/notes/a.md", activeFolderPath: null } },
        { content: { activePath: "/notes/b.md" } },
      ],
    });
  });

  it("opens Folder Overview in an existing editor when a terminal split is focused", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "editor", content: content({ openPaths: ["/notes/a.md"], activePath: "/notes/a.md" }) },
        { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalId: "shell" } },
      ],
    };

    expect(resolveFolderOverviewEditorLeaf(tree, "terminal")).toMatchObject({ id: "editor" });
  });

  it("leaves Folder Overview unopened when no editor leaf exists", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalId: "shell" } },
        { kind: "leaf", id: "preview", content: { kind: "browser", previewId: "preview" } },
      ],
    };

    expect(resolveFolderOverviewEditorLeaf(tree, "terminal")).toBeUndefined();
  });
});

function content(overrides: Partial<EditorPaneContent>): EditorPaneContent {
  return {
    kind: "editor",
    openPaths: [],
    activePath: null,
    openFolderPaths: [],
    activeFolderPath: null,
    activeFolderReturnPath: null,
    ...overrides,
  };
}

function splitEditors(left: EditorPaneContent, right: EditorPaneContent): PaneNode {
  return {
    kind: "split",
    id: "root",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { kind: "leaf", id: "left", content: left },
      { kind: "leaf", id: "right", content: right },
    ],
  };
}
