import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SnapDrawerProps {
  className?: string;
  collapsed: boolean;
  label: string;
  summary?: ReactNode;
  containerRef: RefObject<HTMLElement | null>;
  defaultOpenFraction: number;
  minHeight?: number;
  minRemaining?: number;
  toggleTestId?: string;
  drawerTestId?: string;
  panelTestId?: string;
  resizerTestId?: string;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}

interface ResizeOrigin {
  startPointer: number;
  startHeight: number;
}

export function SnapDrawer(props: SnapDrawerProps) {
  const {
    className,
    collapsed,
    label,
    summary,
    containerRef,
    defaultOpenFraction,
    minHeight = 140,
    minRemaining = 140,
    toggleTestId,
    drawerTestId,
    panelTestId,
    resizerTestId,
    onCollapsedChange,
    children,
  } = props;
  const [height, setHeight] = useState<number | null>(null);
  const [resizeOrigin, setResizeOrigin] = useState<ResizeOrigin | null>(null);

  useEffect(() => {
    if (!collapsed && height === null) {
      setHeight(resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining));
    }
  }, [collapsed, containerRef, defaultOpenFraction, height, minHeight, minRemaining]);

  useEffect(() => {
    if (!resizeOrigin) {
      return;
    }

    const currentResize = resizeOrigin;

    function onMouseMove(event: MouseEvent) {
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
      if (!containerHeight) {
        return;
      }

      const delta = currentResize.startPointer - event.clientY;
      setHeight(clampDrawerHeight(currentResize.startHeight + delta, containerHeight, minHeight, minRemaining));
    }

    function onMouseUp() {
      setResizeOrigin(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [containerRef, minHeight, minRemaining, resizeOrigin]);

  function openDrawer() {
    if (height === null) {
      setHeight(resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining));
    }
    onCollapsedChange(false);
  }

  function toggleDrawer() {
    if (collapsed) {
      openDrawer();
      return;
    }

    onCollapsedChange(true);
  }

  function resetHeight() {
    setHeight(resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining));
  }

  return (
    <div
      className={`${className ?? ""} snap-drawer ${collapsed ? "snap-drawer--collapsed" : "snap-drawer--expanded"}`.trim()}
      data-testid={drawerTestId}
    >
      {collapsed ? null : (
        <div
          className="snap-drawer__resizer"
          data-testid={resizerTestId}
          onDoubleClick={resetHeight}
          onMouseDown={(event) =>
            setResizeOrigin({
              startPointer: event.clientY,
              startHeight: height ?? resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining),
            })
          }
        />
      )}

      <div className="snap-drawer__surface" style={!collapsed ? { height: `${height ?? resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining)}px` } : undefined}>
        <button className="snap-drawer__bar" data-testid={toggleTestId} onClick={toggleDrawer} type="button">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="snap-drawer__label">{label}</span>
          {summary ? <span className="snap-drawer__summary">{summary}</span> : null}
        </button>

        {collapsed ? null : (
          <div className="snap-drawer__panel" data-testid={panelTestId}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function resolveDefaultHeight(
  container: HTMLElement | null,
  defaultOpenFraction: number,
  minHeight: number,
  minRemaining: number,
): number {
  const containerHeight = container?.getBoundingClientRect().height ?? 0;
  if (!containerHeight) {
    return Math.max(minHeight, 220);
  }

  return clampDrawerHeight(Math.round(containerHeight * defaultOpenFraction), containerHeight, minHeight, minRemaining);
}

function clampDrawerHeight(value: number, containerHeight: number, minHeight: number, minRemaining: number): number {
  const max = Math.max(minHeight + 80, containerHeight - minRemaining);
  return Math.min(max, Math.max(minHeight, value));
}
