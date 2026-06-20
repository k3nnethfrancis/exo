import { ChevronDown, ChevronLeft, ChevronRight, FileText, Folder, FolderOpen, FolderTree, Hash } from "lucide-react";
import type { SearchResult, TreeNode } from "@exo/core";
import type { CSSProperties } from "react";
import type { DragManager } from "../hooks/useDragManager";
import type { ExplorerChangeState } from "../explorerChangeState";

const MAX_LABEL_CHARS = 25;

function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

export interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

export interface ContextTarget {
  path: string;
  kind: "file" | "directory";
}

interface SearchSectionProps {
  label: string;
  results: SearchResult[];
  onOpenFile: (filePath: string, line?: number | null) => void;
  dragManager: DragManager;
}

interface TagSearchSectionProps {
  results: SearchResult[];
  onOpenFile: (filePath: string, line?: number | null) => void;
  onOpenTag: (tag: string) => void;
  dragManager: DragManager;
}

interface SectionProps {
  label: string;
  sections: RootSection[];
  rootKind: "notes" | "projects";
  expandedPaths: Set<string>;
  onTogglePath: (path: string, rootKind?: "notes" | "projects") => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  dragManager: DragManager;
  onContextMenu: (event: React.MouseEvent, target: ContextTarget) => void;
  showHeader?: boolean;
  alwaysShowRoots?: boolean;
  mirrored?: boolean;
  changeState?: ExplorerChangeState | null;
}

export const ROOT_GROUP_PREFIX = "__root__:";

export function SearchSection(props: SearchSectionProps) {
  const { label, results, onOpenFile, dragManager } = props;
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
          onClick={() => onOpenFile(result.filePath)}
          onMouseDown={(event) =>
            dragManager.startDrag(event, { kind: "document", filePath: result.filePath })
          }
          type="button"
        >
          <strong>{result.title}</strong>
          <span>{result.snippet}</span>
        </button>
      ))}
    </div>
  );
}

export function TagSearchSection(props: TagSearchSectionProps) {
  const { results, onOpenFile, onOpenTag, dragManager } = props;
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
            onClick={() => onOpenFile(result.filePath)}
            onMouseDown={(event) =>
              dragManager.startDrag(event, { kind: "document", filePath: result.filePath })
            }
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

export function Section(props: SectionProps) {
  const {
    label,
    sections,
    rootKind,
    expandedPaths,
    onTogglePath,
    onOpenFile,
    dragManager,
    onContextMenu,
    showHeader = true,
    alwaysShowRoots = false,
    mirrored = false,
    changeState = null,
  } = props;
  const CollapsedChevron = mirrored ? ChevronLeft : ChevronRight;

  if (sections.length === 1 && !alwaysShowRoots) {
    return (
      <div className="tree-section">
        {showHeader ? (
          <div className="tree-section__title">
            <FolderTree size={14} />
            {label}
          </div>
        ) : null}
        <TreeNodes
          nodes={sections[0].nodes}
          depth={0}
          rootKind={rootKind}
          expandedPaths={expandedPaths}
          onTogglePath={onTogglePath}
          onOpenFile={onOpenFile}
          dragManager={dragManager}
          onContextMenu={onContextMenu}
          mirrored={mirrored}
          changeState={changeState}
        />
      </div>
    );
  }

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
            <button
              className="root-group__toggle"
              data-explorer-drop-path={section.path}
              onClick={() => onTogglePath(rootKey)}
              type="button"
            >
              {expanded ? <ChevronDown size={12} /> : <CollapsedChevron size={12} />}
              <span className="root-group__title">{section.label}</span>
            </button>
            {expanded ? (
              <TreeNodes
                nodes={section.nodes}
                depth={0}
                rootKind={rootKind}
                expandedPaths={expandedPaths}
                onTogglePath={onTogglePath}
                onOpenFile={onOpenFile}
                dragManager={dragManager}
                onContextMenu={onContextMenu}
                mirrored={mirrored}
                changeState={changeState}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TreeNodes({
  nodes,
  depth,
  rootKind,
  expandedPaths,
  onTogglePath,
  onOpenFile,
  dragManager,
  onContextMenu,
  mirrored,
  changeState,
}: {
  nodes: TreeNode[];
  depth: number;
  rootKind: "notes" | "projects";
  expandedPaths: Set<string>;
  onTogglePath: (path: string, rootKind?: "notes" | "projects") => void;
  onOpenFile: (filePath: string, line?: number | null) => void;
  dragManager: DragManager;
  onContextMenu: (event: React.MouseEvent, target: ContextTarget) => void;
  mirrored: boolean;
  changeState: ExplorerChangeState | null;
}) {
  const CollapsedChevron = mirrored ? ChevronLeft : ChevronRight;
  return (
    <div className="tree-nodes">
      {nodes.map((node) => {
        const depthStyle = { "--tree-depth": depth } as CSSProperties;
        if (node.kind === "directory") {
          const expanded = expandedPaths.has(node.path);
          const descendantChangeCount = changeState?.descendantCountByPath.get(node.path) ?? 0;
          const hasDirtyDescendants = descendantChangeCount > 0;
          const FolderIcon = expanded ? FolderOpen : Folder;
          return (
            <div key={node.path}>
              <button
                className={`tree-node tree-node--directory ${hasDirtyDescendants ? "tree-node--changed-descendant" : ""}`}
                data-explorer-drop-path={node.path}
                style={depthStyle}
                aria-label={`${node.name}, folder${hasDirtyDescendants ? `, ${formatChangeCount(descendantChangeCount)} changed` : ""}`}
                onClick={() => onTogglePath(node.path, rootKind)}
                onMouseDown={(event) =>
                  dragManager.startDrag(event, { kind: "workspace-path", path: node.path, nodeKind: "directory" })
                }
                onContextMenu={(event) => onContextMenu(event, { path: node.path, kind: "directory" })}
                type="button"
              >
                <span className="tree-node__disclosure">
                  {expanded ? <ChevronDown size={12} /> : <CollapsedChevron size={12} />}
                </span>
                <FolderIcon className="tree-node__kind-icon" size={13} aria-hidden="true" />
                <span className="tree-node__label" title={node.name}>{truncateLabel(node.name)}</span>
                {hasDirtyDescendants ? (
                  <span className="tree-node__dirty-badge" title={`${formatChangeCount(descendantChangeCount)} changed`}>
                    {descendantChangeCount}
                  </span>
                ) : null}
              </button>
              {expanded && node.children?.length ? (
                <TreeNodes
                  nodes={node.children}
                  depth={depth + 1}
                  rootKind={rootKind}
                  expandedPaths={expandedPaths}
                  onTogglePath={onTogglePath}
                  onOpenFile={onOpenFile}
                  dragManager={dragManager}
                  onContextMenu={onContextMenu}
                  mirrored={mirrored}
                  changeState={changeState}
                />
              ) : null}
            </div>
          );
        }

        const change = changeState?.byPath.get(node.path) ?? null;
        const fileLabel = truncateLabel(node.name.endsWith(".md") ? node.name.slice(0, -3) : node.name);
        const changeLineLabel = change?.firstChangedLine ? `, first changed line ${change.firstChangedLine}` : "";
        return (
          <button
            key={node.path}
            className={`tree-node tree-node--file ${change ? "tree-node--changed-file" : ""}`}
            data-explorer-drop-path={node.path}
            data-explorer-drop-kind="file"
            style={depthStyle}
            aria-label={`${fileLabel}, file${change ? `, ${change.status} changed${changeLineLabel}` : ""}`}
            onClick={() => onOpenFile(node.path, change?.firstChangedLine)}
            onMouseDown={(event) =>
              dragManager.startDrag(event, { kind: "workspace-path", path: node.path, nodeKind: "file" })
            }
            onContextMenu={(event) => onContextMenu(event, { path: node.path, kind: "file" })}
            type="button"
          >
            <FileText className="tree-node__kind-icon" size={13} aria-hidden="true" />
            <span className="tree-node__label" title={node.name}>{fileLabel}</span>
            {change ? (
              <span
                className="tree-node__dirty-badge tree-node__dirty-badge--status"
                title={`${change.status} changed${change.firstChangedLine ? ` at line ${change.firstChangedLine}` : ""}`}
              >
                {change.status}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function formatChangeCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}
