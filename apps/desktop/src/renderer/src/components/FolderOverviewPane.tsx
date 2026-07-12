import { useEffect, useState } from "react";
import { FileText, Folder, GitBranch, Link2, Plus } from "lucide-react";
import type { FolderOverview } from "@exo/core";

interface FolderOverviewPaneProps {
  directoryPath: string;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export function FolderOverviewPane({ directoryPath, onOpenFolder, onOpenFile, onClose }: FolderOverviewPaneProps) {
  const [overview, setOverview] = useState<FolderOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setOverview(null);
    setError(null);
    void window.exo.workspace.getFolderOverview(directoryPath).then(
      (next) => { if (!disposed) setOverview(next); },
      (cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { disposed = true; };
  }, [directoryPath]);

  if (error) return <section className="folder-overview folder-overview--error"><p>{error}</p></section>;
  if (!overview) return <section className="folder-overview"><p className="folder-overview__loading">Loading folder…</p></section>;

  const graph = overview.graphContext;
  return (
    <section className="folder-overview" data-testid="folder-overview">
      <header className="folder-overview__header">
        <div>
          <div className="folder-overview__eyebrow"><Folder size={14} /> Folder</div>
          <h1>{overview.title}</h1>
          <p>{overview.indexExists ? "A user-authored folder index grounds this overview." : "This folder has no index yet. Viewing it has not changed your files."}</p>
        </div>
        <div className="folder-overview__actions">
          {overview.indexExists ? (
            <button onClick={() => onOpenFile(overview.indexPath)} type="button">Open index</button>
          ) : (
            <button onClick={async () => onOpenFile((await window.exo.workspace.ensureFolderIndex(overview.directoryPath)).indexPath)} type="button"><Plus size={14} /> Create index</button>
          )}
          <button aria-label="Close folder overview" className="folder-overview__close" onClick={onClose} type="button">×</button>
        </div>
      </header>

      {Object.keys(overview.frontmatter).length > 0 ? (
        <dl className="folder-overview__properties">
          {Object.entries(overview.frontmatter).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}
        </dl>
      ) : null}

      <div className="folder-overview__grid">
        <section>
          <h2>Contents <span>{overview.children.length}</span></h2>
          <div className="folder-overview__list">
            {overview.children.length === 0 ? <p className="folder-overview__empty">Nothing here yet.</p> : overview.children.map((entry) => (
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
          ) : <p className="folder-overview__empty">Create an index to give this folder its own links and context.</p>}
        </section>
      </div>
    </section>
  );
}
