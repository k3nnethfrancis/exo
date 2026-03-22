import { ExternalLink, ScanText } from "lucide-react";
import type { NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";
import { FloatingPanel } from "./FloatingPanel";

interface InspectorDockProps {
  document: NoteDocument | null;
  knowledge: NoteKnowledge | null;
  open: boolean;
  activeTag: string | null;
  tagResults: SearchResult[];
  onToggle: () => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}

export function InspectorDock(props: InspectorDockProps) {
  const {
    document,
    knowledge,
    open,
    activeTag,
    tagResults,
    onToggle,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
  } = props;

  const isMarkdown = document?.kind === "markdown";
  const backlinkCount = isMarkdown ? knowledge?.backlinks.length ?? 0 : 0;
  const referenceLinks = isMarkdown
    ? [
        ...(knowledge?.wikilinks.map((item) => ({
          label: item.label,
          target: item.target,
          kind: "wikilink" as const,
        })) ?? []),
        ...(knowledge?.markdownLinks
          .filter((item) => !item.target.startsWith("http"))
          .map((item) => ({
            label: item.label,
            target: item.target,
            kind: "markdown" as const,
          })) ?? []),
      ]
    : [];
  const externalLinks = isMarkdown ? knowledge?.markdownLinks.filter((item) => item.target.startsWith("http")) ?? [] : [];
  const linkCount = referenceLinks.length + externalLinks.length;
  const tagCount = isMarkdown ? knowledge?.tags.length ?? 0 : 0;

  return (
    <FloatingPanel
      open={open}
      icon={<ScanText size={13} />}
      label="Inspector"
      summary={`Backlinks ${backlinkCount}  Links ${linkCount}  Tags ${tagCount}`}
      anchorClassName="floating-panel--editor"
      panelClassName="floating-panel__surface--inspector"
      buttonTestId="inspector-toggle"
      panelTestId="inspector-panel"
      onToggle={onToggle}
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

        <div className="footer-panel__section" data-testid="references-panel">
          <div className="footer-panel__title">References</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : (
            <>
              {referenceLinks.map((item) => (
                <button key={`${item.kind}-${item.target}`} className="footer-item" onClick={() => onOpenTarget(item.target)} type="button">
                  {item.label}
                </button>
              ))}
              {!referenceLinks.length ? (
                <div className="footer-empty">No note references</div>
              ) : null}
            </>
          )}
        </div>

        <div className="footer-panel__section" data-testid="links-panel">
          <div className="footer-panel__title">Links</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : (
            <>
              {externalLinks.map((item) => (
                <button
                  key={`markdown-${item.target}`}
                  className="footer-item"
                  onClick={() => onOpenExternal(item.target)}
                  type="button"
                >
                  {item.label}
                  <ExternalLink size={12} />
                </button>
              ))}
              {!externalLinks.length ? (
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
    </FloatingPanel>
  );
}
