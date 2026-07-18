import { ExternalLink, X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import type { InvocationRecord, NoteDocument, SearchResult, WorkspaceGraphContext } from "@exo/core";

import { buildNoteGraphContext } from "../graphAffordances";
import { GraphNeighborhoodView } from "./GraphNeighborhoodView";

type ConnectionTab = "outline" | "links" | "graph" | "activity";
const CONNECTION_TABS: readonly { id: ConnectionTab; label: string }[] = [
  { id: "outline", label: "Outline" },
  { id: "links", label: "Links" },
  { id: "graph", label: "Graph" },
  { id: "activity", label: "Activity" },
];

interface InspectorDockProps {
  document: NoteDocument | null;
  graphContext: WorkspaceGraphContext | null;
  open: boolean;
  activeTag: string | null;
  tagResults: SearchResult[];
  /** U1 can provide reviewed invocation history when the Canvas owns that stream. */
  invocationHistory?: readonly InvocationRecord[];
  onToggle: () => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenGraphCanvas?: (focusPath: string) => void;
}

export function InspectorDock(props: InspectorDockProps) {
  const {
    document,
    graphContext: loadedGraphContext,
    open,
    activeTag,
    tagResults,
    invocationHistory = [],
    onToggle,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
    onOpenGraphCanvas,
  } = props;
  const [activeTab, setActiveTab] = useState<ConnectionTab>("outline");
  const tabListId = useId();
  const graphContext = buildNoteGraphContext(loadedGraphContext);
  const isMarkdown = document?.kind === "markdown";
  const backlinks = isMarkdown ? graphContext?.backlinks ?? [] : [];
  const referenceLinks = isMarkdown ? graphContext?.outgoingLinks.filter((item) => item.resolution !== "external") ?? [] : [];
  const externalLinks = isMarkdown ? graphContext?.externalLinks ?? [] : [];
  const tags = isMarkdown ? graphContext?.tags ?? [] : [];
  const outline = isMarkdown ? extractOutline(document?.body ?? "") : [];
  const propertyEntries = Object.entries(document?.frontmatter ?? {}).filter(([key]) => !key.startsWith("branch_"));
  const meaningfulActivity = invocationHistory.filter(hasMeaningfulInvocationActivity);

  if (!open) {
    return null;
  }

  return (
    <section className="connections-rail" data-testid="inspector-panel">
      <header className="connections-rail__header">
        <div>
          <div className="connections-rail__title">Connections</div>
          <div className="connections-rail__summary">{backlinks.length} back · {referenceLinks.length + externalLinks.length} links</div>
        </div>
        <button aria-label="Close Connections" className="connections-rail__close" onClick={onToggle} title="Close Connections" type="button"><X size={15} /></button>
      </header>
      <div className="connections-rail__content">
      <div className="connections-panel">
        <section className="connections-panel__properties" data-testid="properties-graph-panel">
          <div className="connections-panel__section-title">Properties</div>
          {!isMarkdown ? <div className="footer-empty">No note selected</div> : propertyEntries.length ? (
            <div className="graph-properties">
              {propertyEntries.slice(0, 8).map(([key, value]) => (
                <div key={key} className="graph-property-row">
                  <span className="graph-property-row__key">{key}</span>
                  <span className="graph-property-row__value">{formatPropertyValue(value)}</span>
                </div>
              ))}
            </div>
          ) : <div className="footer-empty">No properties</div>}
        </section>

        <div className="connections-tabs" role="tablist" aria-label="Note connections" id={tabListId}>
          {CONNECTION_TABS.map((tab, index) => (
            <button
              key={tab.id}
              id={`${tabListId}-${tab.id}`}
              aria-controls={`${tabListId}-panel`}
              aria-selected={activeTab === tab.id}
              className="connections-tabs__tab"
              data-testid={`connections-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => moveConnectionTab(event, index, setActiveTab)}
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id={`${tabListId}-panel`}
          aria-labelledby={`${tabListId}-${activeTab}`}
          className="connections-panel__body"
          data-testid={`connections-panel-${activeTab}`}
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "outline" ? (
            <OutlineTab isMarkdown={isMarkdown} headings={outline} />
          ) : activeTab === "links" ? (
            <LinksTab isMarkdown={isMarkdown} backlinks={backlinks} references={referenceLinks} externalLinks={externalLinks} tags={tags} activeTag={activeTag} tagResults={tagResults} onOpenTarget={onOpenTarget} onOpenExternal={onOpenExternal} onOpenTag={onOpenTag} />
          ) : activeTab === "graph" ? (
            <GraphNeighborhoodView neighborhood={graphContext?.neighborhood ?? null} onOpenCanvas={onOpenGraphCanvas} onOpenTarget={onOpenTarget} onOpenExternal={onOpenExternal} onOpenTag={onOpenTag} />
          ) : meaningfulActivity.length ? (
            <ActivityTab records={meaningfulActivity} />
          ) : (
            <div className="footer-empty" data-testid="connections-activity-empty">No activity yet</div>
          )}
        </div>
      </div>
      </div>
    </section>
  );
}

function OutlineTab(props: {
  isMarkdown: boolean;
  headings: Array<{ level: number; text: string }>;
}) {
  if (!props.isMarkdown) return <div className="footer-empty">No note selected</div>;
  return (
    <section className="connections-panel__section" data-testid="outline-panel">
      <div className="connections-panel__section-title">Headings</div>
      {props.headings.length ? <ol className="connections-outline">{props.headings.map((heading, index) => <li key={`${heading.level}:${index}`} style={{ paddingInlineStart: `${Math.max(0, heading.level - 1) * 12}px` }}>{heading.text}</li>)}</ol> : <div className="footer-empty">No headings</div>}
    </section>
  );
}

function LinksTab(props: {
  isMarkdown: boolean;
  backlinks: Array<{ label: string; target: string }>;
  references: Array<{ label: string; target: string }>;
  externalLinks: Array<{ label: string; target: string }>;
  tags: string[];
  activeTag: string | null;
  tagResults: SearchResult[];
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}) {
  if (!props.isMarkdown) return <div className="footer-empty">No note selected</div>;
  return <>
    <ConnectionList title="Linked from" items={props.backlinks} onOpen={props.onOpenTarget} empty="No backlinks" />
    <ConnectionList title="Links to" items={props.references} onOpen={props.onOpenTarget} empty="No note links" />
    <ConnectionList title="External" items={props.externalLinks} onOpen={props.onOpenExternal} empty="No external links" external />
    <section className="connections-panel__section" data-testid="tags-panel">
      <div className="connections-panel__section-title">Tags</div>
      {props.tags.length ? <div className="tag-list">{props.tags.map((tag) => <button key={tag} className="tag-pill" onClick={() => props.onOpenTag(tag)} type="button">#{tag}</button>)}</div> : <div className="footer-empty">No tags</div>}
      {props.activeTag ? <div className="tag-results"><div className="footer-panel__subtitle">Results for #{props.activeTag}</div>{props.tagResults.map((result) => <button key={result.filePath} className="footer-item" onClick={() => props.onOpenTarget(result.filePath)} type="button">{result.title}</button>)}</div> : null}
    </section>
  </>;
}

function ConnectionList(props: { title: string; items: Array<{ label: string; target: string }>; onOpen: (target: string) => void; empty: string; external?: boolean }) {
  return <section className="connections-panel__section"><div className="connections-panel__section-title">{props.title}</div>{props.items.length ? props.items.map((item) => <button key={`${item.label}-${item.target}`} className="footer-item" onClick={() => props.onOpen(item.target)} type="button">{item.label}{props.external ? <ExternalLink size={12} /> : null}</button>) : <div className="footer-empty">{props.empty}</div>}</section>;
}

function ActivityTab({ records }: { records: readonly InvocationRecord[] }) {
  return <section className="connections-panel__section">{records.map((record) => <div className="connections-activity" key={record.id}><strong>@{record.command.handle}</strong><span>{record.changedFileRefs.length} changed file{record.changedFileRefs.length === 1 ? "" : "s"}</span></div>)}</section>;
}

export function hasMeaningfulInvocationActivity(record: Pick<InvocationRecord, "status" | "changedFileRefs" | "diffRefs">): boolean {
  return record.changedFileRefs.length > 0 || record.diffRefs.length > 0 || record.status === "failed" || record.status === "orphaned";
}

function moveConnectionTab(event: KeyboardEvent<HTMLButtonElement>, index: number, setTab: (tab: ConnectionTab) => void) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? CONNECTION_TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + CONNECTION_TABS.length) % CONNECTION_TABS.length;
  setTab(CONNECTION_TABS[next].id);
  requestAnimationFrame(() => document.getElementById(`${(event.currentTarget.parentElement as HTMLElement).id}-${CONNECTION_TABS[next].id}`)?.focus());
}

function formatPropertyValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function extractOutline(body: string): Array<{ level: number; text: string }> {
  return body.split(/\r?\n/u).flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    return match ? [{ level: match[1].length, text: match[2].trim() }] : [];
  });
}
