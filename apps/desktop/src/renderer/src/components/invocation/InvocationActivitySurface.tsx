import {
  ArrowUpRight,
  Bot,
  Check,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, type FocusEvent, type MouseEvent, type ReactNode } from "react";

import { AgentIcon } from "../AgentIcon";
import "./invocation-ui.css";

export type InvocationActivityKind =
  | "checking"
  | "working"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "finishing"
  | "done"
  | "failed";

export interface InvocationActivitySurfaceProps {
  kind: InvocationActivityKind;
  commandHandle: string;
  commandLabel?: string;
  label?: string;
  errorDetail?: string;
  autoDismissMs?: number;
  onStop?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  onResume?: () => void;
  onShowDetails?: () => void;
}

export function InvocationActivitySurface({
  kind,
  commandHandle,
  commandLabel,
  label,
  errorDetail,
  autoDismissMs = 1_800,
  onStop,
  onRetry,
  onDismiss,
  onResume,
  onShowDetails,
}: InvocationActivitySurfaceProps) {
  const autoDismiss = useHoverFocusAutoDismiss({
    enabled: kind === "done" && Boolean(onDismiss),
    delayMs: autoDismissMs,
    onDismiss,
  });
  const failed = kind === "failed";
  const active = !failed && kind !== "done";

  return (
    <aside
      aria-atomic="true"
      aria-live="polite"
      className={`invocation-activity invocation-activity--${failed ? "failed" : kind === "done" ? "done" : "active"}`}
      data-testid="invocation-activity"
      onBlur={autoDismiss.onBlur}
      onFocus={autoDismiss.onFocus}
      onMouseEnter={autoDismiss.onMouseEnter}
      onMouseLeave={autoDismiss.onMouseLeave}
      role="status"
    >
      <span className={`invocation-agent-mark invocation-agent-mark--${agentKind(commandHandle)}`}>
        <ActivityAgentIcon handle={commandHandle} />
      </span>
      <ActivityStateIcon kind={kind} />
      <div className="invocation-activity__copy">
        <strong>{activityTitle(kind, label)}</strong>
        <span>{failed ? errorDetail ?? `${commandLabel ?? commandHandle} could not finish.` : commandLabel ?? `@${commandHandle}`}</span>
      </div>
      <div aria-label="Invocation actions" className="invocation-activity__actions" role="group">
        {active && onStop ? (
          <IconAction label="Stop" onClick={onStop}><Square size={13} /></IconAction>
        ) : null}
        {failed && onRetry ? (
          <IconAction label="Retry" onClick={onRetry}><RotateCcw size={14} /></IconAction>
        ) : null}
        {onResume ? (
          <IconAction label="Resume in Terminal" onClick={onResume}><ArrowUpRight size={14} /></IconAction>
        ) : null}
        {failed && errorDetail && onShowDetails ? (
          <button className="invocation-activity__details" onClick={onShowDetails} type="button">Details</button>
        ) : null}
        {(failed || kind === "done") && onDismiss ? (
          <IconAction label="Dismiss" onClick={onDismiss}><X size={14} /></IconAction>
        ) : null}
      </div>
    </aside>
  );
}

function ActivityStateIcon({ kind }: { kind: InvocationActivityKind }) {
  if (kind === "done") return <Check aria-hidden="true" className="invocation-activity__state" size={15} />;
  if (kind === "failed") return <CircleAlert aria-hidden="true" className="invocation-activity__state" size={15} />;
  if (kind === "searching") return <Search aria-hidden="true" className="invocation-activity__state" size={15} />;
  if (kind === "editing") return <FilePenLine aria-hidden="true" className="invocation-activity__state" size={15} />;
  return <LoaderCircle aria-hidden="true" className="invocation-activity__state invocation-activity__state--working" size={15} />;
}

function ActivityAgentIcon({ handle }: { handle: string }) {
  const kind = agentKind(handle);
  return kind === "default"
    ? <Bot aria-hidden="true" size={15} strokeWidth={1.8} />
    : <AgentIcon kind={kind} size={15} />;
}

function agentKind(handle: string): "claude" | "codex" | "default" {
  return handle === "claude" || handle === "codex" ? handle : "default";
}

export function activityTitle(kind: InvocationActivityKind, label?: string): string {
  const base = kind === "checking" ? "Checking"
    : kind === "working" ? "Working"
    : kind === "reading" ? "Reading"
      : kind === "searching" ? "Searching"
        : kind === "editing" ? "Editing"
          : kind === "running" ? "Running"
            : kind === "finishing" ? "Finishing"
              : kind === "done" ? "Done"
                : "Failed";
  return label && kind !== "done" && kind !== "failed" ? `${base} ${label}` : base;
}

function IconAction({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button aria-label={label} className="invocation-icon-action" onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

interface AutoDismissInput {
  enabled: boolean;
  delayMs: number;
  onDismiss?: () => void;
}

export function useHoverFocusAutoDismiss({ enabled, delayMs, onDismiss }: AutoDismissInput) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(delayMs);
  const startedAtRef = useRef(0);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(() => {
    clear();
    if (!enabled || !onDismiss) return;
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(onDismiss, Math.max(0, remainingRef.current));
  }, [clear, enabled, onDismiss]);

  const pause = useCallback(() => {
    if (!timerRef.current) return;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    clear();
  }, [clear]);

  useEffect(() => {
    remainingRef.current = delayMs;
    start();
    return clear;
  }, [clear, delayMs, start]);

  const resume = useCallback(() => {
    if (hoveredRef.current || focusedRef.current) return;
    if (remainingRef.current <= 0) remainingRef.current = delayMs;
    start();
  }, [delayMs, start]);

  return {
    onMouseEnter: (_event: MouseEvent<HTMLElement>) => {
      hoveredRef.current = true;
      pause();
    },
    onMouseLeave: (_event: MouseEvent<HTMLElement>) => {
      hoveredRef.current = false;
      resume();
    },
    onFocus: (_event: FocusEvent<HTMLElement>) => {
      focusedRef.current = true;
      pause();
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        focusedRef.current = false;
        resume();
      }
    },
  };
}
