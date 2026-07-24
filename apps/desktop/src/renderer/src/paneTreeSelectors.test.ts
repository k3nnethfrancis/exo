import { describe, expect, it } from "vitest";

import { findFocusedEditorPath } from "./paneTreeSelectors";
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
});
