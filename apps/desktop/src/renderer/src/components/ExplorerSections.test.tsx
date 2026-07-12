import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FileTree,
  SidebarSearchPane,
  searchResultGroups,
  searchSummary,
} from "./FileTree";
import type { DragManager } from "../hooks/useDragManager";

const noDrag: DragManager = {
  drag: null,
  dragActive: false,
  hoverEdge: null,
  startDrag: () => undefined,
};

describe("Explorer search presentation", () => {
  it("shows Note Root results only", () => {
    const groups = searchResultGroups({
      notes: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "A note", kind: "note" }],
      tags: [],
    });

    expect(groups).toEqual([
      { label: "Notes", results: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "A note", kind: "note" }] },
    ]);
  });

  it("reports the actual search mode instead of implying indexed search", () => {
    expect(searchSummary({ query: "", resultMode: "idle", resultQuery: "", message: null, resultCount: 0 }))
      .toBe("Type to search filenames. Press Enter for advanced search.");
    expect(searchSummary({ query: "graph", resultMode: "index-unavailable", resultQuery: "graph", message: null, resultCount: 2 }))
      .toBe("Advanced search unavailable. Showing 2 results.");
  });
});

describe("Explorer mutation boundary", () => {
  it("renders creation actions without an alternate filesystem surface", () => {
    const markup = renderToStaticMarkup(
      <FileTree
        appearanceMode="system"
        collapsed={false}
        dragManager={noDrag}
        explorerScale={1}
        noteRoots={[{ label: "Notes", path: "/notes", nodes: [] }]}
        onAppearanceModeChange={() => undefined}
        onCreateDirectory={() => undefined}
        onCreateFile={() => undefined}
        onCreateTerminal={() => undefined}
        onDeletePath={() => undefined}
        onExpandDirectory={() => undefined}
        onFocusExplorer={() => undefined}
        onOpenFile={() => undefined}
        onOpenTag={() => undefined}
        onOpenTerminalSession={() => undefined}
        onRenamePath={() => undefined}
        onToggleCollapsed={() => undefined}
        resolvedAppearance="dark"
      />,
    );

    expect(markup).not.toContain('data-testid="explorer-files"');
    expect(markup).not.toContain('data-testid="explorer-search"');
    expect(markup).toContain("New note");
    expect(markup).toContain("New folder");
    expect(markup).not.toContain("Attached folders");
  });

  it("renders search results independently from the explorer tree", () => {
    const markup = renderToStaticMarkup(
      <SidebarSearchPane query="idea" resultMode="filename" resultQuery="idea" message={null} results={{ notes: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "Match", kind: "note" }], tags: [] }} onOpenFile={() => undefined} />,
    );

    expect(markup).toContain('data-testid="sidebar-search-pane"');
    expect(markup).toContain("Idea");
  });
});
