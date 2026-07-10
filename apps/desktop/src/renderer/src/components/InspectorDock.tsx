import { ExternalLink, ScanText } from "lucide-react";
import type { NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";
import { buildNoteGraphContext } from "../graphAffordances";
import { FloatingPanel } from "./FloatingPanel";
import { GraphNeighborhoodView } from "./GraphNeighborhoodView";

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
  const graphContext = buildNoteGraphContext(document, knowledge);
  const backlinkCount = isMarkdown ? graphContext?.backlinks.length ?? 0 : 0;
  const referenceLinks = isMarkdown ? graphContext?.outgoingLinks.filter((item) => item.resolution !== "external") ?? [] : [];
  const externalLinks = isMarkdown ? graphContext?.externalLinks ?? [] : [];
  const linkCount = referenceLinks.length + externalLinks.length;
  const tagCount = isMarkdown ? graphContext?.tags.length ?? 0 : 0;
  const propertyEntries = graphContext ? Object.entries(graphContext.properties).filter(([key]) => !key.startsWith("branch_")) : [];

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
          ) : graphContext?.backlinks.length ? (
            graphContext.backlinks.map((backlink) => (
              <button
                key={backlink.target}
                className="footer-item"
                onClick={() => onOpenTarget(backlink.target)}
                type="button"
              >
                {backlink.label}
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
          ) : graphContext?.tags.length ? (
            <div className="tag-list">
              {graphContext.tags.map((tag) => (
                <button key={tag} className="tag-pill" onClick={() => onOpenTag(tag)} type="button">
                  #{tag}
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

        <div className="footer-panel__section" data-testid="properties-graph-panel">
          <div className="footer-panel__title">Properties</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : propertyEntries.length ? (
            <div className="graph-properties">
              {propertyEntries.slice(0, 8).map(([key, value]) => (
                <div key={key} className="graph-property-row">
                  <span className="graph-property-row__key">{key}</span>
                  <span className="graph-property-row__value">{formatPropertyValue(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="footer-empty">No properties</div>
          )}
        </div>

        <div className="footer-panel__section" data-testid="graph-neighborhood-panel">
          <div className="footer-panel__title">Neighborhood</div>
          {!isMarkdown ? (
            <div className="footer-empty">No note selected</div>
          ) : (
            <GraphNeighborhoodView
              neighborhood={graphContext?.neighborhood ?? null}
              onOpenTarget={onOpenTarget}
              onOpenExternal={onOpenExternal}
              onOpenTag={onOpenTag}
            />
          )}
        </div>
      </div>
    </FloatingPanel>
  );
}

function formatPropertyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
