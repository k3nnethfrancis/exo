import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface FloatingPanelProps {
  open: boolean;
  icon: ReactNode;
  label: string;
  summary?: ReactNode;
  anchorClassName: string;
  panelClassName?: string;
  panelTestId?: string;
  buttonTestId?: string;
  onToggle: () => void;
  children: ReactNode;
}

export function FloatingPanel(props: FloatingPanelProps) {
  const {
    open,
    icon,
    label,
    summary,
    anchorClassName,
    panelClassName,
    panelTestId,
    buttonTestId,
    onToggle,
    children,
  } = props;

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (surfaceRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      onToggle();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onToggle();
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);

  return (
    <div className={`floating-panel ${anchorClassName} ${open ? "floating-panel--open" : ""}`.trim()}>
      {!open ? (
        <button
          ref={toggleRef}
          className="floating-panel__toggle"
          data-testid={buttonTestId}
          onClick={onToggle}
          title={label}
          type="button"
        >
          <span className="floating-panel__toggle-icon">{icon}</span>
        </button>
      ) : null}

      {open ? (
        <div ref={surfaceRef} className={`floating-panel__surface ${panelClassName ?? ""}`.trim()} data-testid={panelTestId}>
          <div className="floating-panel__header">
            <div className="floating-panel__header-main">
              <span className="floating-panel__header-icon">{icon}</span>
              <span className="floating-panel__header-label">{label}</span>
            </div>
            <div className="floating-panel__header-meta">
              {summary ? <span className="floating-panel__header-summary">{summary}</span> : null}
              <button className="floating-panel__close" onClick={onToggle} title={`Close ${label}`} type="button">
                <X size={12} />
              </button>
            </div>
          </div>
          <div className="floating-panel__body">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
