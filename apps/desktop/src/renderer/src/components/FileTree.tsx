import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  ClipboardCopy,
  FilePlus2,
  FolderPlus,
  GitCompare,
  Monitor,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Settings,
  SquareTerminal,
  SunMedium,
  Trash2,
} from "lucide-react";
import type { WorkspaceSearchResults } from "@exo/core";
import type { WorkspaceGitChange } from "../../../shared/api";
import type { AppearanceMode, ResolvedAppearance } from "../App";
import type { DragManager } from "../hooks/useDragManager";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import { RailButton } from "./Chrome";
import {
  ROOT_GROUP_PREFIX,
  type ContextTarget,
  type RootSection,
  Section,
} from "./ExplorerSections";
import { SidebarDrawer } from "./SidebarDrawer";

interface FileTreeProps {
  noteRoots: RootSection[];
  projectRoots: RootSection[];
  collapsed: boolean;
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  searchResultMode: WorkspaceSearchResultMode;
  searchResultQuery: string;
  searchMessage: string | null;
  projectChanges: ProjectChangeView[];
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onToggleCollapsed: () => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes" | "projects") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  dragManager: DragManager;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminal: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  rail?: "inline" | "none";
  mirrored?: boolean;
  revealPathRequest?: { path: string; nonce: number } | null;
}

interface ProjectChangeView extends WorkspaceGitChange {
  rootPath: string;
  rootLabel: string;
  agents: Array<{ id: string; title: string; kind: string; cwd: string }>;
}

interface ExplorerRailProps {
  collapsed: boolean;
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onToggleCollapsed: () => void;
  onOpenWorkspaceSettings: () => void;
  topControls?: ReactNode;
}

export function ExplorerRailTopControls(props: Pick<ExplorerRailProps, "collapsed" | "onToggleCollapsed">) {
  const { collapsed, onToggleCollapsed } = props;
  return (
    <RailButton
      testId={collapsed ? "sidebar-expand" : "sidebar-collapse"}
      onClick={onToggleCollapsed}
      title={collapsed ? "Expand workspace" : "Collapse workspace"}
    >
      {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
    </RailButton>
  );
}

export function ExplorerRail(props: ExplorerRailProps) {
  const {
    collapsed,
    appearanceMode,
    resolvedAppearance,
    onAppearanceModeChange,
    onToggleCollapsed,
    onOpenWorkspaceSettings,
    topControls,
  } = props;

  const appearanceIcon = appearanceMode === "system" ? Monitor : appearanceMode === "light" ? SunMedium : MoonStar;
  const AppearanceIcon = appearanceIcon;

  function cycleAppearanceMode() {
    const nextMode = appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
    onAppearanceModeChange(nextMode);
  }

  return (
    <div className="sidebar__rail">
      <div className="sidebar__rail-top">
        {topControls ?? <ExplorerRailTopControls collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />}
      </div>
      <div className="sidebar__rail-bottom">
        <RailButton
          testId="appearance-cycle"
          onClick={cycleAppearanceMode}
          title={`Appearance: ${appearanceMode} (${resolvedAppearance}). Click to cycle.`}
        >
          <AppearanceIcon size={13} />
        </RailButton>
        <RailButton
          testId="workspace-settings"
          onClick={onOpenWorkspaceSettings}
          title="Workspace settings"
        >
          <Settings size={13} />
        </RailButton>
      </div>
    </div>
  );
}

export function FileTree(props: FileTreeProps) {
  const {
    noteRoots,
    projectRoots,
    collapsed,
    appearanceMode,
    resolvedAppearance,
    onAppearanceModeChange,
    onToggleCollapsed,
    onOpenWorkspaceSettings,
    onOpenFile,
    onOpenTerminalSession,
    projectChanges,
    onExpandDirectory,
    explorerScale,
    onFocusExplorer,
    dragManager,
    onCreateFile,
    onCreateDirectory,
    onCreateTerminal,
    onRenamePath,
    onDeletePath,
    rail = "inline",
    mirrored = false,
    revealPathRequest = null,
  } = props;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [projectRootsExpanded, setProjectRootsExpanded] = useState(false);
  const [explorerMode, setExplorerMode] = useState<"files" | "search">("files");
  const panesRef = useRef<HTMLDivElement | null>(null);
  const processedRevealNonceRef = useRef<number | null>(null);

  const defaultExpandedPaths = useMemo(() => {
    const next = new Set<string>();
    for (const root of [...noteRoots, ...projectRoots]) {
      next.add(`${ROOT_GROUP_PREFIX}${root.path}`);
    }
    return next;
  }, [noteRoots, projectRoots]);

  useEffect(() => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      for (const entry of defaultExpandedPaths) {
        next.add(entry);
      }
      return next;
    });
  }, [defaultExpandedPaths]);

  useEffect(() => {
    if (!revealPathRequest) {
      return;
    }
    if (processedRevealNonceRef.current === revealPathRequest.nonce) {
      return;
    }
    processedRevealNonceRef.current = revealPathRequest.nonce;

    const rootKind = rootKindForPath(revealPathRequest.path, noteRoots, projectRoots);
    setExpandedPaths((current) => {
      const next = new Set(current);
      next.add(revealPathRequest.path);
      next.add(`${ROOT_GROUP_PREFIX}${revealPathRequest.path}`);
      return next;
    });

    if (rootKind) {
      onExpandDirectory(revealPathRequest.path, rootKind);
    }
  }, [noteRoots, onExpandDirectory, projectRoots, revealPathRequest]);

  useEffect(() => {
    if (!contextTarget) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismissContextMenu();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextTarget]);

  function togglePath(path: string, rootKind?: "notes" | "projects") {
    const shouldExpand = !expandedPaths.has(path);
    if (shouldExpand && rootKind) {
      onExpandDirectory(path, rootKind);
    }
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function openContextMenu(event: React.MouseEvent, target: ContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    setContextTarget(target);
    setContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
  }

  function dismissContextMenu() {
    setContextTarget(null);
    setContextMenuPosition(null);
  }

  const sidebarStyle = { "--exo-explorer-scale": explorerScale } as CSSProperties;
  const primaryNoteRoot = noteRoots[0]?.path ?? null;

  function renderRail() {
    return (
      <ExplorerRail
        collapsed={collapsed}
        appearanceMode={appearanceMode}
        resolvedAppearance={resolvedAppearance}
        onAppearanceModeChange={onAppearanceModeChange}
        onToggleCollapsed={onToggleCollapsed}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
      />
    );
  }

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
        {rail === "inline" ? renderRail() : null}
      </aside>
    );
  }

  return (
    <aside className={`sidebar ${rail === "none" ? "sidebar--content-only" : ""} ${mirrored ? "sidebar--mirrored" : ""}`} data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
      {rail === "inline" ? renderRail() : null}

      <div className="sidebar__main">
        <div className="sidebar__toolbar" aria-label="Explorer actions">
          <button
            className="sidebar__toolbar-button"
            disabled={!primaryNoteRoot}
            data-testid="sidebar-new-note"
            onClick={() => primaryNoteRoot && onCreateFile(primaryNoteRoot)}
            title="New note"
            type="button"
          >
            <FilePlus2 size={14} />
          </button>
          <button
            className="sidebar__toolbar-button"
            disabled={!primaryNoteRoot}
            data-testid="sidebar-new-folder"
            onClick={() => primaryNoteRoot && onCreateDirectory(primaryNoteRoot)}
            title="New folder"
            type="button"
          >
            <FolderPlus size={14} />
          </button>
          <button
            className={`sidebar__toolbar-button ${explorerMode === "search" ? "sidebar__toolbar-button--active" : ""}`}
            data-testid="sidebar-search-toggle"
            onClick={() => setExplorerMode((current) => (current === "search" ? "files" : "search"))}
            title={explorerMode === "search" ? "Show files" : "Search notes"}
            type="button"
          >
            <Search size={14} />
          </button>
        </div>
        <div ref={panesRef} className="sidebar__panes">
          {explorerMode === "search" ? (
            <SidebarSearchPane
              query={props.searchQuery}
              results={props.searchResults.notes}
              resultMode={props.searchResultMode}
              resultQuery={props.searchResultQuery}
              message={props.searchMessage}
              onQueryChange={props.onSearchQueryChange}
              onSearchSubmit={props.onSearchSubmit}
              onOpenFile={onOpenFile}
            />
          ) : (
          <>
          <div
            className="sidebar__content sidebar__content--notes"
            data-explorer-drop-path={noteRoots.length === 1 ? noteRoots[0].path : undefined}
          >
            <Section
              label="Notes"
              rootKind="notes"
              showHeader={false}
              sections={noteRoots}
              expandedPaths={expandedPaths}
              onTogglePath={togglePath}
              onOpenFile={onOpenFile}
              dragManager={dragManager}
              onContextMenu={openContextMenu}
              mirrored={mirrored}
            />
          </div>

          <SidebarDrawer
            className="sidebar__drawer"
            collapsed={!projectRootsExpanded}
            label="Projects"
            summary={`${projectRoots.length} root${projectRoots.length === 1 ? "" : "s"}`}
            containerRef={panesRef}
            defaultOpenFraction={0.5}
            toggleTestId="project-roots-toggle"
            drawerTestId="project-roots-drawer"
            panelTestId="project-roots-panel"
            resizerTestId="project-roots-resizer"
            onCollapsedChange={(collapsed) => setProjectRootsExpanded(!collapsed)}
            mirrored={mirrored}
          >
            <ProjectChanges changes={projectChanges} onOpenFile={onOpenFile} onOpenTerminalSession={onOpenTerminalSession} />
            <Section
              label="Projects"
              rootKind="projects"
              sections={projectRoots}
              expandedPaths={expandedPaths}
              onTogglePath={togglePath}
              onOpenFile={onOpenFile}
              dragManager={dragManager}
              onContextMenu={openContextMenu}
              showHeader={false}
              alwaysShowRoots
              mirrored={mirrored}
            />
          </SidebarDrawer>
          </>
          )}
        </div>
      </div>

      {contextTarget && contextMenuPosition ? (
        <>
          <button
            aria-label="Dismiss context menu"
            className="tree-context-menu__backdrop"
            onClick={dismissContextMenu}
            type="button"
          />
          <div
            className="tree-context-menu"
            style={{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextTarget.kind === "directory" ? (
              <>
                <button
                  className="tree-context-menu__item"
                  onClick={() => {
                    dismissContextMenu();
                    onCreateFile(contextTarget.path);
                  }}
                  type="button"
                >
                  <FilePlus2 size={13} />
                  New File
                </button>
                <button
                  className="tree-context-menu__item"
                  onClick={() => {
                    dismissContextMenu();
                    onCreateDirectory(contextTarget.path);
                  }}
                  type="button"
                >
                  <FolderPlus size={13} />
                  New Folder
                </button>
                <button
                  className="tree-context-menu__item"
                  onClick={() => {
                    dismissContextMenu();
                    onCreateTerminal(contextTarget.path);
                  }}
                  type="button"
                >
                  <SquareTerminal size={13} />
                  New Terminal
                </button>
              </>
            ) : null}
            <button
              className="tree-context-menu__item"
              onClick={() => {
                const target = contextTarget.path;
                dismissContextMenu();
                void navigator.clipboard.writeText(target);
              }}
              type="button"
            >
              <ClipboardCopy size={13} />
              Copy Path
            </button>
            <button
              className="tree-context-menu__item"
              onClick={() => {
                dismissContextMenu();
                onRenamePath(contextTarget.path);
              }}
              type="button"
            >
              <Pencil size={13} />
              Rename
            </button>
            <button
              className="tree-context-menu__item tree-context-menu__item--danger"
              onClick={() => {
                dismissContextMenu();
                onDeletePath(contextTarget.path);
              }}
              type="button"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function ProjectChanges({
  changes,
  onOpenFile,
  onOpenTerminalSession,
}: {
  changes: ProjectChangeView[];
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
}) {
  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="project-changes" data-testid="project-changes">
      <div className="project-changes__title">
        <GitCompare size={13} />
        Changes
      </div>
      <div className="project-changes__list">
        {changes.slice(0, 20).map((change) => (
          <div className="project-change" key={`${change.rootPath}:${change.path}:${change.status}`}>
            <button
              className="project-change__file"
              onClick={() => onOpenFile(change.absolutePath, change.firstChangedLine)}
              title={`${change.status} ${change.absolutePath}`}
              type="button"
            >
              <span className="project-change__status">{change.status}</span>
              <span className="project-change__path">{change.path}</span>
              {change.firstChangedLine ? <span className="project-change__line">:{change.firstChangedLine}</span> : null}
              <span className="project-change__root">{change.rootLabel}</span>
            </button>
            {change.agents.length > 0 ? (
              <span className="project-change__agents">
                {change.agents.slice(0, 3).map((agent) => (
                  <button
                    className="project-change__agent"
                    data-testid={`project-change-agent-${agent.id}`}
                    key={agent.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTerminalSession(agent.id);
                    }}
                    title={`Show ${agent.title} in ${agent.cwd}`}
                    type="button"
                  >
                    {agent.kind}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function rootKindForPath(
  targetPath: string,
  noteRoots: RootSection[],
  projectRoots: RootSection[],
): "notes" | "projects" | null {
  if (noteRoots.some((root) => pathContains(root.path, targetPath))) {
    return "notes";
  }
  if (projectRoots.some((root) => pathContains(root.path, targetPath))) {
    return "projects";
  }
  return null;
}

function pathContains(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

function SidebarSearchPane({
  query,
  results,
  resultMode,
  resultQuery,
  message,
  onQueryChange,
  onSearchSubmit,
  onOpenFile,
}: {
  query: string;
  results: Array<{ filePath: string; title: string; snippet: string }>;
  resultMode: WorkspaceSearchResultMode;
  resultQuery: string;
  message: string | null;
  onQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string) => void;
}) {
  const summary = searchSummary({
    query: query.trim(),
    resultMode,
    resultQuery,
    message,
    resultCount: results.length,
  });

  return (
    <div className="sidebar-search" data-testid="sidebar-search-pane">
      <label className="sidebar-search__input-wrap">
        <Search size={14} />
        <input
          autoFocus
          data-testid="sidebar-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearchSubmit();
            }
          }}
          placeholder="Search filenames; Enter searches index"
        />
      </label>
      <div className="sidebar-search__summary">
        {summary}
      </div>
      <div className="sidebar-search__results">
        {results.map((result) => (
          <button
            key={result.filePath}
            className="sidebar-search-result"
            onClick={() => onOpenFile(result.filePath)}
            title={result.filePath}
            type="button"
          >
            <span className="sidebar-search-result__title">{result.title}</span>
            <span className="sidebar-search-result__snippet">{result.snippet || result.filePath}</span>
            <span className="sidebar-search-result__preview" aria-hidden>
              <strong>{result.title}</strong>
              <span>{result.snippet || result.filePath}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function searchSummary({
  query,
  resultMode,
  resultQuery,
  message,
  resultCount,
}: {
  query: string;
  resultMode: WorkspaceSearchResultMode;
  resultQuery: string;
  message: string | null;
  resultCount: number;
}): string {
  if (!query) {
    return "Type to search filenames. Press Enter for indexed search.";
  }
  if (resultMode === "index-loading") {
    return `Searching index for “${resultQuery}”…`;
  }
  if (resultMode === "index") {
    return `Indexed results for “${resultQuery}” · ${formatResultCount(resultCount)}`;
  }
  if (resultMode === "index-unavailable") {
    return message ?? `Index search unavailable. Showing ${formatResultCount(resultCount)}.`;
  }
  if (resultMode === "error") {
    return message ?? "Search failed.";
  }
  return `Filename results · ${formatResultCount(resultCount)}`;
}

function formatResultCount(resultCount: number): string {
  return `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"}`;
}
