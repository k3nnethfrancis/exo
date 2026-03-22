import { ChevronDown, ChevronRight, FolderTree, Hash } from "lucide-react";
import type { SearchResult, TreeNode } from "@exo/core";

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
  onOpenFile: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
}

interface TagSearchSectionProps {
  results: SearchResult[];
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
}

interface SectionProps {
  label: string;
  sections: RootSection[];
  expandedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onOpenFile: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
  onContextMenu: (event: React.MouseEvent, target: ContextTarget) => void;
  showHeader?: boolean;
}

export const ROOT_GROUP_PREFIX = "__root__:";

export function SearchSection(props: SearchSectionProps) {
  const { label, results, onOpenFile, onStartDocumentDrag, onEndDocumentDrag } = props;
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

export function TagSearchSection(props: TagSearchSectionProps) {
  const { results, onOpenFile, onOpenTag, onStartDocumentDrag, onEndDocumentDrag } = props;
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

export function Section(props: SectionProps) {
  const {
    label,
    sections,
    expandedPaths,
    onTogglePath,
    onOpenFile,
    onStartDocumentDrag,
    onEndDocumentDrag,
    onContextMenu,
    showHeader = true,
  } = props;

  if (sections.length === 1) {
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
          expandedPaths={expandedPaths}
          onTogglePath={onTogglePath}
          onOpenFile={onOpenFile}
          onStartDocumentDrag={onStartDocumentDrag}
          onEndDocumentDrag={onEndDocumentDrag}
          onContextMenu={onContextMenu}
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
            <button className="root-group__toggle" onClick={() => onTogglePath(rootKey)} type="button">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="root-group__title">{section.label}</span>
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
            <span>{node.name.endsWith(".md") ? node.name.slice(0, -3) : node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
