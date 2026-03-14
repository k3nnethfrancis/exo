import type { BranchFamily, NoteDocument } from "@exo/core";

import { NoteEditor } from "./NoteEditor";

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

export interface EditorPaneState {
  id: string;
  openPaths: string[];
  activePath: string | null;
}

interface EditorPaneProps {
  pane: EditorPaneState;
  documents: Record<string, EditorDocument>;
  branchFamiliesByPath: Record<string, BranchFamily>;
  propertiesCollapsed: boolean;
  isFocused: boolean;
  onFocusPane: () => void;
  onActivateTab: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onStartDocumentDrag: (filePath: string, paneId: string) => void;
  onEndDocumentDrag: () => void;
  onToggleProperties: () => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTag: (tag: string) => void;
  onOpenBranch: (filePath: string) => void;
  onCreateBranch: () => void;
  compact: boolean;
}

export function EditorPane(props: EditorPaneProps) {
  const {
    pane,
    documents,
    branchFamiliesByPath,
    propertiesCollapsed,
    isFocused,
    onFocusPane,
    onActivateTab,
    onCloseTab,
    onStartDocumentDrag,
    onEndDocumentDrag,
    onToggleProperties,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenBranch,
    onCreateBranch,
    compact,
  } = props;

  const activeDocument = pane.activePath ? documents[pane.activePath] ?? null : null;

  return (
    <div
      className={`editor-pane ${isFocused ? "editor-pane--focused" : ""} ${compact ? "editor-pane--compact" : ""}`}
      data-testid={`editor-pane-${pane.id}`}
      onMouseDown={onFocusPane}
    >
      <div className="tab-strip" data-testid={`editor-tabs-${pane.id}`}>
        {pane.openPaths.map((filePath) => {
          const document = documents[filePath];
          if (!document) {
            return null;
          }

          return (
            <button
              key={document.filePath}
              className={`tab-strip__tab ${document.filePath === pane.activePath ? "tab-strip__tab--active" : ""}`}
              draggable
              onClick={() => onActivateTab(document.filePath)}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  "application/x-exo-document",
                  JSON.stringify({ filePath: document.filePath, sourcePaneId: pane.id }),
                );
                onStartDocumentDrag(document.filePath, pane.id);
              }}
              onDragEnd={onEndDocumentDrag}
              type="button"
            >
              <span className={document.dirty ? "status-dot status-dot--dirty" : "status-dot"} />
              {document.title}
              <span
                aria-label={`Close ${document.title}`}
                className="tab-strip__close"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(document.filePath);
                }}
                role="button"
              >
                ×
              </span>
            </button>
          );
        })}
      </div>

      <NoteEditor
        document={activeDocument}
        branchFamily={pane.activePath ? branchFamiliesByPath[pane.activePath] ?? null : null}
        propertiesCollapsed={propertiesCollapsed}
        onToggleProperties={onToggleProperties}
        onBodyChange={onBodyChange}
        onSave={onSave}
        onOpenTag={onOpenTag}
        onOpenBranch={onOpenBranch}
        onCreateBranch={onCreateBranch}
        onFocus={onFocusPane}
        compact={compact}
      />
    </div>
  );
}
