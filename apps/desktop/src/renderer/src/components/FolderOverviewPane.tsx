import { useEffect, useState } from "react";
import { FileText, Folder, GitBranch, Link2, Plus } from "lucide-react";
import type { FolderOverview } from "@exo/core";

interface FolderOverviewPaneProps {
  directoryPath: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

const folderOverviewCache = new Map<string, FolderOverview>();

export function FolderOverviewPane({ directoryPath, onOpenFolder, onOpenFile, onClose }: FolderOverviewPaneProps) {
  const [overview, setOverview] = useState<FolderOverview | null>(() => folderOverviewCache.get(directoryPath) ?? null);
  const [graphContext, setGraphContext] = useState<FolderOverview["graphContext"]>(null);
  const [graphStatus, setGraphStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<{ directoryPath: string; message: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let graphIdleId: number | undefined;
    let graphTimeoutId: number | undefined;
    setError(null);
    setOverview(folderOverviewCache.get(directoryPath) ?? null);
    setGraphContext(null);
    setGraphStatus("idle");
    void window.exo.workspace.getFolderOverview(directoryPath).then(
      (next) => {
        if (disposed) return;
        folderOverviewCache.set(directoryPath, next);
        setOverview(next);
        if (next.indexExists) {
          setGraphStatus("loading");
          const loadGraphContext = () => {
            void window.exo.notes.getGraphContext(next.indexPath).then(
              (graph) => { if (!disposed) { setGraphContext(graph); setGraphStatus("ready"); } },
              (cause) => { if (!disposed) setGraphStatus("error"); console.warn("[exo] failed to enrich folder overview", { directoryPath, cause }); },
            );
          };
          if (typeof window.requestIdleCallback === "function") {
            graphIdleId = window.requestIdleCallback(loadGraphContext, { timeout: 500 });
          } else {
            graphTimeoutId = window.setTimeout(loadGraphContext, 100);
          }
        }
      },
      (cause) => { if (!disposed) setError({ directoryPath, message: cause instanceof Error ? cause.message : String(cause) }); },
    );
    return () => {
      disposed = true;
      if (graphIdleId !== undefined) window.cancelIdleCallback(graphIdleId);
      if (graphTimeoutId !== undefined) window.clearTimeout(graphTimeoutId);
    };
  }, [directoryPath]);

  if (error?.directoryPath === directoryPath) return <section className="folder-overview folder-overview--error"><p>{error.message}</p></section>;

  const loadedOverview = overview?.directoryPath === directoryPath ? overview : null;
  const title = loadedOverview?.title ?? directoryTitle(directoryPath);
  const graph = graphContext;
  async function createIndex() {
    const result = await window.exo.workspace.ensureFolderIndex(directoryPath);
    folderOverviewCache.delete(directoryPath);
    onOpenFile(result.indexPath);
  }

  return (
    <section className="folder-overview" data-testid="folder-overview" data-folder-loaded={loadedOverview ? "true" : "false"}>
      <header className="folder-overview__header">
        <div>
          <div className="folder-overview__eyebrow"><Folder size={14} /> Folder</div>
          <h1>{title}</h1>
          {loadedOverview ? <p>{loadedOverview.indexExists ? "A user-authored folder index grounds this overview." : "This folder has no index yet. Viewing it has not changed your files."}</p> : null}
        </div>
        <div className="folder-overview__actions">
          {loadedOverview ? loadedOverview.indexExists ? (
            <button onClick={() => onOpenFile(loadedOverview.indexPath)} type="button">Open index</button>
          ) : (
            <button onClick={() => void createIndex()} type="button"><Plus size={14} /> Create index</button>
          ) : null}
          <button aria-label="Close folder overview" className="folder-overview__close" onClick={onClose} type="button">×</button>
        </div>
      </header>

      {loadedOverview && Object.keys(loadedOverview.frontmatter).length > 0 ? (
        <dl className="folder-overview__properties">
          {Object.entries(loadedOverview.frontmatter).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}
        </dl>
      ) : null}

      {loadedOverview ? <div className="folder-overview__grid">
        <section>
          <h2>Contents <span>{loadedOverview.children.length}</span></h2>
          <div className="folder-overview__list">
            {loadedOverview.children.length === 0 ? <p className="folder-overview__empty">Nothing here yet.</p> : loadedOverview.children.map((entry) => (
              <button key={entry.path} onClick={() => entry.kind === "directory" ? onOpenFolder(entry.path) : onOpenFile(entry.path)} type="button">
                {entry.kind === "directory" ? <Folder size={15} /> : <FileText size={15} />}
                <span>{entry.kind === "file" ? entry.name.replace(/\.md$/i, "") : entry.name}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2><GitBranch size={14} /> Local context</h2>
          {graph ? (
            <div className="folder-overview__context">
              <p><Link2 size={14} /> {graph.outgoing.length} links · {graph.backlinks.length} backlinks</p>
              {[...graph.outgoing, ...graph.backlinks].flatMap((entry) => entry.note ? [entry.note] : []).slice(0, 6).map((entry) => <button key={entry.filePath} onClick={() => onOpenFile(entry.filePath)} type="button">{entry.title}</button>)}
            </div>
          ) : <p className="folder-overview__empty">{
            !loadedOverview.indexExists
              ? "Create an index to give this folder its own links and context."
              : graphStatus === "error"
                ? "Local context is unavailable."
                : graphStatus === "ready"
                  ? "No local links yet."
                  : "Loading context…"
          }</p>}
        </section>
      </div> : <p className="folder-overview__loading">Loading contents…</p>}
    </section>
  );
}

function directoryTitle(directoryPath: string): string {
  return directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Folder";
}
