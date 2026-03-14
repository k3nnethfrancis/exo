import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { ChevronDown, ChevronRight, GitBranch, Save, TerminalSquare } from "lucide-react";
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
  onOpenShellHere: () => void;
  onCreateBranch: () => void;
  onFocus: () => void;
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
    onOpenShellHere,
    onCreateBranch,
    onFocus,
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
    <section className="editor-panel" data-testid="editor-panel" onMouseDown={onFocus}>
      <div className="editor-panel__header">
        <div>
          <div className="editor-panel__eyebrow">{document.filePath}</div>
          <div className="editor-panel__title" data-testid="editor-title">
            {document.title}
          </div>
          {branchFamily && isMarkdown ? (
            <div className="editor-panel__meta" data-testid="branch-meta">
              <GitBranch size={13} />
              {document.filePath === branchFamily.rootFilePath
                ? "Base note"
                : `Branch ${branchFamily.currentPath.join(".")}`}
            </div>
          ) : null}
        </div>

        <div className="editor-panel__actions">
          {isMarkdown ? (
            <button className="toolbar-button" data-testid="create-branch" onClick={onCreateBranch} type="button">
              <GitBranch size={14} />
              Branch
            </button>
          ) : null}
          <button className="toolbar-button" onClick={onOpenShellHere} type="button">
            <TerminalSquare size={14} />
            Shell Here
          </button>
          <button className="toolbar-button" data-testid="save-note" onClick={onSave} type="button">
            <Save size={14} />
            {document.dirty ? "Save*" : "Save"}
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
