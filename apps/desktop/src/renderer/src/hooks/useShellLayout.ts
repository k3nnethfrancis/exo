import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceLayoutSettings } from "@exo/core";

import { paneId, usePaneTree, type PaneLeaf } from "./usePaneTree";
import { decodePersistedWorkspaceCanvas } from "./useWorkspaceLayoutPersistence";

const CANVAS_DEFAULT: PaneLeaf = {
  kind: "leaf",
  id: paneId(),
  content: { kind: "editor", openPaths: [], activePath: null },
};

const SIDEBAR_DEFAULT_WIDTH = 175;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 800;
const UTILITY_DEFAULT_WIDTH = 430;
const UTILITY_MIN_WIDTH = 320;
const UTILITY_MAX_WIDTH = 900;
const RESIZE_BODY_CLASS = "pane-resize-active";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useShellLayout() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [utilityWidth, setUtilityWidth] = useState(UTILITY_DEFAULT_WIDTH);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; inverted: boolean } | null>(null);
  const canvasPaneTree = usePaneTree(CANVAS_DEFAULT);

  const startSidebarResize = useCallback((event: React.MouseEvent, inverted = false) => {
    event.preventDefault();
    document.body.classList.add(RESIZE_BODY_CLASS);
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth, inverted };
  }, [sidebarWidth]);

  const startUtilityResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    document.body.classList.add(RESIZE_BODY_CLASS);
    sidebarResizeRef.current = { startX: event.clientX, startWidth: utilityWidth, inverted: true };
  }, [utilityWidth]);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const state = sidebarResizeRef.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      if (state.inverted) {
        setUtilityWidth(clamp(state.startWidth - delta, UTILITY_MIN_WIDTH, UTILITY_MAX_WIDTH));
      } else {
        setSidebarWidth(clamp(state.startWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      }
    }
    function onMouseUp() {
      sidebarResizeRef.current = null;
      document.body.classList.remove(RESIZE_BODY_CLASS);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove(RESIZE_BODY_CLASS);
    };
  }, []);

  const applyPersistedLayout = useCallback((layout: WorkspaceLayoutSettings | undefined) => {
    const restored = decodePersistedWorkspaceCanvas(layout);
    if (!restored) return;
    canvasPaneTree.actions.setTree(restored.canvas);
    setSidebarCollapsed(restored.sidebarCollapsed);
    setSidebarWidth(restored.sidebarWidth);
    setUtilityWidth(restored.utilityWidth);
  }, [canvasPaneTree.actions]);

  return {
    workspaceRef,
    workspaceBodyRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    startSidebarResize,
    utilityWidth,
    setUtilityWidth,
    startUtilityResize,
    canvasPaneTree,
    applyPersistedLayout,
  };
}
