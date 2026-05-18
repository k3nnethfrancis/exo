import type { BranchFamily, NoteDocument } from "@exo/core";
import type { ResolvedAppearance } from "../App";
import type { DragManager } from "../hooks/useDragManager";

import { ChromeTab } from "./Chrome";
import { getDocumentDisplayTitle } from "./documentDisplay";
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
  /** Close this entire pane (merge back into parent split). Null when this is the only pane. */
  onClosePane: (() => void) | null;
  dragManager: DragManager;
  onToggleProperties: () => void;
  onUpdateFrontmatter: (key: string, value: unknown) => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onOpenBranch: (filePath: string) => void;
  onSuggestTargets: (query: string) => Promise<Array<{ label: string; target: string; detail?: string }>>;
  onCreateBranch: () => void;
  appearance: ResolvedAppearance;
  fontSize: number;
  onZoomEditor: (direction: -1 | 0 | 1) => void;
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
    onClosePane,
    dragManager,
    onToggleProperties,
    onUpdateFrontmatter,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenTarget,
    onOpenBranch,
    onSuggestTargets,
    onCreateBranch,
    appearance,
    fontSize,
    onZoomEditor,
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
          const displayTitle = getDocumentDisplayTitle(document.filePath, document.kind);

          return (
            <ChromeTab
              key={document.filePath}
              active={document.filePath === pane.activePath}
              className="tab-strip__tab"
              dropPaneId={pane.id}
              dropKind="editor"
              onClick={() => onActivateTab(document.filePath)}
              onMouseDown={(event) => {
                dragManager.startDrag(event, {
                  kind: "document",
                  filePath: document.filePath,
                  sourcePaneId: pane.id,
                });
              }}
              leading={<span className={document.dirty ? "status-dot status-dot--dirty" : "status-dot"} />}
              closeLabel={`Close ${displayTitle}`}
              onClose={(event) => {
                event.stopPropagation();
                onCloseTab(document.filePath);
              }}
              closeIcon="×"
            >
              {displayTitle}
            </ChromeTab>
          );
        })}
        {onClosePane ? (
          <button
            className="tab-strip__close-pane"
            onClick={onClosePane}
            title="Close pane"
            aria-label="Close pane"
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      <NoteEditor
        document={activeDocument}
        branchFamily={pane.activePath ? branchFamiliesByPath[pane.activePath] ?? null : null}
        propertiesCollapsed={propertiesCollapsed}
        onToggleProperties={onToggleProperties}
        onUpdateFrontmatter={onUpdateFrontmatter}
        onBodyChange={onBodyChange}
        onSave={onSave}
        onOpenTag={onOpenTag}
        onOpenTarget={onOpenTarget}
        onOpenBranch={onOpenBranch}
        onSuggestTargets={onSuggestTargets}
        onCreateBranch={onCreateBranch}
        onFocus={onFocusPane}
        appearance={appearance}
        fontSize={fontSize}
        onZoomEditor={onZoomEditor}
        compact={compact}
      />
    </div>
  );
}
