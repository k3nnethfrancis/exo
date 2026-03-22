import { useEffect, useState } from "react";

interface ResizeState {
  axis: "vertical" | "horizontal";
  startSize: number;
  origin: number;
}

export interface TerminalDockState {
  placement: "right" | "bottom";
  collapsed: boolean;
  rightWidth: number;
  bottomHeight: number;
  dragActive: boolean;
  setActiveDrag: (active: boolean) => void;
  setCollapsed: (collapsed: boolean | ((current: boolean) => boolean)) => void;
  toggleCollapsed: () => void;
  moveDock: (placement: "right" | "bottom") => void;
  startResize: (axis: "vertical" | "horizontal", origin: number) => void;
}

export function useTerminalDockState(workspaceBodyRef: React.RefObject<HTMLDivElement | null>) {
  const [placement, setPlacement] = useState<"right" | "bottom">("right");
  const [collapsed, setCollapsed] = useState(true);
  const [rightWidth, setRightWidth] = useState(372);
  const [bottomHeight, setBottomHeight] = useState(236);
  const [dragActive, setDragActive] = useState(false);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  useEffect(() => {
    if (!resizeState) {
      return;
    }

    const currentResize = resizeState;

    function onMouseMove(event: MouseEvent) {
      const rect = workspaceBodyRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      if (currentResize.axis === "vertical") {
        const delta = currentResize.origin - event.clientX;
        setRightWidth(clamp(currentResize.startSize + delta, 280, Math.max(320, rect.width - 320)));
      } else {
        const delta = currentResize.origin - event.clientY;
        setBottomHeight(clamp(currentResize.startSize + delta, 180, Math.max(220, rect.height - 240)));
      }
    }

    function onMouseUp() {
      setResizeState(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizeState, workspaceBodyRef]);

  function moveDock(nextPlacement: "right" | "bottom") {
    setPlacement(nextPlacement);
    setCollapsed(false);
    if (nextPlacement === "right") {
      setRightWidth((current) => Math.max(312, current || 0, 372));
    } else {
      setBottomHeight((current) => Math.max(180, current || 0, 236));
    }
  }

  return {
    placement,
    collapsed,
    rightWidth,
    bottomHeight,
    dragActive,
    setActiveDrag: setDragActive,
    setCollapsed,
    toggleCollapsed: () => setCollapsed((current) => !current),
    moveDock,
    startResize: (axis, origin) =>
      setResizeState({
        axis,
        startSize: axis === "vertical" ? rightWidth : bottomHeight,
        origin,
      }),
  } satisfies TerminalDockState;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
