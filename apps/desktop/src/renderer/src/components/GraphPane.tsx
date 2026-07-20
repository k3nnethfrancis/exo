import { Network, X } from "lucide-react";

import type { GraphFocusRequest, InspectedConcept } from "../hooks/useInspectedConcept";
import { SpatialGraphView } from "./SpatialGraphView";

interface GraphPaneProps {
  onClose: () => void;
  onOpenTarget: (target: string) => void;
  inspectedConcept: InspectedConcept | null;
  focusRequest: GraphFocusRequest | null;
  activeEditorPath?: string | null;
  isTargetOpen: (target: string) => boolean;
  onInspectConcept: (concept: InspectedConcept) => void;
  onFocusConcept: (concept: InspectedConcept) => void;
  onRestoreEditorConcept: (filePath: string) => void;
  onActivateOpenTarget: (filePath: string) => void;
}

export function GraphPane(props: GraphPaneProps) {
  return (
    <section className="graph-pane" data-testid="graph-pane">
      <header className="graph-pane__header">
        <div className="graph-pane__title"><Network aria-hidden="true" size={14} /><span>Graph</span></div>
        <button aria-label="Close graph" onClick={props.onClose} title="Close graph" type="button"><X size={14} /></button>
      </header>
      <SpatialGraphView
        inspectedConcept={props.inspectedConcept}
        focusRequest={props.focusRequest}
        activeEditorPath={props.activeEditorPath}
        isTargetOpen={props.isTargetOpen}
        onInspectConcept={props.onInspectConcept}
        onFocusConcept={props.onFocusConcept}
        onRestoreEditorConcept={props.onRestoreEditorConcept}
        onActivateOpenTarget={props.onActivateOpenTarget}
        onOpenTarget={props.onOpenTarget}
      />
    </section>
  );
}
