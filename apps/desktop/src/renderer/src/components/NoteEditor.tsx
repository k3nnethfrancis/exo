import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { ChevronDown, ChevronRight, ExternalLink, GitBranch, Save, TerminalSquare } from "lucide-react";
import type { BranchFamily, NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

interface NoteEditorProps {
  document: EditorDocument | null;
  knowledge: NoteKnowledge | null;
  branchFamily: BranchFamily | null;
  propertiesCollapsed: boolean;
  tagResults: SearchResult[];
  activeTag: string | null;
  onToggleProperties: () => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenShellHere: () => void;
  onCreateBranch: () => void;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    document,
    knowledge,
    branchFamily,
    propertiesCollapsed,
    tagResults,
    activeTag,
    onToggleProperties,
    onBodyChange,
    onSave,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
    onOpenShellHere,
    onCreateBranch,
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
    <section className="editor-panel" data-testid="editor-panel">
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
                    {knowledge?.tags.map((tag) => (
                      <button key={tag.tag} className="tag-pill" onClick={() => onOpenTag(tag.tag)} type="button">
                        #{tag.tag}
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
          extensions={document.kind === "markdown" ? [markdown()] : []}
          theme={oneDark}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
          }}
          onChange={onBodyChange}
          height="100%"
        />
      </div>

      {isMarkdown ? (
        <KnowledgePanel
          knowledge={knowledge}
          branchFamily={branchFamily}
          activeTag={activeTag}
          tagResults={tagResults}
          currentFilePath={document.filePath}
          onOpenTarget={onOpenTarget}
          onOpenExternal={onOpenExternal}
          onOpenTag={onOpenTag}
        />
      ) : null}
    </section>
  );
}

function KnowledgePanel({
  knowledge,
  branchFamily,
  activeTag,
  tagResults,
  currentFilePath,
  onOpenTarget,
  onOpenExternal,
  onOpenTag,
}: {
  knowledge: NoteKnowledge | null;
  branchFamily: BranchFamily | null;
  activeTag: string | null;
  tagResults: SearchResult[];
  currentFilePath: string;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}) {
  return (
    <div className="knowledge-panel">
      <div className="knowledge-panel__section" data-testid="backlinks-panel">
        <div className="knowledge-panel__title">Backlinks</div>
        {knowledge?.backlinks.length ? (
          knowledge.backlinks.map((backlink) => (
            <button
              key={backlink.filePath}
              className="knowledge-item"
              onClick={() => onOpenTarget(backlink.filePath)}
              type="button"
            >
              {backlink.title}
            </button>
          ))
        ) : (
          <div className="knowledge-empty">No backlinks</div>
        )}
      </div>

      <div className="knowledge-panel__section">
        <div className="knowledge-panel__title">Links</div>
        {knowledge?.wikilinks.map((item) => (
          <button key={`wiki-${item.target}`} className="knowledge-item" onClick={() => onOpenTarget(item.target)} type="button">
            [[{item.label}]]
          </button>
        ))}
        {knowledge?.markdownLinks.map((item) => (
          <button
            key={`markdown-${item.target}`}
            className="knowledge-item"
            onClick={() => (item.target.startsWith("http") ? onOpenExternal(item.target) : onOpenTarget(item.target))}
            type="button"
          >
            {item.label}
            {item.target.startsWith("http") ? <ExternalLink size={12} /> : null}
          </button>
        ))}
        {!knowledge?.wikilinks.length && !knowledge?.markdownLinks.length ? (
          <div className="knowledge-empty">No links</div>
        ) : null}
      </div>

      <div className="knowledge-panel__section" data-testid="tags-panel">
        <div className="knowledge-panel__title">Tags</div>
        {knowledge?.tags.length ? (
          <div className="tag-list">
            {knowledge.tags.map((tag) => (
              <button key={tag.tag} className="tag-pill" onClick={() => onOpenTag(tag.tag)} type="button">
                #{tag.tag}
              </button>
            ))}
          </div>
        ) : (
          <div className="knowledge-empty">No tags</div>
        )}

        {activeTag ? (
          <div className="tag-results" data-testid="tag-results">
            <div className="knowledge-panel__subtitle">Results for #{activeTag}</div>
            {tagResults.map((result) => (
              <button key={result.filePath} className="knowledge-item" onClick={() => onOpenTarget(result.filePath)} type="button">
                {result.title}
              </button>
            ))}
            {tagResults.length === 0 ? <div className="knowledge-empty">No notes for #{activeTag}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="knowledge-panel__section" data-testid="branches-panel">
        <div className="knowledge-panel__title">Branches</div>
        {branchFamily?.members.length ? (
          <>
            {branchFamily.members.map((member) => (
              <button
                key={member.filePath}
                className={`knowledge-item ${member.filePath === currentFilePath ? "knowledge-item--active" : ""}`}
                onClick={() => onOpenTarget(member.filePath)}
                type="button"
              >
                <span>{member.isRoot ? member.title : `${member.path.join(".")} · ${member.title}`}</span>
              </button>
            ))}
            {branchFamily.members.length > 1 ? (
              <pre className="branch-tree" data-testid="branch-tree">
                {branchFamily.tree}
              </pre>
            ) : null}
          </>
        ) : (
          <div className="knowledge-empty">No branch family yet</div>
        )}
      </div>
    </div>
  );
}
