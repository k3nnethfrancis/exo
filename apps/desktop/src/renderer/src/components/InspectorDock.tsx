import type { RefObject } from "react";
import { ExternalLink } from "lucide-react";
import type { NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";
import { SnapDrawer } from "./SnapDrawer";

interface InspectorDockProps {
  document: NoteDocument | null;
  knowledge: NoteKnowledge | null;
  collapsed: boolean;
  containerRef: RefObject<HTMLElement | null>;
  activeTag: string | null;
  tagResults: SearchResult[];
  onHeightChange?: (height: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}

export function InspectorDock(props: InspectorDockProps) {
  const {
    document,
    knowledge,
    collapsed,
    containerRef,
    activeTag,
    tagResults,
    onHeightChange,
    onCollapsedChange,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
  } = props;

  const isMarkdown = document?.kind === "markdown";
  const backlinkCount = isMarkdown ? knowledge?.backlinks.length ?? 0 : 0;
  const linkCount = isMarkdown ? (knowledge?.wikilinks.length ?? 0) + (knowledge?.markdownLinks.length ?? 0) : 0;
  const tagCount = isMarkdown ? knowledge?.tags.length ?? 0 : 0;

  return (
    <SnapDrawer
      className="footer-dock footer-dock--inspector"
      collapsed={collapsed}
      label="Inspector"
      summary={`Backlinks ${backlinkCount}  Links ${linkCount}  Tags ${tagCount}`}
      containerRef={containerRef}
      defaultOpenFraction={0.25}
      minHeight={120}
      minRemaining={180}
      toggleTestId="inspector-toggle"
      panelTestId="inspector-panel"
      resizerTestId="inspector-resizer"
      onHeightChange={onHeightChange}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="footer-panel footer-panel--inspector">
        <div className="footer-panel__section" data-testid="backlinks-panel">
          <div className="footer-panel__title">Backlinks</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : knowledge?.backlinks.length ? (
            knowledge.backlinks.map((backlink) => (
              <button
                key={backlink.filePath}
                className="footer-item"
                onClick={() => onOpenTarget(backlink.filePath)}
                type="button"
              >
                {backlink.title}
              </button>
            ))
          ) : (
            <div className="footer-empty">No backlinks</div>
          )}
        </div>

        <div className="footer-panel__section">
          <div className="footer-panel__title">Links</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : (
            <>
              {knowledge?.wikilinks.map((item) => (
                <button key={`wiki-${item.target}`} className="footer-item" onClick={() => onOpenTarget(item.target)} type="button">
                  [[{item.label}]]
                </button>
              ))}
              {knowledge?.markdownLinks.map((item) => (
                <button
                  key={`markdown-${item.target}`}
                  className="footer-item"
                  onClick={() => (item.target.startsWith("http") ? onOpenExternal(item.target) : onOpenTarget(item.target))}
                  type="button"
                >
                  {item.label}
                  {item.target.startsWith("http") ? <ExternalLink size={12} /> : null}
                </button>
              ))}
              {!knowledge?.wikilinks.length && !knowledge?.markdownLinks.length ? (
                <div className="footer-empty">No links</div>
              ) : null}
            </>
          )}
        </div>

        <div className="footer-panel__section" data-testid="tags-panel">
          <div className="footer-panel__title">Tags</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : knowledge?.tags.length ? (
            <div className="tag-list">
              {knowledge.tags.map((tag) => (
                <button key={tag.tag} className="tag-pill" onClick={() => onOpenTag(tag.tag)} type="button">
                  #{tag.tag}
                </button>
              ))}
            </div>
          ) : (
            <div className="footer-empty">No tags</div>
          )}

          {isMarkdown && activeTag ? (
            <div className="tag-results" data-testid="tag-results">
              <div className="footer-panel__subtitle">Results for #{activeTag}</div>
              {tagResults.map((result) => (
                <button key={result.filePath} className="footer-item" onClick={() => onOpenTarget(result.filePath)} type="button">
                  {result.title}
                </button>
              ))}
              {tagResults.length === 0 ? <div className="footer-empty">No notes for #{activeTag}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </SnapDrawer>
  );
}
