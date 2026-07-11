import type { ReactNode } from "react";
import type { WorkspaceSearchResults } from "@exo/core";

import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { DragManager } from "../hooks/useDragManager";
import type { PaneNode, PaneNodeId, PaneTreeActions } from "../hooks/usePaneTree";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import { FileTree, type ExplorerMode } from "./FileTree";
import type { RootSection } from "./ExplorerSections";
import { PaneTree } from "./PaneTree";

interface ShellLayoutProps {
  noteSections: RootSection[];
  attachedSections?: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  explorerMode: ExplorerMode;
  onExplorerModeChange: (mode: ExplorerMode) => void;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  searchResultMode: WorkspaceSearchResultMode;
  searchResultQuery: string;
  searchMessage: string | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  onToggleSidebar: () => void;
  onResizeSidebar: (event: React.MouseEvent) => void;
  canvas: PaneNode;
  focusedPaneId: PaneNodeId;
  canvasActions: PaneTreeActions;
  renderLeaf: (leaf: import("../hooks/usePaneTree").PaneLeaf, focused: boolean) => ReactNode;
  dragManager: DragManager;
  connections: ReactNode;
  revealExplorerPathRequest?: { path: string; nonce: number } | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenAttachedFile?: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminalInDirectory: (directoryPath: string) => void;
  onOpenPreview: () => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
}

export function ShellLayout(props: ShellLayoutProps) {
  return (
    <div className={`workspace-shell${props.sidebarCollapsed ? " workspace-shell--sidebar-collapsed" : ""}`}>
      <aside className="workspace-shell__explorer" style={{ width: props.sidebarCollapsed ? 0 : props.sidebarWidth }}>
        <FileTree
          attachedFolders={props.attachedSections}
          appearanceMode={props.appearanceMode}
          collapsed={props.sidebarCollapsed}
          dragManager={props.dragManager}
          explorerScale={props.explorerScale}
          mode={props.explorerMode}
          noteRoots={props.noteSections}
          onAppearanceModeChange={props.onAppearanceModeChange}
          onCreateDirectory={props.onCreateDirectory}
          onCreateFile={props.onCreateFile}
          onCreateTerminal={props.onCreateTerminalInDirectory}
          onOpenPreview={props.onOpenPreview}
          onDeletePath={props.onDeletePath}
          onExpandDirectory={props.onExpandDirectory}
          onFocusExplorer={props.onFocusExplorer}
          onModeChange={props.onExplorerModeChange}
          onOpenAttachedFile={props.onOpenAttachedFile}
          onOpenFile={props.onOpenFile}
          onOpenTag={props.onOpenTag}
          onOpenTerminalSession={props.onOpenTerminalSession}
          onOpenWorkspaceSettings={props.onOpenWorkspaceSettings}
          onRenamePath={props.onRenamePath}
          onSearchQueryChange={props.onSearchQueryChange}
          onSearchSubmit={props.onSearchSubmit}
          onToggleCollapsed={props.onToggleSidebar}
          resolvedAppearance={props.resolvedAppearance}
          revealPathRequest={props.revealExplorerPathRequest}
          searchMessage={props.searchMessage}
          searchQuery={props.searchQuery}
          searchResultMode={props.searchResultMode}
          searchResultQuery={props.searchResultQuery}
          searchResults={props.searchResults}
        />
      </aside>
      {!props.sidebarCollapsed ? <div className="pane-split-resizer pane-split-resizer--vertical" onMouseDown={props.onResizeSidebar} /> : null}
      <main className="workspace-shell__canvas">
        <PaneTree node={props.canvas} actions={props.canvasActions} focusedLeafId={props.focusedPaneId} renderLeaf={props.renderLeaf} hoverEdge={props.dragManager.hoverEdge} />
      </main>
      <aside className="workspace-shell__connections">{props.connections}</aside>
    </div>
  );
}
