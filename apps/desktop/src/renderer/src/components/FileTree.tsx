import { useEffect, useMemo, useRef, useState } from "react";

import {
  ClipboardCopy,
  FilePlus2,
  FolderPlus,
  Monitor,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Settings2,
  SquareTerminal,
  SunMedium,
  Trash2,
} from "lucide-react";
import type { SemanticSearchResult, WorkspaceSearchResults } from "@exo/core";
import type { AppearanceMode, ResolvedAppearance } from "../App";
import type { DragManager } from "../hooks/useDragManager";
import { RailButton } from "./Chrome";
import {
  ROOT_GROUP_PREFIX,
  type ContextTarget,
  type RootSection,
  SearchSection,
  Section,
  TagSearchSection,
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
  semanticResults: SemanticSearchResult[];
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onToggleCollapsed: () => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  dragManager: DragManager;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminal: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
}


export function FileTree(props: FileTreeProps) {
  const {
    noteRoots,
    projectRoots,
    collapsed,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchResults,
    semanticResults,
    onAppearanceModeChange,
    onToggleCollapsed,
    onOpenWorkspaceSettings,
    onSearchQueryChange,
    onOpenFile,
    onOpenTag,
    dragManager,
    onCreateFile,
    onCreateDirectory,
    onCreateTerminal,
    onRenamePath,
    onDeletePath,
  } = props;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [projectRootsExpanded, setProjectRootsExpanded] = useState(false);
  const panesRef = useRef<HTMLDivElement | null>(null);

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

  function togglePath(path: string) {
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

  function cycleAppearanceMode() {
    const nextMode = appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
    onAppearanceModeChange(nextMode);
  }

  const appearanceIcon = appearanceMode === "system" ? Monitor : appearanceMode === "light" ? SunMedium : MoonStar;
  const AppearanceIcon = appearanceIcon;

  function renderRail() {
    return (
      <div className="sidebar__rail">
        <RailButton
          testId={collapsed ? "sidebar-expand" : "sidebar-collapse"}
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand workspace" : "Collapse workspace"}
        >
          {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </RailButton>
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
          <Settings2 size={13} />
        </RailButton>
      </div>
    );
  }

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" data-testid="sidebar">
        {renderRail()}
      </aside>
    );
  }

  return (
    <aside className="sidebar" data-testid="sidebar">
      {renderRail()}

      <div className="sidebar__main">
        <div className="sidebar__top">
          <div className="sidebar__header">
            <div className="sidebar__header-row">
              <div className="sidebar__label">Workspace</div>
            </div>
          </div>

          <label className="sidebar__search" htmlFor="workspace-search">
            <Search size={14} />
            <input
              id="workspace-search"
              data-testid="workspace-search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search"
            />
          </label>
        </div>

        <div ref={panesRef} className="sidebar__panes">
          <div className="sidebar__content sidebar__content--notes">
            {searchQuery ? (
              <div className="tree-section">
                <div className="tree-section__title">Search Results</div>
                <div className="search-results" data-testid="search-results">
                  {searchResults.notes.length === 0 && searchResults.projectFiles.length === 0 && searchResults.tags.length === 0 && semanticResults.length === 0 ? (
                    <div className="search-result__empty">No matches</div>
                  ) : null}

                  <SearchSection
                    label="Notes"
                    results={searchResults.notes}
                    onOpenFile={onOpenFile}
                    dragManager={dragManager}
                  />
                  <SearchSection
                    label="Project Files"
                    results={searchResults.projectFiles}
                    onOpenFile={onOpenFile}
                    dragManager={dragManager}
                  />
                  <TagSearchSection
                    results={searchResults.tags}
                    onOpenFile={onOpenFile}
                    onOpenTag={onOpenTag}
                    dragManager={dragManager}
                  />
                  <SearchSection
                    label="Semantic"
                    results={semanticResults.map((r) => ({
                      filePath: r.filePath,
                      title: r.title,
                      snippet: r.snippet,
                      kind: "note" as const,
                    }))}
                    onOpenFile={onOpenFile}
                    dragManager={dragManager}
                  />
                </div>
              </div>
            ) : (
              <Section
                label="Notes"
                sections={noteRoots}
                expandedPaths={expandedPaths}
                onTogglePath={togglePath}
                onOpenFile={onOpenFile}
                dragManager={dragManager}
                onContextMenu={openContextMenu}
              />
            )}
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
          >
            <Section
              label="Projects"
              sections={projectRoots}
              expandedPaths={expandedPaths}
              onTogglePath={togglePath}
              onOpenFile={onOpenFile}
              dragManager={dragManager}
              onContextMenu={openContextMenu}
              showHeader={false}
            />
          </SidebarDrawer>
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
