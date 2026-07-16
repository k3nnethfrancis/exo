import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  ClipboardCopy,
  FilePlus2,
  FolderPlus,
  Pencil,
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
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onToggleCollapsed: () => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenFolder?: (directoryPath: string) => void;
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

export type ExplorerRootKind = "notes";

export function FileTree(props: FileTreeProps) {
  const {
    noteRoots,
    collapsed,
    appearanceMode,
    resolvedAppearance,
    onAppearanceModeChange,
    onToggleCollapsed,
    onOpenFile,
    onOpenFolder,
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
  const [rootAction, setRootAction] = useState<"file" | "directory" | null>(null);
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

    if (rootKind === "notes") {
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

  function togglePath(path: string, rootKind?: ExplorerRootKind) {
    const shouldExpand = !expandedPaths.has(path);
    if (shouldExpand && rootKind === "notes") {
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
  function requestRootAction(action: "file" | "directory") {
    if (noteRoots.length === 1) {
      const root = noteRoots[0];
      if (action === "file") {
        onCreateFile(root.path);
      } else {
        onCreateDirectory(root.path);
      }
      return;
    }
    setRootAction((current) => current === action ? null : action);
  }

  function createInRoot(root: RootSection) {
    if (!rootAction) {
      return;
    }
    if (rootAction === "file") {
      onCreateFile(root.path);
    } else {
      onCreateDirectory(root.path);
    }
    setRootAction(null);
  }

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
      </aside>
    );
  }

  return (
    <aside className={`sidebar sidebar--content-only ${mirrored ? "sidebar--mirrored" : ""}`} data-testid="sidebar" onMouseDown={onFocusExplorer} style={sidebarStyle}>
      <div className="sidebar__main">
        <div className="sidebar__toolbar" role="toolbar" aria-label="Explorer">
          <button aria-label="New note" className="sidebar__toolbar-button sidebar__toolbar-button--icon" data-testid="explorer-new-note" onClick={() => requestRootAction("file")} title="New note" type="button"><FilePlus2 size={14} aria-hidden="true" /></button>
          <button aria-label="New folder" className="sidebar__toolbar-button sidebar__toolbar-button--icon" data-testid="explorer-new-folder" onClick={() => requestRootAction("directory")} title="New folder" type="button"><FolderPlus size={14} aria-hidden="true" /></button>
        </div>
        {rootAction ? (
          <div className="explorer-root-picker" data-testid="explorer-root-picker" role="menu" aria-label={`Choose Note Root for new ${rootAction === "file" ? "note" : "folder"}`}>
            {noteRoots.map((root) => <button key={root.path} onClick={() => createInRoot(root)} role="menuitem" type="button">{root.label}</button>)}
          </div>
        ) : null}
        <div className="sidebar__panes">
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
              onOpenFolder={onOpenFolder}
              dragManager={dragManager}
              onContextMenu={openContextMenu}
              mirrored={mirrored}
            />
          </div>
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

function rootKindForPath(targetPath: string, noteRoots: RootSection[]): ExplorerRootKind | null {
  if (noteRoots.some((root) => pathContains(root.path, targetPath))) {
    return "notes";
  }
  return null;
}

function pathContains(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

export function SidebarSearchPane({
  query,
  results,
  resultMode,
  resultQuery,
  message,
  onOpenFile,
}: {
  query: string;
  results: WorkspaceSearchResults;
  resultMode: WorkspaceSearchResultMode;
  resultQuery: string;
  message: string | null;
  onOpenFile: (filePath: string) => void;
}) {
  const summary = searchSummary({
    query: query.trim(),
    resultMode,
    resultQuery,
    message,
    resultCount: results.notes.length,
  });

  return (
    <div className="sidebar-search" data-testid="sidebar-search-pane">
      <div className="sidebar-search__summary">
        {summary}
      </div>
      <div className="sidebar-search__results">
        {searchResultGroups(results).map((group) => (
          <div key={group.label} className="sidebar-search__group">
            <div className="sidebar-search__group-label">{group.label}</div>
            {group.results.map((result) => (
              <button
                key={result.filePath}
                className="sidebar-search-result"
                onClick={() => onOpenFile(result.filePath)}
                title={result.filePath}
                type="button"
              >
                <span className="sidebar-search-result__title">{result.title}</span>
                <span className="sidebar-search-result__snippet">{result.snippet || result.filePath}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function searchResultGroups(results: WorkspaceSearchResults): Array<{ label: string; results: WorkspaceSearchResults["notes"] }> {
  const groups: Array<{ label: string; results: WorkspaceSearchResults["notes"] }> = [];
  if (results.notes.length > 0) {
    groups.push({ label: "Notes", results: results.notes });
  }
  return groups;
}

export function searchSummary({
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
    return "Type to search filenames and paths.";
  }
  if (resultMode === "index-loading") {
    return `Searching QMD for “${resultQuery}”…`;
  }
  if (resultMode === "index") {
    return `QMD results for “${resultQuery}” · ${formatResultCount(resultCount)}`;
  }
  if (resultMode === "index-unavailable") {
    return message ?? `QMD unavailable. Showing Simple search results · ${formatResultCount(resultCount)}.`;
  }
  if (resultMode === "error") {
    return message ?? "Search failed. Try Simple search in Settings.";
  }
  return `Simple search results · ${formatResultCount(resultCount)}`;
}

function formatResultCount(resultCount: number): string {
  return `${resultCount.toLocaleString()} result${resultCount === 1 ? "" : "s"}`;
}
