import type { BranchFamily, NoteDocument } from "@exo/core";
import type { ResolvedAppearance } from "../App";

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
  onStartDocumentDrag: (filePath: string, paneId: string) => void;
  onEndDocumentDrag: () => void;
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
    onUpdateFrontmatter,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenTarget,
    onOpenBranch,
    onSuggestTargets,
    onCreateBranch,
    appearance,
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
        compact={compact}
      />
    </div>
  );
}
