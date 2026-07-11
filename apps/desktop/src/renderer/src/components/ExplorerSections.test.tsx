import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FileTree,
  isExplorerMutationAllowed,
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
  it("keeps note and attached-folder results distinct", () => {
    const groups = searchResultGroups({
      notes: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "A note", kind: "note" }],
      projectFiles: [{ filePath: "/attached/readme.md", title: "Readme", snippet: "Context", kind: "project-file" }],
      tags: [],
    });

    expect(groups).toEqual([
      { label: "Notes", results: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "A note", kind: "note" }] },
      { label: "Attached folders", results: [{ filePath: "/attached/readme.md", title: "Readme", snippet: "Context", kind: "project-file" }] },
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
  it("allows filesystem mutations only under Note Roots", () => {
    expect(isExplorerMutationAllowed("notes")).toBe(true);
    expect(isExplorerMutationAllowed("attached")).toBe(false);
  });

  it("renders creation actions and attached folders without dead mode controls", () => {
    const markup = renderToStaticMarkup(
      <FileTree
        attachedFolders={[{ label: "Reference", path: "/attached", nodes: [{ id: "attached-source", kind: "directory", name: "source", path: "/attached/source", children: [] }] }]}
        appearanceMode="system"
        collapsed={false}
        dragManager={noDrag}
        explorerScale={1}
        mode="files"
        noteRoots={[{ label: "Notes", path: "/notes", nodes: [] }]}
        onAppearanceModeChange={() => undefined}
        onCreateDirectory={() => undefined}
        onCreateFile={() => undefined}
        onCreateTerminal={() => undefined}
        onOpenPreview={() => undefined}
        onDeletePath={() => undefined}
        onExpandDirectory={() => undefined}
        onFocusExplorer={() => undefined}
        onModeChange={() => undefined}
        onOpenAttachedFile={() => undefined}
        onOpenFile={() => undefined}
        onOpenTag={() => undefined}
        onOpenTerminalSession={() => undefined}
        onRenamePath={() => undefined}
        onSearchQueryChange={() => undefined}
        onSearchSubmit={() => undefined}
        onToggleCollapsed={() => undefined}
        resolvedAppearance="dark"
        searchMessage={null}
        searchQuery=""
        searchResultMode="idle"
        searchResultQuery=""
        searchResults={{ notes: [], projectFiles: [], tags: [] }}
      />,
    );

    expect(markup).not.toContain('data-testid="explorer-files"');
    expect(markup).not.toContain('data-testid="explorer-search"');
    expect(markup).toContain("New note");
    expect(markup).toContain("New folder");
    expect(markup).toContain("Attached folders");
    expect(markup).not.toContain('data-explorer-drop-path="/attached/source"');
  });

  it("replaces the file tree with search results when titlebar search is active", () => {
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
        onOpenPreview={() => undefined}
        onDeletePath={() => undefined}
        onExpandDirectory={() => undefined}
        onFocusExplorer={() => undefined}
        onOpenFile={() => undefined}
        onOpenTag={() => undefined}
        onOpenTerminalSession={() => undefined}
        onRenamePath={() => undefined}
        onSearchQueryChange={() => undefined}
        onSearchSubmit={() => undefined}
        onToggleCollapsed={() => undefined}
        resolvedAppearance="dark"
        searchActive
        searchMessage={null}
        searchQuery="idea"
        searchResultMode="filename"
        searchResultQuery="idea"
        searchResults={{ notes: [{ filePath: "/notes/idea.md", title: "Idea", snippet: "Match", kind: "note" }], projectFiles: [], tags: [] }}
      />,
    );

    expect(markup).toContain('data-testid="sidebar-search-pane"');
    expect(markup).toContain("Idea");
    expect(markup).not.toContain('data-explorer-drop-path="/notes"');
    expect(markup).not.toContain('data-testid="sidebar-search-input"');
  });
});
