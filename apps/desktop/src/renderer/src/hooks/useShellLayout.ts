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

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 800;

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
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);

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

  // Sidebar width (pixels)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const startSidebarResize = useCallback((event: React.MouseEvent) => {
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
  }, [sidebarWidth]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const zoneState = zoneResizeRef.current;
      if (zoneState) {
        const delta = event.clientX - zoneState.startX;
        const ratioDelta = delta / zoneState.containerWidth;
        setZoneSplitRatio(clamp(zoneState.startRatio + ratioDelta, MIN_ZONE_RATIO, MAX_ZONE_RATIO));
      }

      const sidebarState = sidebarResizeRef.current;
      if (sidebarState) {
        const delta = event.clientX - sidebarState.startX;
        setSidebarWidth(clamp(sidebarState.startWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      }
    }

    function onMouseUp() {
      zoneResizeRef.current = null;
      sidebarResizeRef.current = null;
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
    terminalCollapsed,
    setTerminalCollapsed,
    zoneSplitRatio,
    startZoneResize,
    sidebarWidth,
    startSidebarResize,
  };
}
