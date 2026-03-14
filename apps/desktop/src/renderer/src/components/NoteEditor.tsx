import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { ChevronDown, ChevronRight, GitBranch, Save } from "lucide-react";
import type { BranchFamily, NoteDocument } from "@exo/core";

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

interface NoteEditorProps {
  document: EditorDocument | null;
  branchFamily: BranchFamily | null;
  propertiesCollapsed: boolean;
  onToggleProperties: () => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTag: (tag: string) => void;
  onOpenBranch: (filePath: string) => void;
  onCreateBranch: () => void;
  onFocus: () => void;
  compact: boolean;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    document,
    branchFamily,
    propertiesCollapsed,
    onToggleProperties,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenBranch,
    onCreateBranch,
    onFocus,
    compact,
  } = props;

  if (!document) {
    return (
      <section className="editor-panel editor-panel--empty" data-testid="editor-empty">
        <h1>Exo</h1>
        <p>Open a note from the left sidebar to begin.</p>
      </section>
    );
  }

  const isMarkdown = document.kind === "markdown";
  const frontmatterEntries = Object.entries(document.frontmatter).filter(
    ([key]) => key !== "tags" && !key.startsWith("branch_"),
  );

  return (
    <section className={`editor-panel ${compact ? "editor-panel--compact" : ""}`} data-testid="editor-panel" onMouseDown={onFocus}>
      <div className="editor-panel__header">
        <div>
          <div className="editor-panel__eyebrow" title={document.filePath}>
            {document.filePath}
          </div>
          <div className="editor-panel__title" data-testid="editor-title">
            {document.title}
          </div>
        </div>

        <div className="editor-panel__actions">
          {isMarkdown && branchFamily ? (
            <div className="branch-selector" data-testid="branch-selector-wrap">
              <GitBranch size={14} />
              <select
                aria-label="Branch selector"
                className="branch-selector__select"
                data-testid="branch-selector"
                value={document.filePath}
                onChange={(event) => onOpenBranch(event.target.value)}
              >
                {branchFamily.members.map((member) => (
                  <option key={member.filePath} value={member.filePath}>
                    {member.isRoot ? "Base note" : member.path.join(".")} · {member.title}
                  </option>
                ))}
              </select>
              <button
                className={`toolbar-button ${compact ? "toolbar-button--compact" : ""}`}
                data-testid="create-branch"
                onClick={onCreateBranch}
                title="Create branch"
                type="button"
              >
                <GitBranch size={14} />
                {compact ? null : "New"}
              </button>
            </div>
          ) : null}
          <button
            className={`toolbar-button ${compact ? "toolbar-button--compact" : ""}`}
            data-testid="save-note"
            onClick={onSave}
            title={document.dirty ? "Save changes" : "Save"}
            type="button"
          >
            <Save size={14} />
            {compact ? null : document.dirty ? "Save*" : "Save"}
          </button>
        </div>
      </div>

      {isMarkdown ? (
        <div className="properties-card" data-testid="properties-panel">
          <button className="properties-card__toggle" onClick={onToggleProperties} type="button">
            {propertiesCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            Properties
          </button>

          {propertiesCollapsed ? null : (
            <div className="properties-card__content">
              {frontmatterEntries.map(([key, value]) => (
                <div key={key} className="properties-card__row">
                  <span className="properties-card__key">{key}</span>
                  <span className="properties-card__value">{String(value)}</span>
                </div>
              ))}
              {(document.frontmatter.tags as string[] | string | undefined) ? (
                <div className="properties-card__row">
                  <span className="properties-card__key">tags</span>
                  <div className="tag-list">
                    {(Array.isArray(document.frontmatter.tags)
                      ? document.frontmatter.tags.filter((entry): entry is string => typeof entry === "string")
                      : typeof document.frontmatter.tags === "string"
                        ? document.frontmatter.tags.split(/[,\s]+/)
                        : []
                    ).map((tag) => (
                      <button key={tag} className="tag-pill" onClick={() => onOpenTag(tag.replace(/^#/, ""))} type="button">
                        #{tag.replace(/^#/, "")}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div className="properties-card properties-card--file" data-testid="properties-panel">
          <div className="properties-card__file-label">Project file</div>
        </div>
      )}

      <div className="editor-surface">
        <CodeMirror
          value={document.body}
          extensions={document.kind === "markdown" ? [markdown(), EditorView.lineWrapping] : [EditorView.lineWrapping]}
          theme={oneDark}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
          }}
          onChange={onBodyChange}
          height="100%"
        />
      </div>

    </section>
  );
}
