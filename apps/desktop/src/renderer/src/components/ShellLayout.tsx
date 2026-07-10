import { useRef, useState, type ReactNode } from "react";
import { Globe2, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings, SlidersHorizontal, SquareTerminal, SunMedium, MoonStar, Monitor } from "lucide-react";

import { FileTree } from "./FileTree";
import { PaneTree } from "./PaneTree";
import type { PaneLeaf, PaneNodeId, PaneTreeActions, PaneNode } from "../hooks/usePaneTree";
import type { DragManager, DragPayload } from "../hooks/useDragManager";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { TreeNode, WorkspaceSearchResults } from "@exo/core";
import type { TerminalLaunchKind } from "../../../shared/api";

interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

interface IndexStatusLine {
  label: string;
  tone: "muted" | "ok" | "warn" | "info" | "error";
  title: string;
  busy: boolean;
}

interface TerminalStatusLine {
  label: string;
  tone: "muted" | "ok" | "warn" | "info" | "error";
  title: string;
  busy: boolean;
  sessionId: string;
}

interface ShellLayoutProps {
  noteSections: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  searchResultMode: WorkspaceSearchResultMode;
  searchResultQuery: string;
  searchMessage: string | null;
  statusLine: {
    workspaceLabel: string;
    onboardingIncomplete: boolean;
    terminal: TerminalStatusLine | null;
    index: IndexStatusLine;
  };
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
    sidePanesFlipped: boolean;
    sidebarWidth: number;
    startSidebarResize: (event: React.MouseEvent, inverted?: boolean) => void;
  };
  renderEditorLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  renderTerminalLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  dragManager: DragManager;
  revealExplorerPathRequest?: { path: string; nonce: number } | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onOpenIndexSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminalInDirectory: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind) => void;
  onCreateBrowserPane: () => void;
  terminalMonitorMode: boolean;
  onToggleTerminalMonitorMode: () => void;
}

export function ShellLayout(props: ShellLayoutProps) {
  const {
    noteSections,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchResults,
    searchResultMode,
    searchResultQuery,
    searchMessage,
    statusLine,
    shellLayout,
    renderEditorLeaf,
    renderTerminalLeaf,
    dragManager,
    revealExplorerPathRequest,
    onAppearanceModeChange,
    onOpenWorkspaceSettings,
    onOpenIndexSettings,
    onSearchQueryChange,
    onSearchSubmit,
    onOpenFile,
    onOpenTerminalSession,
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
    onCreateBrowserPane,
    terminalMonitorMode,
    onToggleTerminalMonitorMode,
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
    sidePanesFlipped,
    sidebarWidth,
    startSidebarResize,
  } = shellLayout;

  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelSection, setSidePanelSection] = useState<"files" | "browser" | "terminal" | "monitor">("terminal");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  const sidebarTrack = sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
  const sidebarResizerTrack = sidebarCollapsed ? "0px" : "1px";
  const shellGridTemplate = `${sidebarTrack} ${sidebarResizerTrack} minmax(0, 1fr)`;
  const workspaceLabel = statusLine.workspaceLabel || "my exograph";
  const WorkspaceAppearanceIcon = appearanceMode === "system" ? Monitor : appearanceMode === "light" ? SunMedium : MoonStar;

  const explorer = (
    <FileTree
      collapsed={sidebarCollapsed}
      noteRoots={noteSections}
      appearanceMode={appearanceMode}
      resolvedAppearance={resolvedAppearance}
      searchQuery={searchQuery}
      searchResults={searchResults}
      searchResultMode={searchResultMode}
      searchResultQuery={searchResultQuery}
      searchMessage={searchMessage}
      onAppearanceModeChange={onAppearanceModeChange}
      onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      onOpenWorkspaceSettings={onOpenWorkspaceSettings}
      onSearchQueryChange={onSearchQueryChange}
      onSearchSubmit={onSearchSubmit}
      onOpenFile={onOpenFile}
      onOpenTerminalSession={onOpenTerminalSession}
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
      mirrored={sidePanesFlipped}
      revealPathRequest={revealExplorerPathRequest}
    />
  );

  const renderSidebarResizer = (inverted: boolean) => sidebarCollapsed ? (
    <div aria-hidden />
  ) : (
    <div
      className="pane-split-resizer pane-split-resizer--vertical"
      onMouseDown={(event) => startSidebarResize(event, inverted)}
    />
  );

  const editorTree = (
    <PaneTree
      node={editorPaneTree.tree}
      actions={editorPaneTree.actions}
      focusedLeafId={editorPaneTree.focusedLeafId}
      renderLeaf={renderEditorLeaf}
      dropZone="workspace"
      hoverEdge={dragManager.hoverEdge}
    />
  );

  return (
    <div
      className="shell-frame"
      style={{
        gridTemplateColumns: sidePanelOpen ? "minmax(0, 1fr) var(--exo-side-panel-width)" : "minmax(0, 1fr) 0px",
      }}
    >
      <div className="window-chrome window-chrome--left">
        <button
          className="window-chrome__button"
          data-testid={sidebarCollapsed ? "sidebar-expand" : "sidebar-collapse"}
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? "Show files" : "Hide files"}
          type="button"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>
      <div className="window-chrome window-chrome--right">
        <button
          className={`window-chrome__button ${sidePanelOpen ? "window-chrome__button--active" : ""}`}
          data-testid="side-panel-toggle"
          onClick={() => setSidePanelOpen((current) => !current)}
          title={sidePanelOpen ? "Close side panel" : "Open side panel"}
          type="button"
        >
          {sidePanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </div>
      <div
        className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""} ${sidePanesFlipped ? "shell--side-panes-flipped" : ""}`}
        style={{ gridTemplateColumns: shellGridTemplate }}
      >
      {explorer}
      {renderSidebarResizer(false)}

      <div ref={workspaceRef} className="workspace">
        <div
          ref={(el) => { workspaceBodyRef.current = el; }}
          className="workspace__body"
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", overflow: "hidden" }}
        >
          {editorTree}
        </div>
      </div>

      {dragManager.drag ? (
        <div
          className="drag-ghost"
          style={{
            left: dragManager.drag.mouseX,
            top: dragManager.drag.mouseY,
          }}
        >
          {formatDragGhostLabel(dragManager.drag.payload)}
        </div>
      ) : null}
      </div>
      <aside
        aria-hidden={!sidePanelOpen}
        className={`exo-side-panel-shell ${sidePanelOpen ? "exo-side-panel-shell--open" : "exo-side-panel-shell--closed"}`}
        data-testid="exo-side-panel"
      >
          <nav className="exo-side-panel-rail" aria-label="Side panel sections">
            <button className={`exo-side-panel-rail__button ${sidePanelSection === "files" ? "exo-side-panel-rail__button--active" : ""}`} data-testid="side-panel-files-rail" onClick={() => { setSidePanelSection("files"); setSidebarCollapsed(false); }} title="Files" type="button">
              <PanelLeftOpen size={16} />
            </button>
            <button className={`exo-side-panel-rail__button ${sidePanelSection === "browser" ? "exo-side-panel-rail__button--active" : ""}`} data-testid="side-panel-browser-rail" onClick={() => { setSidePanelSection("browser"); onCreateBrowserPane(); }} title="Browser" type="button">
              <Globe2 size={16} />
            </button>
            <button
              className={`exo-side-panel-rail__button ${sidePanelSection === "terminal" ? "exo-side-panel-rail__button--active" : ""}`}
              data-testid="side-panel-terminal-rail"
              onClick={() => {
                setSidePanelSection("terminal");
                if (terminalCollapsed) {
                  setTerminalCollapsed(false);
                } else {
                  onCreateTerminal("shell");
                }
              }}
              title="Terminal"
              type="button"
            >
              <SquareTerminal size={16} />
            </button>
            <button
              className={`exo-side-panel-rail__button ${sidePanelSection === "monitor" || terminalMonitorMode ? "exo-side-panel-rail__button--active" : ""}`}
              data-testid="side-panel-monitor-mode-rail"
              aria-pressed={terminalMonitorMode}
              onClick={() => { setSidePanelSection("monitor"); onToggleTerminalMonitorMode(); }}
              title={terminalMonitorMode ? "Exit terminal monitor" : "Monitor terminals"}
              type="button"
            >
              <LayoutGrid size={16} />
            </button>
          </nav>
          <div className="exo-side-panel-surface" data-testid="side-panel-surface">
            <PaneTree
              node={terminalPaneTree.tree}
              actions={terminalPaneTree.actions}
              focusedLeafId={terminalPaneTree.focusedLeafId}
              renderLeaf={renderTerminalLeaf}
              dropZone="terminal-dock"
              hoverEdge={dragManager.hoverEdge}
            />
          </div>
      </aside>
      <div className="workspace-menu-anchor">
        <button
          className="workspace-menu-button"
          data-testid="workspace-menu-button"
          onClick={() => setWorkspaceMenuOpen((current) => !current)}
          title={`${workspaceLabel} menu`}
          type="button"
        >
          <span className="workspace-menu-button__mark">{workspaceLabel.slice(0, 1).toLowerCase()}</span>
          <span className="workspace-menu-button__label">{workspaceLabel}</span>
        </button>
        {workspaceMenuOpen ? (
          <div className="workspace-menu" data-testid="workspace-menu">
            <div className="workspace-menu__header">
              <span className="workspace-menu-button__mark">{workspaceLabel.slice(0, 1).toLowerCase()}</span>
              <span>{workspaceLabel}</span>
            </div>
            <button className="workspace-menu__item" onClick={onOpenIndexSettings} type="button">
              <SlidersHorizontal size={15} />
              <span>{statusLine.index.label}</span>
            </button>
            {statusLine.terminal ? (
              <button className="workspace-menu__item" onClick={() => onOpenTerminalSession(statusLine.terminal!.sessionId)} type="button">
                <SquareTerminal size={15} />
                <span>{statusLine.terminal.label}</span>
              </button>
            ) : null}
            <button
              className="workspace-menu__item"
              data-testid="workspace-appearance"
              onClick={() => {
                const nextMode = appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
                onAppearanceModeChange(nextMode);
              }}
              type="button"
            >
              <WorkspaceAppearanceIcon size={15} />
              <span>Appearance: {appearanceMode}</span>
            </button>
            <button className="workspace-menu__item" data-testid="workspace-settings" onClick={onOpenWorkspaceSettings} type="button">
              <Settings size={15} />
              <span>Settings</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDragGhostLabel(payload: DragPayload): string {
  if (payload.kind === "document") {
    return payload.filePath.split("/").pop() ?? payload.filePath;
  }
  if (payload.kind === "workspace-path") {
    return payload.path.split("/").pop() ?? payload.path;
  }
  if (payload.kind === "browser") {
    return "Preview";
  }
  return "Terminal";
}
