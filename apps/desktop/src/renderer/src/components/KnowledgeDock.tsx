import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { BranchFamily, NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";

interface KnowledgeDockProps {
  document: NoteDocument | null;
  knowledge: NoteKnowledge | null;
  branchFamily: BranchFamily | null;
  collapsed: boolean;
  activeTag: string | null;
  tagResults: SearchResult[];
  onToggleCollapsed: () => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}

export function KnowledgeDock(props: KnowledgeDockProps) {
  const {
    document,
    knowledge,
    branchFamily,
    collapsed,
    activeTag,
    tagResults,
    onToggleCollapsed,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
  } = props;

  const isMarkdown = document?.kind === "markdown";
  const backlinkCount = isMarkdown ? knowledge?.backlinks.length ?? 0 : 0;
  const linkCount = isMarkdown ? (knowledge?.wikilinks.length ?? 0) + (knowledge?.markdownLinks.length ?? 0) : 0;
  const tagCount = isMarkdown ? knowledge?.tags.length ?? 0 : 0;
  const branchCount = isMarkdown ? branchFamily?.members.length ?? 0 : 0;

  return (
    <div className={`knowledge-drawer ${collapsed ? "knowledge-drawer--collapsed" : ""}`} data-testid="knowledge-drawer">
      <button className="knowledge-drawer__bar" data-testid="knowledge-toggle" onClick={onToggleCollapsed} type="button">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="knowledge-drawer__label">{isMarkdown ? "Knowledge" : "Inspector"}</span>
        <span className="knowledge-drawer__summary">Backlinks {backlinkCount}</span>
        <span className="knowledge-drawer__summary">Links {linkCount}</span>
        <span className="knowledge-drawer__summary">Tags {tagCount}</span>
        <span className="knowledge-drawer__summary">Branches {branchCount}</span>
      </button>

      {collapsed ? null : (
        <div className="knowledge-panel">
          <div className="knowledge-panel__section" data-testid="backlinks-panel">
            <div className="knowledge-panel__title">Backlinks</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : knowledge?.backlinks.length ? (
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
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : (
              <>
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
              </>
            )}
          </div>

          <div className="knowledge-panel__section" data-testid="tags-panel">
            <div className="knowledge-panel__title">Tags</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : knowledge?.tags.length ? (
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

            {isMarkdown && activeTag ? (
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
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : branchFamily?.members.length ? (
              <>
                {branchFamily.members.map((member) => (
                  <button
                    key={member.filePath}
                    className={`knowledge-item ${member.filePath === document?.filePath ? "knowledge-item--active" : ""}`}
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
      )}
    </div>
  );
}
