import { useRef, type CSSProperties, type ReactNode } from "react";

import { ExplorerRail, ExplorerRailTopControls, FileTree } from "./FileTree";
import { TerminalRail, TerminalRailTopControls } from "./TerminalRail";
import { PaneTree } from "./PaneTree";
import type { PaneLeaf, PaneNodeId, PaneTreeActions, PaneNode } from "../hooks/usePaneTree";
import type { DragManager, DragPayload } from "../hooks/useDragManager";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { AgentHarnessDetection, TreeNode, WorkspaceSearchResults } from "@exo/core";
import type { TerminalLaunchKind, WorkspaceGitChange } from "../../../shared/api";
import exoGlyph from "../assets/exo-glyph.svg";

const RESIZER_TRACK_SIZE = "6px";

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
  projectSections: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  searchResultMode: WorkspaceSearchResultMode;
  searchResultQuery: string;
  searchMessage: string | null;
  projectChanges: Array<WorkspaceGitChange & {
    rootPath: string;
    rootLabel: string;
    agents: Array<{ id: string; title: string; kind: string; cwd: string; observed?: boolean; observedAt?: number | null }>;
  }>;
  statusLine: {
    workspaceLabel: string;
    projectLabel: string | null;
    gitBranch: string | null;
    gitDirty: boolean;
    changedFiles: number;
    changedNotes: number;
    pendingProposals: number;
    onboardingIncomplete: boolean;
    profileReviewRequired: boolean;
    profileLabel: string | null;
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
    setSidePanesFlipped: React.Dispatch<React.SetStateAction<boolean>>;
    zoneSplitRatio: number;
    startZoneResize: (event: React.MouseEvent, containerWidth: number, inverted?: boolean) => void;
    sidebarWidth: number;
    startSidebarResize: (event: React.MouseEvent, inverted?: boolean) => void;
  };
  renderEditorLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  renderTerminalLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  dragManager: DragManager;
  revealExplorerPathRequest?: { path: string; nonce: number } | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onOpenAgentConfigEditor: () => void;
  onOpenPluginManager: () => void;
  onOpenProposalReview: () => void;
  onOpenIndexSettings: () => void;
  onOpenProjectChanges: () => void;
  onOpenNoteChanges: () => void;
  onOpenProfileSettings: () => void;
  onOpenOnboardingSetup: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes" | "projects") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminalInDirectory: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind, harnessId?: string) => void;
  agentHarnesses: AgentHarnessDetection[];
  onCreateBrowserPane: () => void;
}

export function ShellLayout(props: ShellLayoutProps) {
  const {
    noteSections,
    projectSections,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchResults,
    searchResultMode,
    searchResultQuery,
    searchMessage,
    projectChanges,
    statusLine,
    shellLayout,
    renderEditorLeaf,
    renderTerminalLeaf,
    dragManager,
    revealExplorerPathRequest,
    onAppearanceModeChange,
    onOpenWorkspaceSettings,
    onOpenAgentConfigEditor,
    onOpenPluginManager,
    onOpenProposalReview,
    onOpenIndexSettings,
    onOpenProjectChanges,
    onOpenNoteChanges,
    onOpenProfileSettings,
    onOpenOnboardingSetup,
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
    agentHarnesses,
    onCreateBrowserPane,
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
    setSidePanesFlipped,
    zoneSplitRatio,
    startZoneResize,
    sidebarWidth,
    startSidebarResize,
  } = shellLayout;

  const zoneContainerRef = useRef<HTMLDivElement | null>(null);

  const zoneGridTemplate = terminalCollapsed
    ? "minmax(0, 1fr)"
    : sidePanesFlipped
      ? `minmax(0, ${1 - zoneSplitRatio}fr) ${RESIZER_TRACK_SIZE} minmax(0, ${zoneSplitRatio}fr)`
      : `minmax(0, ${zoneSplitRatio}fr) ${RESIZER_TRACK_SIZE} minmax(0, ${1 - zoneSplitRatio}fr)`;

  const sidebarTrack = sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
  const sidebarResizerTrack = sidebarCollapsed ? "0px" : "1px";
  const shellGridTemplate = sidePanesFlipped
    ? `42px 1fr ${sidebarResizerTrack} ${sidebarTrack} 42px`
    : `42px ${sidebarTrack} ${sidebarResizerTrack} 1fr 42px`;

  const explorerTopControls = (
    <ExplorerRailTopControls
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      onCreateBrowserPane={onCreateBrowserPane}
    />
  );
  const terminalTopControls = (
    <TerminalRailTopControls
      collapsed={terminalCollapsed}
      onToggleCollapsed={() => setTerminalCollapsed((current) => !current)}
      onOpenAgentConfigEditor={onOpenAgentConfigEditor}
      onCreateTerminal={onCreateTerminal}
      harnesses={agentHarnesses}
    />
  );

  const explorer = (
    <FileTree
      collapsed={sidebarCollapsed}
      noteRoots={noteSections}
      projectRoots={projectSections}
      appearanceMode={appearanceMode}
      resolvedAppearance={resolvedAppearance}
      searchQuery={searchQuery}
      searchResults={searchResults}
      searchResultMode={searchResultMode}
      searchResultQuery={searchResultQuery}
      searchMessage={searchMessage}
      projectChanges={projectChanges}
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
      rail="none"
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

  const terminalTree = terminalCollapsed ? null : (
    <PaneTree
      node={terminalPaneTree.tree}
      actions={terminalPaneTree.actions}
      focusedLeafId={terminalPaneTree.focusedLeafId}
      renderLeaf={renderTerminalLeaf}
      dropZone="terminal-dock"
      hoverEdge={dragManager.hoverEdge}
    />
  );

  return (
    <div className="shell-frame">
      <header className="topbar">
        <div className="topbar__spacer topbar__spacer--left" aria-hidden />
        <div className="topbar__title" aria-label="exograph">
          <span
            className="topbar__brand-icon"
            style={{ "--exo-brand-icon": `url("${exoGlyph}")` } as CSSProperties}
            aria-hidden="true"
          />
          <span className="topbar__brand-text">exograph</span>
        </div>
        <div className="topbar__spacer topbar__spacer--right" aria-hidden />
      </header>
      <div
        className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""} ${sidePanesFlipped ? "shell--side-panes-flipped" : ""}`}
        style={{ gridTemplateColumns: shellGridTemplate }}
      >
      <ExplorerRail
        collapsed={sidebarCollapsed}
        appearanceMode={appearanceMode}
        resolvedAppearance={resolvedAppearance}
        onAppearanceModeChange={onAppearanceModeChange}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onCreateBrowserPane={onCreateBrowserPane}
        topControls={sidePanesFlipped ? terminalTopControls : explorerTopControls}
      />
      {sidePanesFlipped ? null : explorer}
      {sidePanesFlipped ? null : renderSidebarResizer(false)}

      <div ref={workspaceRef} className="workspace">
        <div
          ref={(el) => { workspaceBodyRef.current = el; zoneContainerRef.current = el; }}
          className="workspace__body"
          style={{ display: "grid", gridTemplateColumns: zoneGridTemplate, overflow: "hidden" }}
        >
          {terminalCollapsed ? (
            editorTree
          ) : sidePanesFlipped ? (
            <>
              {terminalTree}
              <div
                className="pane-split-resizer pane-split-resizer--vertical"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const container = zoneContainerRef.current;
                  if (!container) return;
                  startZoneResize(event, container.getBoundingClientRect().width, true);
                }}
              />
              {editorTree}
            </>
          ) : (
            <>
              {editorTree}
              <div
                className="pane-split-resizer pane-split-resizer--vertical"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const container = zoneContainerRef.current;
                  if (!container) return;
                  startZoneResize(event, container.getBoundingClientRect().width);
                }}
              />
              {terminalTree}
            </>
          )}
        </div>
      </div>

      {sidePanesFlipped ? renderSidebarResizer(true) : null}
      {sidePanesFlipped ? explorer : null}

      <TerminalRail
        placement="right"
        collapsed={terminalCollapsed}
        sidePanesFlipped={sidePanesFlipped}
        topControls={sidePanesFlipped ? explorerTopControls : terminalTopControls}
        style={{}}
        onToggleCollapsed={() => setTerminalCollapsed((c) => !c)}
        onToggleSidePanes={() => setSidePanesFlipped((current) => !current)}
        onOpenAgentConfigEditor={onOpenAgentConfigEditor}
        onOpenPluginManager={onOpenPluginManager}
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
          {formatDragGhostLabel(dragManager.drag.payload)}
        </div>
      ) : null}
      </div>
      <footer className="statusbar" data-testid="statusbar">
        <div className="statusbar__group">
          <span>{statusLine.workspaceLabel}</span>
          {statusLine.projectLabel ? <span>{statusLine.projectLabel}</span> : null}
        </div>
        <div className="statusbar__group statusbar__group--right">
          {statusLine.terminal ? (
            <button
              className={`statusbar__item statusbar__item--${statusLine.terminal.tone}`}
              data-testid="statusbar-terminal"
              onClick={() => onOpenTerminalSession(statusLine.terminal!.sessionId)}
              title={statusLine.terminal.title}
              type="button"
            >
              <span className="statusbar__item-dot" aria-hidden="true" />
              <span>{statusLine.terminal.label}</span>
              {statusLine.terminal.busy ? <span className="statusbar__ellipsis" aria-hidden="true" /> : null}
            </button>
          ) : null}
          <button
            className={`statusbar__item statusbar__item--${statusLine.index.tone}`}
            data-testid="statusbar-index"
            onClick={onOpenIndexSettings}
            title={statusLine.index.title}
            type="button"
          >
            <span className="statusbar__item-dot" aria-hidden="true" />
            <span>{statusLine.index.label}</span>
            {statusLine.index.busy ? <span className="statusbar__ellipsis" aria-hidden="true" /> : null}
          </button>
          {statusLine.gitBranch ? (
            <span>
              {statusLine.gitBranch}
              {statusLine.gitDirty ? "*" : ""}
            </span>
          ) : null}
          {statusLine.profileReviewRequired ? (
            <button
              className="statusbar__changes statusbar__changes--profile"
              data-testid="statusbar-profile-review"
              onClick={onOpenProfileSettings}
              title={statusLine.profileLabel ? `${statusLine.profileLabel} has changes to review` : "Profile has changes to review"}
              type="button"
            >
              Profile review
            </button>
          ) : null}
          {statusLine.onboardingIncomplete ? (
            <button
              className="statusbar__changes statusbar__changes--profile"
              data-testid="statusbar-finish-setup"
              onClick={onOpenOnboardingSetup}
              title="Finish workspace profile setup"
              type="button"
            >
              Finish setup
            </button>
          ) : null}
          {statusLine.pendingProposals > 0 ? (
            <button
              className="statusbar__changes statusbar__changes--proposals"
              data-testid="statusbar-proposals"
              onClick={onOpenProposalReview}
              title="Review proposed workspace changes"
              type="button"
            >
              {statusLine.pendingProposals} proposal{statusLine.pendingProposals === 1 ? "" : "s"}
            </button>
          ) : null}
          {statusLine.changedNotes > 0 ? (
            <button
              className="statusbar__changes statusbar__changes--notes"
              data-testid="statusbar-note-changes"
              onClick={onOpenNoteChanges}
              title="Open changed notes"
              type="button"
            >
              {statusLine.changedNotes} note{statusLine.changedNotes === 1 ? "" : "s"}
            </button>
          ) : null}
          {statusLine.changedFiles > 0 ? (
            <button
              className="statusbar__changes"
              data-testid="statusbar-changes"
              onClick={onOpenProjectChanges}
              title="Open changed project files"
              type="button"
            >
              {statusLine.changedFiles} change{statusLine.changedFiles === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      </footer>
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
