import { describe, expect, it } from "vitest";

import {
  graphEscapeDecision,
  graphNodeClickDecision,
  graphNodeDoubleClickDecision,
} from "./graphInteraction";

describe("Graph interaction contract", () => {
  it("uses every ordinary node click for inspection and reserves Shift-click for a route", () => {
    expect(graphNodeClickDecision(4, 1, false)).toEqual({ kind: "inspect", index: 4 });
    expect(graphNodeClickDecision(4, 1, true)).toEqual({ kind: "route", index: 4 });
    expect(graphNodeClickDecision(1, 1, true)).toEqual({ kind: "inspect", index: 1 });
  });

  it("opens an unopened Note, focuses an already-open Note, and leaves empty space inert", () => {
    expect(graphNodeDoubleClickDecision("/notes/one.md", false)).toBe("open");
    expect(graphNodeDoubleClickDecision("/notes/one.md", true)).toBe("focus");
    expect(graphNodeDoubleClickDecision(null, false)).toBe("none");
  });

  it("peels a route before restoring inspection to the active editor", () => {
    expect(graphEscapeDecision(true, "/notes/editor.md", "/notes/graph.md")).toBe("clear-route");
    expect(graphEscapeDecision(false, "/notes/editor.md", "/notes/graph.md")).toBe("restore-editor");
    expect(graphEscapeDecision(false, "/notes/editor.md", "/notes/editor.md")).toBe("none");
  });
});
