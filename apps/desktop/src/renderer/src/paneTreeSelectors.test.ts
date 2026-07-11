import { describe, expect, it } from "vitest";

import {
  addTerminalSessionToCanvas,
  pruneEmptyTerminalLeaves,
  removeTerminalSessionFromTree,
} from "./paneTreeSelectors";
import type { PaneNode } from "./hooks/usePaneTree";

describe("canvas terminal selectors", () => {
  it("adds and focuses terminal sessions in the one canvas tree", () => {
    const initial = {
      kind: "leaf" as const,
      id: "note-pane",
      content: { kind: "editor" as const, openPaths: [], activePath: null },
    } satisfies PaneNode;

    const first = addTerminalSessionToCanvas(initial, "term-a", "note-pane");
    const second = addTerminalSessionToCanvas(first.tree, "term-b", first.leafId);

    expect(first.leafId).not.toBe("note-pane");
    expect(second.leafId).toBe(first.leafId);
    expect(second.tree).toMatchObject({
      kind: "split",
      children: expect.arrayContaining([
        expect.objectContaining({ content: expect.objectContaining({ kind: "terminal", terminalIds: ["term-a", "term-b"], activeTerminalId: "term-b" }) }),
      ]),
    });
  });

  it("prunes an emptied terminal leaf without removing the remaining canvas", () => {
    const initial = {
      kind: "split" as const,
      id: "canvas",
      direction: "horizontal" as const,
      ratio: 0.5,
      children: [
        { kind: "leaf" as const, id: "note-pane", content: { kind: "editor" as const, openPaths: [], activePath: null } },
        { kind: "leaf" as const, id: "terminal-pane", content: { kind: "terminal" as const, terminalIds: ["term-a"], activeTerminalId: "term-a" } },
      ],
    } satisfies PaneNode;

    expect(pruneEmptyTerminalLeaves(removeTerminalSessionFromTree(initial, "term-a"))).toEqual(initial.children[0]);
  });
});
