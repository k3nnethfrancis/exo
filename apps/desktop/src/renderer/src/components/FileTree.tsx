import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, ChevronRight, FilePlus2, FolderPlus, FolderTree, Hash, Monitor, MoonStar, Pencil, Search, SunMedium, Trash2 } from "lucide-react";
import type { SearchResult, TreeNode, WorkspaceSearchResults } from "@exo/core";
import type { AppearanceMode, ResolvedAppearance } from "../App";

interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

interface FileTreeProps {
  workspaceRoot: string;
  noteRoots: RootSection[];
  projectRoots: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
}

interface ContextTarget {
  path: string;
  kind: "file" | "directory";
}

const ROOT_GROUP_PREFIX = "__root__:";

export function FileTree(props: FileTreeProps) {
  const {
    workspaceRoot,
    noteRoots,
    projectRoots,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchResults,
    onAppearanceModeChange,
    onSearchQueryChange,
    onOpenFile,
    onOpenTag,
    onStartDocumentDrag,
    onEndDocumentDrag,
    onCreateFile,
    onCreateDirectory,
    onRenamePath,
    onDeletePath,
  } = props;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [projectRootsExpanded, setProjectRootsExpanded] = useState(false);
  const [projectDrawerHeight, setProjectDrawerHeight] = useState<number | null>(null);
  const [drawerResizeOrigin, setDrawerResizeOrigin] = useState<{ startY: number; startHeight: number } | null>(null);
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

  useEffect(() => {
    if (!drawerResizeOrigin) {
      return;
    }
    const currentResize = drawerResizeOrigin;

    function onMouseMove(event: MouseEvent) {
      const containerHeight = panesRef.current?.getBoundingClientRect().height ?? 0;
      if (!containerHeight) {
        return;
      }

      const delta = currentResize.startY - event.clientY;
      setProjectDrawerHeight(clampDrawerHeight(currentResize.startHeight + delta, containerHeight));
    }

    function onMouseUp() {
      setDrawerResizeOrigin(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [drawerResizeOrigin]);

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

  function openProjectRootsDrawer() {
    setProjectRootsExpanded(true);
    setProjectDrawerHeight((current) => {
      if (current !== null) {
        return current;
      }

      const containerHeight = panesRef.current?.getBoundingClientRect().height ?? 0;
      return containerHeight ? clampDrawerHeight(Math.round(containerHeight / 2), containerHeight) : 260;
    });
  }

  function toggleProjectRootsDrawer() {
    if (projectRootsExpanded) {
      setProjectRootsExpanded(false);
      return;
    }

    openProjectRootsDrawer();
  }

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__header-row">
          <div className="sidebar__label">Workspace</div>
          <div className="appearance-toggle" data-testid="appearance-toggle" role="group" aria-label="Appearance">
            <button
              className={`appearance-toggle__button ${appearanceMode === "system" ? "appearance-toggle__button--active" : ""}`}
              data-testid="appearance-system"
              onClick={() => onAppearanceModeChange("system")}
              title={`System appearance (${resolvedAppearance})`}
              type="button"
            >
              <Monitor size={13} />
            </button>
            <button
              className={`appearance-toggle__button ${appearanceMode === "light" ? "appearance-toggle__button--active" : ""}`}
              data-testid="appearance-light"
              onClick={() => onAppearanceModeChange("light")}
              title="Light mode"
              type="button"
            >
              <SunMedium size={13} />
            </button>
            <button
              className={`appearance-toggle__button ${appearanceMode === "dark" ? "appearance-toggle__button--active" : ""}`}
              data-testid="appearance-dark"
              onClick={() => onAppearanceModeChange("dark")}
              title="Dark mode"
              type="button"
            >
              <MoonStar size={13} />
            </button>
          </div>
        </div>
        <div className="sidebar__workspace">{workspaceRoot}</div>
      </div>

      <label className="sidebar__search" htmlFor="workspace-search">
        <Search size={14} />
        <input
          id="workspace-search"
          data-testid="workspace-search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search workspace"
        />
      </label>

      <div ref={panesRef} className="sidebar__panes">
        <div className="sidebar__content sidebar__content--notes">
          {searchQuery ? (
            <div className="tree-section">
              <div className="tree-section__title">Search Results</div>
              <div className="search-results" data-testid="search-results">
                {searchResults.notes.length === 0 && searchResults.projectFiles.length === 0 && searchResults.tags.length === 0 ? (
                  <div className="search-result__empty">No matches</div>
                ) : null}

                <SearchSection
                  label="Notes"
                  results={searchResults.notes}
                  onOpenFile={onOpenFile}
                  onStartDocumentDrag={onStartDocumentDrag}
                  onEndDocumentDrag={onEndDocumentDrag}
                />
                <SearchSection
                  label="Project Files"
                  results={searchResults.projectFiles}
                  onOpenFile={onOpenFile}
                  onStartDocumentDrag={onStartDocumentDrag}
                  onEndDocumentDrag={onEndDocumentDrag}
                />
                <TagSearchSection
                  results={searchResults.tags}
                  onOpenFile={onOpenFile}
                  onOpenTag={onOpenTag}
                  onStartDocumentDrag={onStartDocumentDrag}
                  onEndDocumentDrag={onEndDocumentDrag}
                />
              </div>
            </div>
          ) : (
            <Section
              label="Note Roots"
              sections={noteRoots}
              expandedPaths={expandedPaths}
              onTogglePath={togglePath}
              onOpenFile={onOpenFile}
              onStartDocumentDrag={onStartDocumentDrag}
              onEndDocumentDrag={onEndDocumentDrag}
              onContextMenu={openContextMenu}
            />
          )}
        </div>

        {projectRootsExpanded ? (
          <div
            className="sidebar__drawer-resizer"
            data-testid="project-roots-resizer"
            onDoubleClick={openProjectRootsDrawer}
            onMouseDown={(event) =>
              setDrawerResizeOrigin({
                startY: event.clientY,
                startHeight: projectDrawerHeight ?? 260,
              })
            }
          />
        ) : null}

        <div
          className={`sidebar__drawer ${projectRootsExpanded ? "sidebar__drawer--expanded" : "sidebar__drawer--collapsed"}`}
          style={projectRootsExpanded ? { height: `${projectDrawerHeight ?? 260}px` } : undefined}
          data-testid="project-roots-drawer"
        >
          <button
            className="sidebar__drawer-bar"
            data-testid="project-roots-toggle"
            onClick={toggleProjectRootsDrawer}
            type="button"
          >
            {projectRootsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="sidebar__drawer-label">Project Roots</span>
            <span className="sidebar__drawer-summary">{projectRoots.length} root{projectRoots.length === 1 ? "" : "s"}</span>
          </button>

          {projectRootsExpanded ? (
            <div className="sidebar__drawer-panel" data-testid="project-roots-panel">
              <Section
                label="Project Roots"
                sections={projectRoots}
                expandedPaths={expandedPaths}
                onTogglePath={togglePath}
                onOpenFile={onOpenFile}
                onStartDocumentDrag={onStartDocumentDrag}
                onEndDocumentDrag={onEndDocumentDrag}
                onContextMenu={openContextMenu}
                showHeader={false}
              />
            </div>
          ) : null}
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
              </>
            ) : null}
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

function SearchSection({
  label,
  results,
  onOpenFile,
  onStartDocumentDrag,
  onEndDocumentDrag,
}: {
  label: string;
  results: SearchResult[];
  onOpenFile: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div className="search-section">
      <div className="search-section__title">{label}</div>
      {results.map((result) => (
        <button
          key={result.filePath}
          className="search-result"
          draggable
          onClick={() => onOpenFile(result.filePath)}
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-exo-document", JSON.stringify({ filePath: result.filePath }));
            onStartDocumentDrag(result.filePath);
          }}
          onDragEnd={onEndDocumentDrag}
          type="button"
        >
          <strong>{result.title}</strong>
          <span>{result.snippet}</span>
        </button>
      ))}
    </div>
  );
}

function TagSearchSection({
  results,
  onOpenFile,
  onOpenTag,
  onStartDocumentDrag,
  onEndDocumentDrag,
}: {
  results: SearchResult[];
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div className="search-section">
      <div className="search-section__title">Tags</div>
      {results.map((result) => (
        <div key={`${result.filePath}-${result.snippet}`} className="search-result search-result--split">
          <button className="search-result__tag" onClick={() => onOpenTag(result.snippet)} type="button">
            <Hash size={12} />
            {result.snippet}
          </button>
          <button
            className="search-result__file"
            draggable
            onClick={() => onOpenFile(result.filePath)}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-exo-document", JSON.stringify({ filePath: result.filePath }));
              onStartDocumentDrag(result.filePath);
            }}
            onDragEnd={onEndDocumentDrag}
            type="button"
          >
            <strong>{result.title}</strong>
            <span>{result.filePath}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function Section({
  label,
  sections,
  expandedPaths,
  onTogglePath,
  onOpenFile,
  onStartDocumentDrag,
  onEndDocumentDrag,
  onContextMenu,
  showHeader = true,
}: {
  label: string;
  sections: RootSection[];
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onOpenFile: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
  onContextMenu: (event: React.MouseEvent, target: ContextTarget) => void;
  showHeader?: boolean;
}) {
  return (
    <div className="tree-section">
      {showHeader ? (
        <div className="tree-section__title">
          <FolderTree size={14} />
          {label}
        </div>
      ) : null}
      {sections.map((section) => {
        const rootKey = `${ROOT_GROUP_PREFIX}${section.path}`;
        const expanded = expandedPaths.has(rootKey);
        return (
          <div key={section.path} className="root-group">
            <button className="root-group__toggle" onClick={() => onTogglePath(rootKey)} type="button">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="root-group__title">{section.path}</span>
            </button>
            {expanded ? (
              <TreeNodes
                nodes={section.nodes}
                depth={0}
                expandedPaths={expandedPaths}
                onTogglePath={onTogglePath}
                onOpenFile={onOpenFile}
                onStartDocumentDrag={onStartDocumentDrag}
                onEndDocumentDrag={onEndDocumentDrag}
                onContextMenu={onContextMenu}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function clampDrawerHeight(value: number, containerHeight: number): number {
  const min = 140;
  const max = Math.max(220, containerHeight - 140);
  return Math.min(max, Math.max(min, value));
}

function TreeNodes({
  nodes,
  depth,
  expandedPaths,
  onTogglePath,
  onOpenFile,
  onStartDocumentDrag,
  onEndDocumentDrag,
  onContextMenu,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onOpenFile: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
  onContextMenu: (event: React.MouseEvent, target: ContextTarget) => void;
}) {
  return (
    <div className="tree-nodes">
      {nodes.map((node) => {
        if (node.kind === "directory") {
          const expanded = expandedPaths.has(node.path);
          return (
            <div key={node.path}>
              <button
                className="tree-node tree-node--directory"
                style={{ paddingLeft: `${depth * 14 + 12}px` }}
                onClick={() => onTogglePath(node.path)}
                onContextMenu={(event) => onContextMenu(event, { path: node.path, kind: "directory" })}
                type="button"
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{node.name}</span>
              </button>
              {expanded && node.children?.length ? (
                <TreeNodes
                  nodes={node.children}
                  depth={depth + 1}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                  onOpenFile={onOpenFile}
                  onStartDocumentDrag={onStartDocumentDrag}
                  onEndDocumentDrag={onEndDocumentDrag}
                  onContextMenu={onContextMenu}
                />
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={node.path}
            className="tree-node tree-node--file"
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
            draggable
            onClick={() => onOpenFile(node.path)}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-exo-document", JSON.stringify({ filePath: node.path }));
              onStartDocumentDrag(node.path);
            }}
            onDragEnd={onEndDocumentDrag}
            onContextMenu={(event) => onContextMenu(event, { path: node.path, kind: "file" })}
            type="button"
          >
            <span className="tree-node__file-spacer" />
            <span>{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
