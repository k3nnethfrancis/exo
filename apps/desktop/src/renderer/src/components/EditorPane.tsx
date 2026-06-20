import type { BranchFamily, NoteDocument, NoteKnowledge } from "@exo/core";
import type { DragManager } from "../hooks/useDragManager";
import type { ExoThemeVariant } from "../theme/types";

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
  knowledgeByPath: Record<string, NoteKnowledge>;
  saveStatuses: Record<string, "idle" | "saving" | "saved" | "error">;
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
  onPreviewTarget: (target: string) => Promise<{ title: string; excerpt: string } | null>;
  onCreateBranch: () => void;
  theme: ExoThemeVariant;
  fontSize: number;
  onZoomEditor: (direction: -1 | 0 | 1) => void;
  compact: boolean;
  revealLineRequest?: { filePath: string; line: number; nonce: number } | null;
  scrollRestoreRequest?: { filePath: string; scrollTop: number; nonce: number } | null;
  isNoteDocument: (filePath: string) => boolean;
}

export function EditorPane(props: EditorPaneProps) {
  const {
    pane,
    documents,
    knowledgeByPath,
    saveStatuses,
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
    onPreviewTarget,
    onCreateBranch,
    theme,
    fontSize,
    onZoomEditor,
    compact,
    revealLineRequest,
    scrollRestoreRequest,
    isNoteDocument,
  } = props;

  const activeDocument = pane.activePath ? documents[pane.activePath] ?? null : null;
  const activeKnowledge = pane.activePath ? knowledgeByPath[pane.activePath] ?? null : null;

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
        knowledge={activeKnowledge}
        saveStatus={pane.activePath ? saveStatuses[pane.activePath] ?? "idle" : "idle"}
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
        onPreviewTarget={onPreviewTarget}
        onCreateBranch={onCreateBranch}
        onFocus={onFocusPane}
        theme={theme}
        fontSize={fontSize}
        onZoomEditor={onZoomEditor}
        compact={compact}
        isNoteDocument={activeDocument ? isNoteDocument(activeDocument.filePath) : false}
        revealLineRequest={revealLineRequest}
        scrollRestoreRequest={scrollRestoreRequest}
      />
    </div>
  );
}
