import { Network, X } from "lucide-react";

import { SpatialGraphView } from "./SpatialGraphView";

export function GraphPane({ onClose, onOpenTarget, focusPath, activePath }: { onClose: () => void; onOpenTarget: (target: string) => void; focusPath?: string | null; activePath?: string | null }) {
  return (
    <section className="graph-pane" data-testid="graph-pane">
      <header className="graph-pane__header">
        <div className="graph-pane__title"><Network aria-hidden="true" size={14} /><span>Graph</span></div>
        <button aria-label="Close graph" onClick={onClose} title="Close graph" type="button"><X size={14} /></button>
      </header>
      <SpatialGraphView focusPath={focusPath} activePath={activePath} onOpenTarget={onOpenTarget} />
    </section>
  );
}
