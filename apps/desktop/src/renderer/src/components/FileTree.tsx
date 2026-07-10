import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  ClipboardCopy,
  FilePlus2,
  FolderPlus,
  Pencil,
  Search,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type { WorkspaceSearchResults } from "@exo/core";
import type { AppearanceMode, ResolvedAppearance } from "../appearance";
import type { DragManager } from "../hooks/useDragManager";
import type { WorkspaceSearchResultMode } from "../hooks/useWorkspaceSearch";
import {
  ROOT_GROUP_PREFIX,
  type ContextTarget,
  type RootSection,
  Section,
} from "./ExplorerSections";

interface FileTreeProps {
  noteRoots: RootSection[];
  collapsed: boolean;
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  searchResultMode: WorkspaceSearchResultMode;
  searchResultQuery: string;
  searchMessage: string | null;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onToggleCollapsed: () => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTerminalSession: (sessionId: string) => void;
  onOpenTag: (tag: string) => void;
  onExpandDirectory: (directoryPath: string, rootKind: "notes") => void;
  explorerScale: number;
  onFocusExplorer: () => void;
  dragManager: DragManager;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminal: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  mirrored?: boolean;
  revealPathRequest?: { path: string; nonce: number } | null;
}

export function FileTree(props: FileTreeProps) {
  const {
    noteRoots,
    collapsed,
    appearanceMode,
    resolvedAppearance,
    onAppearanceModeChange,
    onToggleCollapsed,
    onOpenWorkspaceSettings,
    onOpenFile,
    onExpandDirectory,
    explorerScale,
    onFocusExplorer,
    dragManager,
    onCreateFile,
    onCreateDirectory,
    onCreateTerminal,
    onRenamePath,
    onDeletePath,
    mirrored = false,
    revealPathRequest = null,
  } = props;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [explorerMode, setExplorerMode] = useState<"files" | "search">("files");
  const panesRef = useRef<HTMLDivElement | null>(null);
  const processedRevealNonceRef = useRef<number | null>(null);

  const defaultExpandedPaths = useMemo(() => {
    const next = new Set<string>();
    for (const root of noteRoots) {
      next.add(`${ROOT_GROUP_PREFIX}${root.path}`);
    }
    return next;
  }, [noteRoots]);

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

    const rootKind = rootKindForPath(revealPathRequest.path, noteRoots);
    setExpandedPaths((current) => {
      const next = new Set(current);
      next.add(revealPathRequest.path);
      next.add(`${ROOT_GROUP_PREFIX}${revealPathRequest.path}`);
      return next;
    });

    if (rootKind) {
      onExpandDirectory(revealPathRequest.path, rootKind);
    }
  }, [noteRoots, onExpandDirectory, revealPathRequest]);

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

  function togglePath(path: string, rootKind?: "notes") {
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

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
      </aside>
    );
  }

  return (
    <aside className={`sidebar sidebar--content-only ${mirrored ? "sidebar--mirrored" : ""}`} data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
      <div className="sidebar__main">
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

function rootKindForPath(
  targetPath: string,
  noteRoots: RootSection[],
): "notes" | null {
  if (noteRoots.some((root) => pathContains(root.path, targetPath))) {
    return "notes";
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
    return "Type to search filenames. Press Enter for advanced search.";
  }
  if (resultMode === "index-loading") {
    return `Searching advanced provider for “${resultQuery}”…`;
  }
  if (resultMode === "index") {
    return `Advanced search results for “${resultQuery}” · ${formatResultCount(resultCount)}`;
  }
  if (resultMode === "index-unavailable") {
    return message ?? `Advanced search unavailable. Showing ${formatResultCount(resultCount)}.`;
  }
  if (resultMode === "error") {
    return message ?? "Search failed.";
  }
  return `Filename results · ${formatResultCount(resultCount)}`;
}

function formatResultCount(resultCount: number): string {
  return `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"}`;
}
