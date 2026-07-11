import type { ReactNode } from "react";
import type { WorkspaceSearchResults } from "@exo/core";
import { ChevronRight, FileText, Folder, Globe2, Network, PanelLeft, PanelRight, SquareTerminal } from "lucide-react";

import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { DragManager } from "../hooks/useDragManager";
import type { PaneNode, PaneNodeId, PaneTreeActions } from "../hooks/usePaneTree";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import { FileTree } from "./FileTree";
import type { RootSection } from "./ExplorerSections";
import { PaneTree } from "./PaneTree";
import { WorkspaceMenu } from "./WorkspaceMenu";
import type { WorkspaceBreadcrumbSegment } from "../workspaceBreadcrumb";
import { WorkspaceSearchField } from "./WorkspaceSearchField";

interface ShellLayoutProps {
  titleSegments: WorkspaceBreadcrumbSegment[];
  workspaceLabel: string;
  missingFolderIndexCount: number;
  noteSections: RootSection[];
  attachedSections?: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
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
  utilityContent: ReactNode;
  utilitySurface: "terminal" | "preview" | "connections";
  utilityOpen: boolean;
  onToggleUtility: () => void;
  onOpenUtilityBrowser: () => void;
  onOpenUtilityTerminal: () => void;
  connections: ReactNode;
  revealExplorerPathRequest?: { path: string; nonce: number } | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onCreateMissingFolderIndexes: () => void;
  connectionsOpen: boolean;
  onOpenConnections: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSearchClear: () => void;
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
  onOpenTitleSegment: (segment: WorkspaceBreadcrumbSegment) => void;
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
          <div className="workspace-titlebar__title" data-testid="workspace-title" title={props.titleSegments.map((segment) => segment.label).join(" / ")}>
            {props.titleSegments.map((segment, index) => (
              <span className="workspace-titlebar__crumb" key={segment.path}>
                {index > 0 ? <ChevronRight className="workspace-titlebar__chevron" size={12} strokeWidth={1.75} aria-hidden="true" /> : null}
                <button className={`workspace-titlebar__segment workspace-titlebar__segment--${segment.kind}`} onClick={() => props.onOpenTitleSegment(segment)} type="button">
                  {segment.kind === "folder" ? <Folder size={14} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
                  <span>{segment.label}</span>
                </button>
              </span>
            ))}
          </div>
        </div>
        <WorkspaceSearchField query={props.searchQuery} onChange={props.onSearchQueryChange} onClear={props.onSearchClear} onSubmit={props.onSearchSubmit} />
        <div className="workspace-titlebar__actions">
          <button aria-label={props.utilityOpen ? "Hide utility pane" : "Show utility pane"} aria-pressed={props.utilityOpen} className="workspace-titlebar__button" data-testid="utility-pane-toggle" onClick={props.onToggleUtility} title={props.utilityOpen ? "Hide utility pane" : "Show utility pane"} type="button">
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={`workspace-shell${props.sidebarCollapsed ? " workspace-shell--sidebar-collapsed" : ""}${props.utilityOpen ? " workspace-shell--utility-open" : ""}`}>
      <aside className="workspace-shell__explorer" style={{ width: props.sidebarCollapsed ? 0 : props.sidebarWidth }}>
        <FileTree
          attachedFolders={props.attachedSections}
          appearanceMode={props.appearanceMode}
          collapsed={props.sidebarCollapsed}
          dragManager={props.dragManager}
          explorerScale={props.explorerScale}
          searchActive={props.searchQuery.trim().length > 0}
          noteRoots={props.noteSections}
          onAppearanceModeChange={props.onAppearanceModeChange}
          onCreateDirectory={props.onCreateDirectory}
          onCreateFile={props.onCreateFile}
          onCreateTerminal={props.onCreateTerminalInDirectory}
          onOpenPreview={props.onOpenPreview}
          onDeletePath={props.onDeletePath}
          onExpandDirectory={props.onExpandDirectory}
          onFocusExplorer={props.onFocusExplorer}
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
          <button aria-label="Open preview" aria-pressed={props.utilityOpen && props.utilitySurface === "preview"} className="workspace-utility-rail__button" data-testid="utility-pane-preview" onClick={props.onOpenUtilityBrowser} title="Preview" type="button"><Globe2 size={16} aria-hidden="true" /></button>
          <button aria-label="Open terminal" aria-pressed={props.utilityOpen && props.utilitySurface === "terminal"} className="workspace-utility-rail__button" data-testid="utility-pane-terminal" onClick={props.onOpenUtilityTerminal} title="Terminal" type="button"><SquareTerminal size={16} aria-hidden="true" /></button>
          <button aria-label="Open connections" aria-pressed={props.connectionsOpen} className="workspace-utility-rail__button" data-testid="utility-pane-connections" onClick={props.onOpenConnections} title="Connections" type="button"><Network size={16} aria-hidden="true" /></button>
        </nav>
        <div className="workspace-utility-surface">
          {props.connectionsOpen
            ? props.connections
            : props.utilityContent}
        </div>
      </aside>
      </div>
      <WorkspaceMenu collapsed={props.sidebarCollapsed} label={props.workspaceLabel} missingFolderIndexCount={props.missingFolderIndexCount} onCreateMissingFolderIndexes={props.onCreateMissingFolderIndexes} onOpenSettings={props.onOpenWorkspaceSettings} />
    </div>
  );
}
