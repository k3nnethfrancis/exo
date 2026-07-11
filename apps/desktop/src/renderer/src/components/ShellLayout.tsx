import type { ReactNode } from "react";
import type { WorkspaceSearchResults } from "@exo/core";
import { Folder, Globe2, PanelLeft, PanelRight, Settings, SquareTerminal } from "lucide-react";

import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { DragManager } from "../hooks/useDragManager";
import type { PaneNode, PaneNodeId, PaneTreeActions } from "../hooks/usePaneTree";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import { FileTree, type ExplorerMode } from "./FileTree";
import type { RootSection } from "./ExplorerSections";
import { PaneTree } from "./PaneTree";
import { WorkspaceMenu } from "./WorkspaceMenu";

interface ShellLayoutProps {
  titleSegments: string[];
  workspaceLabel: string;
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
  utilityCanvas: PaneNode;
  utilityFocusedPaneId: PaneNodeId;
  utilityCanvasActions: PaneTreeActions;
  utilityOpen: boolean;
  onToggleUtility: () => void;
  onOpenUtilityBrowser: () => void;
  onCreateUtilityTerminal: () => void;
  connections: ReactNode;
  revealExplorerPathRequest?: { path: string; nonce: number } | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  connectionsOpen: boolean;
  onToggleConnections: () => void;
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
    <div className="workspace-frame">
      <header className="workspace-titlebar" data-testid="workspace-titlebar">
        <div className="workspace-titlebar__identity">
          <button
            aria-label={props.sidebarCollapsed ? "Show explorer" : "Hide explorer"}
            aria-pressed={!props.sidebarCollapsed}
            className="workspace-titlebar__button"
            data-testid="workspace-titlebar-sidebar"
            onClick={props.onToggleSidebar}
            title={props.sidebarCollapsed ? "Show explorer" : "Hide explorer"}
            type="button"
          >
            <PanelLeft size={16} aria-hidden="true" />
          </button>
          <span className="workspace-titlebar__divider" aria-hidden="true" />
          <Folder className="workspace-titlebar__document-icon" size={17} aria-hidden="true" />
          <div className="workspace-titlebar__title" data-testid="workspace-title" title={props.titleSegments.join(" / ")}>
            {props.titleSegments.map((segment, index) => (
              <span className="workspace-titlebar__crumb" key={`${segment}-${index}`}>
                {index > 0 ? <span className="workspace-titlebar__chevron" aria-hidden="true">›</span> : null}
                {segment}
              </span>
            ))}
          </div>
        </div>
        <div className="workspace-titlebar__actions">
          <button aria-label="Workspace settings" className="workspace-titlebar__button" data-testid="workspace-titlebar-settings" onClick={props.onOpenWorkspaceSettings} title="Workspace settings" type="button">
            <Settings size={16} aria-hidden="true" />
          </button>
          <button aria-label={props.utilityOpen ? "Hide utility pane" : "Show utility pane"} aria-pressed={props.utilityOpen} className="workspace-titlebar__button" data-testid="utility-pane-toggle" onClick={props.onToggleUtility} title={props.utilityOpen ? "Hide utility pane" : "Show utility pane"} type="button">
            <PanelRight size={16} aria-hidden="true" />
          </button>
          <button aria-label="Toggle connections" aria-pressed={props.connectionsOpen} className="workspace-titlebar__button" data-testid="workspace-titlebar-connections" onClick={props.onToggleConnections} title="Connections" type="button">
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={`workspace-shell${props.sidebarCollapsed ? " workspace-shell--sidebar-collapsed" : ""}${props.utilityOpen ? " workspace-shell--utility-open" : ""}${props.connectionsOpen ? " workspace-shell--connections-open" : ""}`}>
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
      <aside aria-hidden={!props.utilityOpen} className="workspace-shell__utility" data-testid="utility-pane">
        <nav className="workspace-utility-rail" aria-label="Utility pane">
          <button aria-label="Open preview" className="workspace-utility-rail__button" data-testid="utility-pane-preview" onClick={props.onOpenUtilityBrowser} title="Preview" type="button"><Globe2 size={16} aria-hidden="true" /></button>
          <button aria-label="Open terminal" className="workspace-utility-rail__button" data-testid="utility-pane-terminal" onClick={props.onCreateUtilityTerminal} title="Terminal" type="button"><SquareTerminal size={16} aria-hidden="true" /></button>
        </nav>
        <div className="workspace-utility-surface">
          <PaneTree node={props.utilityCanvas} actions={props.utilityCanvasActions} focusedLeafId={props.utilityFocusedPaneId} renderLeaf={props.renderLeaf} hoverEdge={props.dragManager.hoverEdge} />
        </div>
      </aside>
        <aside className="workspace-shell__connections">{props.connections}</aside>
      </div>
      <WorkspaceMenu collapsed={props.sidebarCollapsed} label={props.workspaceLabel} onOpenSettings={props.onOpenWorkspaceSettings} />
    </div>
  );
}
