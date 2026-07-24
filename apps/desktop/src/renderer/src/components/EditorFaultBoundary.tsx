import { Component, type ErrorInfo, type ReactNode } from "react";

import {
  createEditorFaultDiagnostic,
  type EditorFaultContext,
  type EditorFaultDiagnostic,
} from "./editorFaultDiagnostics";

interface EditorFaultBoundaryProps {
  getContext: () => EditorFaultContext;
  children: ReactNode;
}

interface EditorFaultBoundaryState {
  hasFault: boolean;
  diagnostic: EditorFaultDiagnostic | null;
}

/**
 * Contain an editor-only renderer exception. This is intentionally not a
 * retry mechanism: the failed pane stays visible and the safe state snapshot
 * is written to Exo's local log for a real reproduction/fix cycle.
 */
export class EditorFaultBoundary extends Component<EditorFaultBoundaryProps, EditorFaultBoundaryState> {
  state: EditorFaultBoundaryState = { hasFault: false, diagnostic: null };

  static getDerivedStateFromError(): EditorFaultBoundaryState {
    return { hasFault: true, diagnostic: null };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const diagnostic = createEditorFaultDiagnostic(this.props.getContext(), error);
    this.setState({ hasFault: true, diagnostic });
    // Keep the original error in the live DevTools console while the durable
    // record below remains explicitly content-free.
    console.error("[exo] editor render fault", diagnostic, error);
    void window.exo.workspace.recordRendererDiagnostic(diagnostic).catch((loggingError) => {
      console.error("[exo] failed to persist editor render diagnostic", loggingError);
    });
  }

  render() {
    if (this.state.hasFault) {
      return (
        <section className="editor-fault" role="status" aria-live="polite">
          <strong>Editor paused.</strong>
          <span>Refresh Exo to continue.</span>
        </section>
      );
    }
    return this.props.children;
  }
}
