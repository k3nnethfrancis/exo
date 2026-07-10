import { useEffect, useRef } from "react";
import { FileText, Hash } from "lucide-react";

import type { SearchResult, WorkspaceSearchResults } from "@exo/core";

interface SearchResultsPanelProps {
  query: string;
  results: WorkspaceSearchResults;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onDismiss: () => void;
}

export function SearchResultsPanel({
  query,
  results,
  onOpenFile,
  onOpenTag,
  onDismiss,
}: SearchResultsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    function onClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      // Also ignore clicks on the search input itself (don't dismiss while typing).
      const searchInput = document.querySelector('[data-testid="workspace-search"]');
      if (searchInput && searchInput.contains(target)) return;
      onDismiss();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [onDismiss]);

  const MAX_PER_GROUP = 25;
  const noteSlice = results.notes.slice(0, MAX_PER_GROUP);
  const tagSlice = results.tags.slice(0, MAX_PER_GROUP);

  const totalCount = results.notes.length + results.tags.length;

  if (!query) return null;

  return (
    <div ref={panelRef} className="search-panel" data-testid="search-results">
      {totalCount === 0 ? (
        <div className="search-panel__empty">No matches for "{query}"</div>
      ) : (
        <div className="search-panel__list">
          {noteSlice.length > 0 ? (
            <div className="search-panel__group">
              <div className="search-panel__group-title">
                Notes {results.notes.length > MAX_PER_GROUP ? `(${MAX_PER_GROUP} of ${results.notes.length})` : ""}
              </div>
              {noteSlice.map((result) => (
                <ResultRow key={`note-${result.filePath}`} icon={<FileText size={13} />} result={result} onOpenFile={onOpenFile} />
              ))}
            </div>
          ) : null}

          {tagSlice.length > 0 ? (
            <div className="search-panel__group">
              <div className="search-panel__group-title">
                Tags {results.tags.length > MAX_PER_GROUP ? `(${MAX_PER_GROUP} of ${results.tags.length})` : ""}
              </div>
              {tagSlice.map((result) => (
                <button
                  key={`tag-${result.filePath}-${result.snippet}`}
                  className="search-panel__row"
                  onClick={() => onOpenTag(result.snippet)}
                  type="button"
                >
                  <Hash size={13} />
                  <span className="search-panel__title">{result.snippet}</span>
                  <span className="search-panel__path">{result.filePath}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  icon,
  result,
  onOpenFile,
}: {
  icon: React.ReactNode;
  result: SearchResult;
  onOpenFile: (filePath: string) => void;
}) {
  return (
    <button
      className="search-panel__row"
      onClick={() => onOpenFile(result.filePath)}
      type="button"
    >
      {icon}
      <span className="search-panel__title">{result.title}</span>
      <span className="search-panel__path">{result.filePath}</span>
    </button>
  );
}
