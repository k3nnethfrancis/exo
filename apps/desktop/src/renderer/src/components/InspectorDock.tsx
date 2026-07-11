import { ExternalLink, ScanText } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import type { InvocationRecord, NoteDocument, SearchResult, WorkspaceGraphContext } from "@exo/core";

import { buildNoteGraphContext } from "../graphAffordances";
import { FloatingPanel } from "./FloatingPanel";
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
  } = props;
  const [activeTab, setActiveTab] = useState<ConnectionTab>("outline");
  const tabListId = useId();
  const graphContext = buildNoteGraphContext(loadedGraphContext);
  const isMarkdown = document?.kind === "markdown";
  const backlinks = isMarkdown ? graphContext?.backlinks ?? [] : [];
  const referenceLinks = isMarkdown ? graphContext?.outgoingLinks.filter((item) => item.resolution !== "external") ?? [] : [];
  const externalLinks = isMarkdown ? graphContext?.externalLinks ?? [] : [];
  const tags = isMarkdown ? graphContext?.tags ?? [] : [];
  const propertyEntries = Object.entries(document?.frontmatter ?? {}).filter(([key]) => !key.startsWith("branch_"));
  const meaningfulActivity = invocationHistory.filter(hasMeaningfulInvocationActivity);

  return (
    <FloatingPanel
      open={open}
      icon={<ScanText size={13} />}
      label="Connections"
      summary={`${backlinks.length} back  ${referenceLinks.length + externalLinks.length} links`}
      anchorClassName="floating-panel--editor"
      panelClassName="floating-panel__surface--inspector"
      buttonTestId="inspector-toggle"
      panelTestId="inspector-panel"
      onToggle={onToggle}
    >
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
            <OutlineTab isMarkdown={isMarkdown} backlinks={backlinks} references={referenceLinks} tags={tags} activeTag={activeTag} tagResults={tagResults} onOpenTarget={onOpenTarget} onOpenTag={onOpenTag} />
          ) : activeTab === "links" ? (
            <LinksTab isMarkdown={isMarkdown} links={externalLinks} onOpenExternal={onOpenExternal} />
          ) : activeTab === "graph" ? (
            <GraphNeighborhoodView neighborhood={graphContext?.neighborhood ?? null} onOpenTarget={onOpenTarget} onOpenExternal={onOpenExternal} onOpenTag={onOpenTag} />
          ) : meaningfulActivity.length ? (
            <ActivityTab records={meaningfulActivity} />
          ) : (
            <div className="footer-empty" data-testid="connections-activity-empty">No activity yet</div>
          )}
        </div>
      </div>
    </FloatingPanel>
  );
}

function OutlineTab(props: {
  isMarkdown: boolean;
  backlinks: Array<{ label: string; target: string }>;
  references: Array<{ label: string; target: string }>;
  tags: string[];
  activeTag: string | null;
  tagResults: SearchResult[];
  onOpenTarget: (target: string) => void;
  onOpenTag: (tag: string) => void;
}) {
  if (!props.isMarkdown) return <div className="footer-empty">No note selected</div>;
  return (
    <>
      <ConnectionList title="Linked from" items={props.backlinks} onOpen={props.onOpenTarget} empty="No backlinks" />
      <ConnectionList title="Links to" items={props.references} onOpen={props.onOpenTarget} empty="No note links" />
      <section className="connections-panel__section" data-testid="tags-panel">
        <div className="connections-panel__section-title">Tags</div>
        {props.tags.length ? <div className="tag-list">{props.tags.map((tag) => <button key={tag} className="tag-pill" onClick={() => props.onOpenTag(tag)} type="button">#{tag}</button>)}</div> : <div className="footer-empty">No tags</div>}
        {props.activeTag ? <div className="tag-results"><div className="footer-panel__subtitle">Results for #{props.activeTag}</div>{props.tagResults.map((result) => <button key={result.filePath} className="footer-item" onClick={() => props.onOpenTarget(result.filePath)} type="button">{result.title}</button>)}</div> : null}
      </section>
    </>
  );
}

function LinksTab(props: { isMarkdown: boolean; links: Array<{ label: string; target: string }>; onOpenExternal: (target: string) => void }) {
  if (!props.isMarkdown) return <div className="footer-empty">No note selected</div>;
  return <ConnectionList title="External links" items={props.links} onOpen={props.onOpenExternal} empty="No external links" external />;
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
