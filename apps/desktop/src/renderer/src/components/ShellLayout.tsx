import { useRef, type ReactNode } from "react";

import { FileTree } from "./FileTree";
import { TerminalRail } from "./TerminalRail";
import { PaneTree } from "./PaneTree";
import type { PaneLeaf, PaneNodeId, PaneTreeActions, PaneNode } from "../hooks/usePaneTree";
import { collectLeaves } from "../hooks/usePaneTree";
import type { DragManager } from "../hooks/useDragManager";
import type { AppearanceMode, ResolvedAppearance } from "../App";
import type { NoteDocument, NoteKnowledge, SearchResult, TreeNode, WorkspaceSearchResults } from "@exo/core";

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
  searchResults: WorkspaceSearchResults;
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
    zoneSplitRatio: number;
    startZoneResize: (event: React.MouseEvent, containerWidth: number) => void;
  };
  renderEditorLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  renderTerminalLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  dragManager: DragManager;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
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
    searchResults,
    shellLayout,
    renderEditorLeaf,
    renderTerminalLeaf,
    dragManager,
    onAppearanceModeChange,
    onOpenWorkspaceSettings,
    onSearchQueryChange,
    onOpenFile,
    onOpenTag,
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
    zoneSplitRatio,
    startZoneResize,
  } = shellLayout;

  const zoneContainerRef = useRef<HTMLDivElement | null>(null);

  const zoneGridTemplate = `minmax(0, ${zoneSplitRatio}fr) 8px minmax(0, ${1 - zoneSplitRatio}fr)`;

  return (
    <div
      className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""}`}
      style={{ gridTemplateColumns: `${sidebarCollapsed ? 48 : 240}px 1fr 42px` }}
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
        dragManager={dragManager}
        onCreateFile={onCreateFile}
        onCreateDirectory={onCreateDirectory}
        onCreateTerminal={onCreateTerminalInDirectory}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
      />

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
        </div>
      </div>

      <TerminalRail
        placement="right"
        collapsed={false}
        style={{}}
        onToggleCollapsed={() => {
          onCreateTerminal("shell");
        }}
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
  );
}
