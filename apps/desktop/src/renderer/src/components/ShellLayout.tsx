import { useRef, type ReactNode } from "react";
import { Search } from "lucide-react";

import { FileTree } from "./FileTree";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { TerminalRail } from "./TerminalRail";
import { PaneTree } from "./PaneTree";
import type { PaneLeaf, PaneNodeId, PaneTreeActions, PaneNode } from "../hooks/usePaneTree";
import type { DragManager } from "../hooks/useDragManager";
import type { AppearanceMode, ResolvedAppearance } from "../App";
import type { TreeNode, WorkspaceSearchResults } from "@exo/core";

interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

interface ShellLayoutProps {
  noteSections: RootSection[];
  projectSections: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchSubmittedQuery: string;
  searchResults: WorkspaceSearchResults;
  statusLine: {
    workspaceLabel: string;
    projectLabel: string | null;
    gitBranch: string | null;
    gitDirty: boolean;
  };
  onSearchSubmit: () => void;
  onSearchClear: () => void;
  shellLayout: {
    workspaceRef: React.RefObject<HTMLDivElement | null>;
    workspaceBodyRef: React.RefObject<HTMLDivElement | null>;
    sidebarCollapsed: boolean;
    setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    inspectorCollapsed: boolean;
    setInspectorCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    editorPaneTree: {
      tree: PaneNode;
      focusedLeafId: PaneNodeId;
      actions: PaneTreeActions;
    };
    terminalPaneTree: {
      tree: PaneNode;
      focusedLeafId: PaneNodeId;
      actions: PaneTreeActions;
    };
    terminalCollapsed: boolean;
    setTerminalCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    zoneSplitRatio: number;
    startZoneResize: (event: React.MouseEvent, containerWidth: number) => void;
    sidebarWidth: number;
    startSidebarResize: (event: React.MouseEvent) => void;
  };
  renderEditorLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  renderTerminalLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  dragManager: DragManager;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes" | "projects") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminalInDirectory: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  onCreateTerminal: (kind: "shell" | "claude" | "codex") => void;
}

export function ShellLayout(props: ShellLayoutProps) {
  const {
    noteSections,
    projectSections,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchSubmittedQuery,
    searchResults,
    statusLine,
    onSearchSubmit,
    onSearchClear,
    shellLayout,
    renderEditorLeaf,
    renderTerminalLeaf,
    dragManager,
    onAppearanceModeChange,
    onOpenWorkspaceSettings,
    onSearchQueryChange,
    onOpenFile,
    onOpenTag,
    onExpandDirectory,
    explorerScale,
    onFocusExplorer,
    onCreateFile,
    onCreateDirectory,
    onCreateTerminalInDirectory,
    onRenamePath,
    onDeletePath,
    onCreateTerminal,
  } = props;

  const {
    workspaceRef,
    workspaceBodyRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    editorPaneTree,
    terminalPaneTree,
    terminalCollapsed,
    setTerminalCollapsed,
    zoneSplitRatio,
    startZoneResize,
    sidebarWidth,
    startSidebarResize,
  } = shellLayout;

  const zoneContainerRef = useRef<HTMLDivElement | null>(null);

  const zoneGridTemplate = terminalCollapsed
    ? "minmax(0, 1fr)"
    : `minmax(0, ${zoneSplitRatio}fr) 1px minmax(0, ${1 - zoneSplitRatio}fr)`;

  const sidebarTrack = sidebarCollapsed ? "48px" : `${sidebarWidth}px`;
  const sidebarResizerTrack = sidebarCollapsed ? "0px" : "1px";

  return (
    <div className="shell-frame">
      <header className="topbar">
        <div className="topbar__spacer topbar__spacer--left" aria-hidden />
        <label className="topbar__search" htmlFor="workspace-search">
          <Search size={13} />
          <input
            id="workspace-search"
            data-testid="workspace-search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearchSubmit();
              } else if (event.key === "Escape") {
                onSearchClear();
              }
            }}
            placeholder="Search notes"
          />
        </label>
        <div className="topbar__spacer topbar__spacer--right" aria-hidden />
      </header>
      {searchSubmittedQuery ? (
        <SearchResultsPanel
          query={searchSubmittedQuery}
          results={searchResults}
          onOpenFile={(filePath) => {
            onOpenFile(filePath);
            onSearchClear();
          }}
          onOpenTag={(tag) => {
            onOpenTag(tag);
            onSearchClear();
          }}
          onDismiss={onSearchClear}
        />
      ) : null}
      <div
        className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""}`}
        style={{ gridTemplateColumns: `${sidebarTrack} ${sidebarResizerTrack} 1fr 42px` }}
      >
      <FileTree
        collapsed={sidebarCollapsed}
        noteRoots={noteSections}
        projectRoots={projectSections}
        appearanceMode={appearanceMode}
        resolvedAppearance={resolvedAppearance}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onAppearanceModeChange={onAppearanceModeChange}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onSearchQueryChange={onSearchQueryChange}
        onOpenFile={onOpenFile}
        onOpenTag={onOpenTag}
        onExpandDirectory={onExpandDirectory}
        explorerScale={explorerScale}
        onFocusExplorer={onFocusExplorer}
        dragManager={dragManager}
        onCreateFile={onCreateFile}
        onCreateDirectory={onCreateDirectory}
        onCreateTerminal={onCreateTerminalInDirectory}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
      />

      {sidebarCollapsed ? (
        <div aria-hidden />
      ) : (
        <div
          className="pane-split-resizer pane-split-resizer--vertical"
          onMouseDown={startSidebarResize}
        />
      )}

      <div ref={workspaceRef} className="workspace">
        <div
          ref={(el) => { workspaceBodyRef.current = el; zoneContainerRef.current = el; }}
          className="workspace__body"
          style={{ display: "grid", gridTemplateColumns: zoneGridTemplate, overflow: "hidden" }}
        >
          <PaneTree
            node={editorPaneTree.tree}
            actions={editorPaneTree.actions}
            focusedLeafId={editorPaneTree.focusedLeafId}
            renderLeaf={renderEditorLeaf}
            hoverEdge={dragManager.hoverEdge}
          />
          {terminalCollapsed ? null : (
            <>
              <div
                className="pane-split-resizer pane-split-resizer--vertical"
                onMouseDown={(event) => {
                  const container = zoneContainerRef.current;
                  if (!container) return;
                  startZoneResize(event, container.getBoundingClientRect().width);
                }}
              />
              <PaneTree
                node={terminalPaneTree.tree}
                actions={terminalPaneTree.actions}
                focusedLeafId={terminalPaneTree.focusedLeafId}
                renderLeaf={renderTerminalLeaf}
                hoverEdge={dragManager.hoverEdge}
              />
            </>
          )}
        </div>
      </div>

      <TerminalRail
        placement="right"
        collapsed={terminalCollapsed}
        style={{}}
        onToggleCollapsed={() => setTerminalCollapsed((c) => !c)}
        onCreateTerminal={onCreateTerminal}
      />

      {dragManager.drag ? (
        <div
          className="drag-ghost"
          style={{
            left: dragManager.drag.mouseX,
            top: dragManager.drag.mouseY,
          }}
        >
          {dragManager.drag.payload.kind === "document"
            ? dragManager.drag.payload.filePath.split("/").pop()
            : "Terminal"}
        </div>
      ) : null}
      </div>
      <footer className="statusbar" data-testid="statusbar">
        <div className="statusbar__group">
          <span>{statusLine.workspaceLabel}</span>
          {statusLine.projectLabel ? <span>{statusLine.projectLabel}</span> : null}
        </div>
        <div className="statusbar__group statusbar__group--right">
          {statusLine.gitBranch ? (
            <span>
              {statusLine.gitBranch}
              {statusLine.gitDirty ? "*" : ""}
            </span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
