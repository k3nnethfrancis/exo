import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface FooterDrawerProps {
  className?: string;
  collapsed: boolean;
  label: string;
  icon?: ReactNode;
  summary?: ReactNode;
  containerRef: RefObject<HTMLElement | null>;
  defaultOpenFraction: number;
  preferredHeight?: number;
  minHeight?: number;
  minRemaining?: number;
  toggleTestId?: string;
  panelTestId?: string;
  resizerTestId?: string;
  onHeightChange?: (height: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  children: ReactNode;
}

interface ResizeOrigin {
  startPointer: number;
  startHeight: number;
}

export function FooterDrawer(props: FooterDrawerProps) {
  const {
    className,
    collapsed,
    label,
    icon,
    summary,
    containerRef,
    defaultOpenFraction,
    preferredHeight,
    minHeight = 140,
    minRemaining = 140,
    toggleTestId,
    panelTestId,
    resizerTestId,
    onHeightChange,
    onCollapsedChange,
    children,
  } = props;
  const [height, setHeight] = useState<number | null>(null);
  const [resizeOrigin, setResizeOrigin] = useState<ResizeOrigin | null>(null);

  useEffect(() => {
    if (!collapsed && height === null) {
      setHeight(
        preferredHeight !== undefined
          ? clampDrawerHeight(preferredHeight, containerRef.current?.getBoundingClientRect().height ?? 0, minHeight, minRemaining)
          : resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining),
      );
    }
  }, [collapsed, containerRef, defaultOpenFraction, height, minHeight, minRemaining, preferredHeight]);

  useEffect(() => {
    if (collapsed || preferredHeight === undefined || resizeOrigin) {
      return;
    }

    const containerHeight = containerRef.current?.getBoundingClientRect().height ?? 0;
    if (!containerHeight) {
      return;
    }

    setHeight(clampDrawerHeight(preferredHeight, containerHeight, minHeight, minRemaining));
  }, [collapsed, containerRef, minHeight, minRemaining, preferredHeight, resizeOrigin]);

  useEffect(() => {
    onHeightChange?.(
      collapsed
        ? 36
        : height ??
            (preferredHeight !== undefined
              ? clampDrawerHeight(preferredHeight, containerRef.current?.getBoundingClientRect().height ?? 0, minHeight, minRemaining)
              : resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining)),
    );
  }, [collapsed, containerRef, defaultOpenFraction, height, minHeight, minRemaining, onHeightChange, preferredHeight]);

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

  function toggleDrawer() {
    if (collapsed) {
      if (height === null) {
        setHeight(
          preferredHeight !== undefined
            ? clampDrawerHeight(preferredHeight, containerRef.current?.getBoundingClientRect().height ?? 0, minHeight, minRemaining)
            : resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining),
        );
      }
      onCollapsedChange(false);
      return;
    }

    onCollapsedChange(true);
  }

  function resetHeight() {
    setHeight(resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining));
  }

  const resolvedHeight =
    height ??
    (preferredHeight !== undefined
      ? clampDrawerHeight(preferredHeight, containerRef.current?.getBoundingClientRect().height ?? 0, minHeight, minRemaining)
      : resolveDefaultHeight(containerRef.current, defaultOpenFraction, minHeight, minRemaining));

  return (
    <div className={`${className ?? ""} footer-drawer ${collapsed ? "footer-drawer--collapsed" : "footer-drawer--expanded"}`.trim()}>
      {!collapsed ? (
        <div
          className="footer-drawer__resizer"
          data-testid={resizerTestId}
          onDoubleClick={resetHeight}
          onMouseDown={(event) =>
            setResizeOrigin({
              startPointer: event.clientY,
              startHeight: resolvedHeight,
            })
          }
        />
      ) : null}

      <div className="footer-drawer__surface" style={!collapsed ? { height: `${resolvedHeight}px` } : undefined}>
        <button className="footer-drawer__bar" data-testid={toggleTestId} onClick={toggleDrawer} type="button">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {icon ? <span className="footer-drawer__icon">{icon}</span> : null}
          <span className="footer-drawer__label">{label}</span>
          {summary ? <span className="footer-drawer__summary">{summary}</span> : null}
        </button>

        {!collapsed ? (
          <div className="footer-drawer__panel" data-testid={panelTestId}>
            {children}
          </div>
        ) : null}
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
