/**
 * Manual drag manager — replaces HTML5 DnD which doesn't work in Electron.
 *
 * Tracks mousedown → mousemove → mouseup on draggable elements.
 * A drag starts after the mouse moves past a threshold (5px).
 * Drop targets are identified by finding the pane leaf under the cursor
 * and computing which edge zone the cursor falls in.
 * Drop targets are filtered by content kind. Documents only drop on editor
 * panes. Terminal tabs can drop on terminal panes or into the editor canvas,
 * where they become terminal pane leaves inside the editor split graph.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DragPayload =
  | { kind: "document"; filePath: string; sourcePaneId?: string }
  | { kind: "terminal"; sessionId: string };

export interface DragState {
  payload: DragPayload;
  /** Current mouse position (viewport coords) */
  mouseX: number;
  mouseY: number;
}

export interface DragManager {
  /** Current drag in progress, or null */
  drag: DragState | null;
  /** Whether any drag is active (convenience for conditional rendering) */
  dragActive: boolean;
  /** Call from onMouseDown on a draggable element */
  startDrag: (event: React.MouseEvent, payload: DragPayload) => void;
  /** Which drop edge is currently hovered */
  hoverEdge: { leafId: string; edge: DropEdge; paneKind: PaneDropKind } | null;
}

export type DropEdge = "top" | "bottom" | "left" | "right" | "center";
export type PaneDropKind = "editor" | "terminal";

const DRAG_THRESHOLD = 5;

function acceptsPayload(paneKind: string | undefined, payload: DragPayload): paneKind is PaneDropKind {
  if (payload.kind === "document") {
    return paneKind === "editor";
  }
  return paneKind === "editor" || paneKind === "terminal";
}

function acceptsTabTarget(tabKind: string | undefined, payload: DragPayload): tabKind is PaneDropKind {
  if (payload.kind === "document") {
    return tabKind === "editor";
  }
  return tabKind === "terminal";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDragManager(
  onDrop: (leafId: string, edge: DropEdge, payload: DragPayload) => void,
): DragManager {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ leafId: string; edge: DropEdge; paneKind: PaneDropKind } | null>(null);

  // Refs to avoid stale closures in window event listeners
  const pendingRef = useRef<{
    payload: DragPayload;
    startX: number;
    startY: number;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const startDrag = useCallback((event: React.MouseEvent, payload: DragPayload) => {
    // Only left button
    if (event.button !== 0) return;
    pendingRef.current = {
      payload,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, []);

  useEffect(() => {
    function findTabTarget(x: number, y: number, payload: DragPayload): { leafId: string; edge: DropEdge; paneKind: PaneDropKind } | null {
      const elements = document.elementsFromPoint(x, y);
      for (const element of elements) {
        const tab = element instanceof HTMLElement ? element.closest<HTMLElement>("[data-tab-drop-pane-id]") : null;
        if (!tab) continue;

        const leafId = tab.dataset.tabDropPaneId;
        if (!leafId || !acceptsTabTarget(tab.dataset.tabDropKind, payload)) continue;
        return { leafId, edge: "center", paneKind: tab.dataset.tabDropKind };
      }
      return null;
    }

    function findLeafAndEdge(x: number, y: number, payload: DragPayload): { leafId: string; edge: DropEdge; paneKind: PaneDropKind } | null {
      const tabTarget = findTabTarget(x, y, payload);
      if (tabTarget) {
        return tabTarget;
      }

      const leaves = document.querySelectorAll<HTMLElement>("[data-pane-id]");
      for (const leaf of leaves) {
        if (!acceptsPayload(leaf.dataset.paneKind, payload)) continue;

        const rect = leaf.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

        const leafId = leaf.dataset.paneId!;
        const relX = (x - rect.left) / rect.width;
        const relY = (y - rect.top) / rect.height;

        let edge: DropEdge;
        if (relY < 0.25) edge = "top";
        else if (relY > 0.75) edge = "bottom";
        else if (relX < 0.25) edge = "left";
        else if (relX > 0.75) edge = "right";
        else edge = "center";

        return { leafId, edge, paneKind: leaf.dataset.paneKind };
      }
      return null;
    }

    function onMouseMove(event: MouseEvent) {
      const pending = pendingRef.current;
      if (pending && !dragRef.current) {
        const dx = event.clientX - pending.startX;
        const dy = event.clientY - pending.startY;
        if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD) {
          const state: DragState = {
            payload: pending.payload,
            mouseX: event.clientX,
            mouseY: event.clientY,
          };
          dragRef.current = state;
          setDrag(state);
          document.body.style.cursor = "grabbing";
        }
        return;
      }

      if (dragRef.current) {
        const state: DragState = {
          ...dragRef.current,
          mouseX: event.clientX,
          mouseY: event.clientY,
        };
        dragRef.current = state;
        setDrag(state);

        // Update hover edge for visual feedback
        const hit = findLeafAndEdge(event.clientX, event.clientY, state.payload);
        setHoverEdge(hit);
      }
    }

    function onMouseUp(event: MouseEvent) {
      const wasDragging = dragRef.current;

      if (wasDragging) {
        const hit = findLeafAndEdge(event.clientX, event.clientY, wasDragging.payload);
        if (hit) {
          onDropRef.current(hit.leafId, hit.edge, wasDragging.payload);
        }

        // Suppress the click that would fire after drag ends
        window.addEventListener("click", suppressClick, { capture: true, once: true });
      }

      // Clean up
      pendingRef.current = null;
      dragRef.current = null;
      setDrag(null);
      setHoverEdge(null);
      document.body.style.cursor = "";
    }

    function suppressClick(event: MouseEvent) {
      event.stopPropagation();
      event.preventDefault();
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return {
    drag,
    dragActive: drag !== null,
    startDrag,
    hoverEdge,
  };
}
