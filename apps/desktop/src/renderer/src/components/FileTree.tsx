import { ChevronDown, ChevronRight, FolderTree, Hash, Search } from "lucide-react";
import type { SearchResult, TreeNode, WorkspaceSearchResults } from "@exo/core";

interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

interface FileTreeProps {
  workspaceRoot: string;
  noteRoots: RootSection[];
  projectRoots: RootSection[];
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
}

export function FileTree(props: FileTreeProps) {
  const { workspaceRoot, noteRoots, projectRoots, searchQuery, searchResults, onSearchQueryChange, onOpenFile, onOpenTag } = props;

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__label">Workspace</div>
        <div className="sidebar__workspace">{workspaceRoot}</div>
      </div>

      <label className="sidebar__search" htmlFor="workspace-search">
        <Search size={14} />
        <input
          id="workspace-search"
          data-testid="workspace-search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search notes"
        />
      </label>

      {searchQuery ? (
        <div className="tree-section">
          <div className="tree-section__title">Search Results</div>
          <div className="search-results" data-testid="search-results">
            {searchResults.notes.length === 0 && searchResults.projectFiles.length === 0 && searchResults.tags.length === 0 ? (
              <div className="search-result__empty">No matches</div>
            ) : null}

            <SearchSection label="Notes" results={searchResults.notes} onOpenFile={onOpenFile} />
            <SearchSection label="Project Files" results={searchResults.projectFiles} onOpenFile={onOpenFile} />
            <TagSearchSection results={searchResults.tags} onOpenFile={onOpenFile} onOpenTag={onOpenTag} />
          </div>
        </div>
      ) : (
        <>
          <Section label="Note Roots" sections={noteRoots} onOpenFile={onOpenFile} />
          <Section label="Project Roots" sections={projectRoots} onOpenFile={onOpenFile} />
        </>
      )}
    </aside>
  );
}

function SearchSection({
  label,
  results,
  onOpenFile,
}: {
  label: string;
  results: SearchResult[];
  onOpenFile: (filePath: string) => void;
}) {
  if (results.length === 0) {
    return null;
  }

  return (
    <div className="search-section">
      <div className="search-section__title">{label}</div>
      {results.map((result) => (
        <button key={result.filePath} className="search-result" onClick={() => onOpenFile(result.filePath)} type="button">
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
}: {
  results: SearchResult[];
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
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
          <button className="search-result__file" onClick={() => onOpenFile(result.filePath)} type="button">
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
  onOpenFile,
}: {
  label: string;
  sections: RootSection[];
  onOpenFile: (filePath: string) => void;
}) {
  return (
    <div className="tree-section">
      <div className="tree-section__title">
        <FolderTree size={14} />
        {label}
      </div>
      {sections.map((section) => (
        <div key={section.path} className="root-group">
          <div className="root-group__title">{section.path}</div>
          <TreeNodes nodes={section.nodes} depth={0} onOpenFile={onOpenFile} />
        </div>
      ))}
    </div>
  );
}

function TreeNodes({
  nodes,
  depth,
  onOpenFile,
}: {
  nodes: TreeNode[];
  depth: number;
  onOpenFile: (filePath: string) => void;
}) {
  return (
    <div className="tree-nodes">
      {nodes.map((node) =>
        node.kind === "directory" ? (
          <div key={node.path}>
            <div className="tree-node tree-node--directory" style={{ paddingLeft: `${depth * 14 + 12}px` }}>
              <ChevronDown size={12} />
              <span>{node.name}</span>
            </div>
            {node.children?.length ? <TreeNodes nodes={node.children} depth={depth + 1} onOpenFile={onOpenFile} /> : null}
          </div>
        ) : (
          <button
            key={node.path}
            className="tree-node tree-node--file"
            style={{ paddingLeft: `${depth * 14 + 28}px` }}
            onClick={() => onOpenFile(node.path)}
            type="button"
          >
            <ChevronRight size={12} />
            <span>{node.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
