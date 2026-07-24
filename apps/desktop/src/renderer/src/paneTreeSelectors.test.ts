import { describe, expect, it } from "vitest";

import { findFocusedEditorPath } from "./paneTreeSelectors";
import { collectLeaves } from "./hooks/usePaneTree";
import type { PaneNode } from "./hooks/usePaneTree";

describe("focused editor ownership", () => {
  it("uses the focused editor rather than the first editor in a split canvas", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "left", content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" } },
        { kind: "leaf", id: "right", content: { kind: "editor", openPaths: ["/notes/b.md"], activePath: "/notes/b.md" } },
      ],
    };

    expect(findFocusedEditorPath(tree, "right")).toBe("/notes/b.md");
  });

  it("clears document ownership when a utility pane has focus", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" } },
        { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalId: "shell" } },
      ],
    };

    expect(findFocusedEditorPath(tree, "terminal")).toBeNull();
  });

  it("preserves null ownership when the normalized restored focus is a browser", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { kind: "leaf", id: "browser", content: { kind: "browser", previewId: "preview" } },
        { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" } },
      ],
    };

    expect(findFocusedEditorPath(tree, collectLeaves(tree)[0]!.id)).toBeNull();
  });

  it("keeps persisted empty-first Connections free of an unrelated note", () => {
    const tree: PaneNode = {
      kind: "leaf",
      id: "editor",
      content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: null },
    };

    expect(findFocusedEditorPath(tree, collectLeaves(tree)[0]!.id)).toBeNull();
  });
});
