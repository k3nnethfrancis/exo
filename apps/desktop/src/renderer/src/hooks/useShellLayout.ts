import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceLayoutSettings } from "@exo/core";

import { paneId, usePaneTree, type PaneNode } from "./usePaneTree";

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
const RESIZE_BODY_CLASS = "pane-resize-active";

const SIDEBAR_DEFAULT_WIDTH = 175;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setResizeShield(active: boolean) {
  document.body.classList.toggle(RESIZE_BODY_CLASS, active);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShellLayout() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [sidePanesFlipped, setSidePanesFlipped] = useState(false);

  const editorPaneTree = usePaneTree(EDITOR_DEFAULT);
  const terminalPaneTree = usePaneTree(TERMINAL_DEFAULT);

  // Zone split ratio (editor fraction of workspace width)
  const [zoneSplitRatio, setZoneSplitRatio] = useState(0.6);
  const zoneResizeRef = useRef<{ startX: number; startRatio: number; containerWidth: number; inverted: boolean } | null>(null);

  const startZoneResize = useCallback((event: React.MouseEvent, containerWidth: number, inverted = false) => {
    if (containerWidth <= 0) {
      return;
    }
    zoneResizeRef.current = {
      startX: event.clientX,
      startRatio: zoneSplitRatio,
      containerWidth,
      inverted,
    };
    setResizeShield(true);
  }, [zoneSplitRatio]);

  // Sidebar width (pixels)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; inverted: boolean } | null>(null);

  const startSidebarResize = useCallback((event: React.MouseEvent, inverted = false) => {
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
      inverted,
    };
  }, [sidebarWidth]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const zoneState = zoneResizeRef.current;
      if (zoneState) {
        const delta = event.clientX - zoneState.startX;
        const ratioDelta = (zoneState.inverted ? -delta : delta) / zoneState.containerWidth;
        setZoneSplitRatio(clamp(zoneState.startRatio + ratioDelta, MIN_ZONE_RATIO, MAX_ZONE_RATIO));
      }

      const sidebarState = sidebarResizeRef.current;
      if (sidebarState) {
        const delta = event.clientX - sidebarState.startX;
        setSidebarWidth(clamp(sidebarState.startWidth + (sidebarState.inverted ? -delta : delta), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      }
    }

    function onMouseUp() {
      zoneResizeRef.current = null;
      sidebarResizeRef.current = null;
      setResizeShield(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setResizeShield(false);
    };
  }, []);

  const applyPersistedLayout = useCallback((layout: WorkspaceLayoutSettings | undefined) => {
    if (!layout) {
      return;
    }
    editorPaneTree.actions.setTree(layout.editorTree);
    terminalPaneTree.actions.setTree(layout.terminalTree);
    setTerminalCollapsed(layout.terminalCollapsed);
    setSidePanesFlipped(layout.sidePanesFlipped);
    setZoneSplitRatio(layout.zoneSplitRatio);
    setSidebarCollapsed(layout.sidebarCollapsed);
    setSidebarWidth(layout.sidebarWidth);
  }, [editorPaneTree.actions, terminalPaneTree.actions]);

  return {
    workspaceRef,
    workspaceBodyRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    editorPaneTree,
    terminalPaneTree,
    terminalCollapsed,
    setTerminalCollapsed,
    sidePanesFlipped,
    setSidePanesFlipped,
    zoneSplitRatio,
    setZoneSplitRatio,
    startZoneResize,
    sidebarWidth,
    setSidebarWidth,
    startSidebarResize,
    applyPersistedLayout,
  };
}
