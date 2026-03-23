import { useCallback, useEffect, useRef, useState } from "react";

import { paneId, usePaneTree, type PaneNode, type PaneLeaf } from "./usePaneTree";

// ---------------------------------------------------------------------------
// Default trees — one for each zone
// ---------------------------------------------------------------------------

const EDITOR_DEFAULT: PaneNode = {
  kind: "leaf",
  id: paneId(),
  content: { kind: "editor", openPaths: [], activePath: null },
};

const TERMINAL_DEFAULT: PaneNode = {
  kind: "leaf",
  id: paneId(),
  content: { kind: "terminal", terminalIds: [], activeTerminalId: null },
};

// ---------------------------------------------------------------------------
// Zone resize
// ---------------------------------------------------------------------------

const MIN_ZONE_RATIO = 0.15;
const MAX_ZONE_RATIO = 0.85;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShellLayout() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);

  const editorPaneTree = usePaneTree(EDITOR_DEFAULT);
  const terminalPaneTree = usePaneTree(TERMINAL_DEFAULT);

  // Zone split ratio (editor fraction of workspace width)
  const [zoneSplitRatio, setZoneSplitRatio] = useState(0.6);
  const zoneResizeRef = useRef<{ startX: number; startRatio: number; containerWidth: number } | null>(null);

  const startZoneResize = useCallback((event: React.MouseEvent, containerWidth: number) => {
    zoneResizeRef.current = {
      startX: event.clientX,
      startRatio: zoneSplitRatio,
      containerWidth,
    };
  }, [zoneSplitRatio]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const state = zoneResizeRef.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      const ratioDelta = delta / state.containerWidth;
      setZoneSplitRatio(clamp(state.startRatio + ratioDelta, MIN_ZONE_RATIO, MAX_ZONE_RATIO));
    }

    function onMouseUp() {
      zoneResizeRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return {
    workspaceRef,
    workspaceBodyRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    inspectorCollapsed,
    setInspectorCollapsed,
    editorPaneTree,
    terminalPaneTree,
    zoneSplitRatio,
    startZoneResize,
  };
}
