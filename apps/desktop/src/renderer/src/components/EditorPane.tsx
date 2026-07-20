import type { AgentCommand, NoteDocument, WorkspaceGraphContext } from "@exo/core";
import type { InvocationFileReviewPayload } from "../../../shared/api";
import type { InvocationReviewQueueProjection } from "./invocation";
import type { DragManager } from "../hooks/useDragManager";
import type { ExoThemeVariant } from "../theme/types";

import { ChromeTab } from "./Chrome";
import { getDocumentDisplayTitle } from "./documentDisplay";
import { NoteEditor } from "./NoteEditor";
import { FolderOverviewPane } from "./FolderOverviewPane";
import type { InlineAgentDraft } from "./inlineAgentComposer";

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

export interface EditorPaneState {
  id: string;
  openPaths: string[];
  activePath: string | null;
  openFolderPaths?: string[];
  activeFolderPath?: string | null;
}

interface EditorPaneProps {
  pane: EditorPaneState;
  documents: Record<string, EditorDocument>;
  graphContextByPath: Record<string, WorkspaceGraphContext>;
  saveStatuses: Record<string, "idle" | "saving" | "saved" | "error">;
  propertiesCollapsed: boolean;
  isFocused: boolean;
  onFocusPane: () => void;
  onActivateTab: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onActivateFolder: (directoryPath: string) => void;
  onCloseFolder: (directoryPath: string) => void;
  onOpenFolder: (directoryPath: string) => void;
  onOpenFile: (filePath: string) => void;
  /** Close this entire pane (merge back into parent split). Null when this is the only pane. */
  onClosePane: (() => void) | null;
  dragManager: DragManager;
  onToggleProperties: () => void;
  onOpenGraph: () => void;
  onUpdateFrontmatter: (key: string, value: unknown) => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onSuggestTargets: (query: string) => Promise<Array<{ label: string; target: string; detail?: string }>>;
  onPreviewTarget: (target: string) => Promise<{ title: string; excerpt: string } | null>;
  agentCommands: AgentCommand[];
  onInvokeAgent: (draft: InlineAgentDraft) => void;
  invocationReview: EditorInvocationReview | null;
  editingFrozen: boolean;
  historyAvailable: boolean;
  onOpenHistory: () => void;
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
    graphContextByPath,
    saveStatuses,
    propertiesCollapsed,
    isFocused,
    onFocusPane,
    onActivateTab,
    onCloseTab,
    onActivateFolder,
    onCloseFolder,
    onOpenFolder,
    onOpenFile,
    onClosePane,
    dragManager,
    onToggleProperties,
    onOpenGraph,
    onUpdateFrontmatter,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenTarget,
    onSuggestTargets,
    onPreviewTarget,
    agentCommands,
    onInvokeAgent,
    invocationReview,
    editingFrozen,
    historyAvailable,
    onOpenHistory,
    theme,
    fontSize,
    onZoomEditor,
    compact,
    revealLineRequest,
    scrollRestoreRequest,
    isNoteDocument,
  } = props;

  const activeDocument = pane.activePath ? documents[pane.activePath] ?? null : null;
  const activeGraphContext = pane.activePath ? graphContextByPath[pane.activePath] ?? null : null;

  return (
    <div
      className={`editor-pane ${isFocused ? "editor-pane--focused" : ""} ${compact ? "editor-pane--compact" : ""}`}
      data-testid={`editor-pane-${pane.id}`}
      onMouseDown={onFocusPane}
    >
      <div className="tab-strip" data-testid={`editor-tabs-${pane.id}`}>
        {(pane.openFolderPaths ?? []).map((directoryPath) => {
          const title = directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Folder";
          return <ChromeTab key={`folder:${directoryPath}`} active={directoryPath === pane.activeFolderPath} className="tab-strip__tab" dropPaneId={pane.id} dropKind="editor" onClick={() => onActivateFolder(directoryPath)} leading={<span className="status-dot" />} closeLabel={`Close ${title}`} onClose={(event) => { event.stopPropagation(); onCloseFolder(directoryPath); }} closeIcon="×">{title}</ChromeTab>;
        })}
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

      {pane.activeFolderPath ? <FolderOverviewPane directoryPath={pane.activeFolderPath} onOpenFolder={onOpenFolder} onOpenFile={onOpenFile} onClose={() => onCloseFolder(pane.activeFolderPath!)} /> : <NoteEditor
        document={activeDocument}
        graphContext={activeGraphContext}
        saveStatus={pane.activePath ? saveStatuses[pane.activePath] ?? "idle" : "idle"}
        propertiesCollapsed={propertiesCollapsed}
        onToggleProperties={onToggleProperties}
        onOpenGraph={onOpenGraph}
        onUpdateFrontmatter={onUpdateFrontmatter}
        onBodyChange={onBodyChange}
        onSave={onSave}
        onOpenTag={onOpenTag}
        onOpenTarget={onOpenTarget}
        onSuggestTargets={onSuggestTargets}
        onPreviewTarget={onPreviewTarget}
        agentCommands={agentCommands}
        onInvokeAgent={onInvokeAgent}
        invocationReview={invocationReview}
        editingFrozen={editingFrozen}
        historyAvailable={historyAvailable}
        onOpenHistory={onOpenHistory}
        onFocus={onFocusPane}
        theme={theme}
        fontSize={fontSize}
        onZoomEditor={onZoomEditor}
        compact={compact}
        isNoteDocument={activeDocument ? isNoteDocument(activeDocument.filePath) : false}
        revealLineRequest={revealLineRequest}
        scrollRestoreRequest={scrollRestoreRequest}
      />}
    </div>
  );
}

export interface EditorInvocationReview {
  payload: InvocationFileReviewPayload;
  queue: InvocationReviewQueueProjection;
  readOnly: boolean;
  decisionPending: boolean;
  onNavigate: (index: number) => void;
  onKeepCurrent: () => void;
  onRejectCurrent: () => void;
  onKeepAll?: () => void;
  onRejectAll?: () => void;
  onRefreshConflict: () => void;
  onOpenConflict: () => void;
  onDismiss?: () => void;
}
