import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { Bot, GripVertical, LayoutGrid, RefreshCw, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { DragManager } from "../hooks/useDragManager";
import { isReconnectableSession, isTerminalInputEnabled } from "../terminalSessions";
import type { ExoThemeVariant } from "../theme/types";
import { AgentIcon } from "./AgentIcon";
import { ChromeTab } from "./Chrome";
import type { TerminalHydrationReason } from "./terminalHydration";
import { focusTerminal } from "./terminalRegistry";
import { TerminalView } from "./TerminalView";

interface TerminalDockProps {
  placement: "right" | "bottom";
  paneId: string;
  theme: ExoThemeVariant;
  compact: boolean;
  empty: boolean;
  focused: boolean;
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  hydrationSnapshots: Record<string, string>;
  hydrationVersions: Record<string, number>;
  hydrationReasons: Record<string, TerminalHydrationReason>;
  hydratingTerminalIds: ReadonlySet<string>;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onHydrate: (id: string, options?: { force?: boolean; reason?: "bootstrap" | "reconnect" }) => void;
  onHydrated: (id: string) => void;
  onSetActiveTerminal: (id: string) => void;
  onWrite: (id: string, data: string) => void;
  onGeometryMeasured: (id: string, cols: number, rows: number) => void;
  onKill: (id: string) => void;
  onReconnect?: (id: string) => void;
  dragManager: DragManager;
  onTogglePlacement: () => void;
  monitorMode: boolean;
  onToggleMonitorMode: () => void;
  ref?: Ref<HTMLDivElement>;
  headerActions?: ReactNode;
  overlay?: ReactNode;
  style?: CSSProperties;
}

export function TerminalDock(props: TerminalDockProps) {
  const {
    placement,
    paneId,
    theme,
    compact,
    empty,
    focused,
    sessions,
    activeTerminalId,
    hydrationSnapshots,
    hydrationVersions,
    hydrationReasons,
    hydratingTerminalIds,
    fontSize,
    scrollbackLines,
    onFocus,
    onHydrate,
    onHydrated,
    onSetActiveTerminal,
    onWrite,
    onGeometryMeasured,
    onKill,
    onReconnect,
    dragManager,
    onTogglePlacement,
    monitorMode,
    onToggleMonitorMode,
    ref,
    headerActions,
    overlay,
    style,
  } = props;
  const activeSession = sessions.find((session) => session.id === activeTerminalId) ?? null;
  const canReconnect = Boolean(activeSession && isReconnectableSession(activeSession) && onReconnect);
  const terminalWritable = activeSession ? isTerminalInputEnabled(activeSession) : true;
  const terminalHydrating = Boolean(activeSession && hydratingTerminalIds.has(activeSession.id));
  const inputEnabled = terminalWritable && !terminalHydrating;
  const hydrateRef = useRef(onHydrate);

  useEffect(() => {
    hydrateRef.current = onHydrate;
  }, [onHydrate]);

  useEffect(() => {
    if (activeSession) {
      focusTerminalAfterPaneActivation(activeSession.id);
    }
  }, [activeSession?.id]);

  function focusTerminalAfterPaneActivation(sessionId: string | null) {
    if (!sessionId) {
      return;
    }
    // Pane/tab activation can commit React layout before xterm has measurable
    // dimensions. Focus once after paint and once after the current event loop
    // so first-click terminal input works without forcing a hydration replay.
    window.requestAnimationFrame(() => {
      focusTerminal(sessionId);
      window.setTimeout(() => focusTerminal(sessionId), 0);
    });
  }

  return (
    <section
      className={`terminal-dock terminal-dock--${placement} ${compact ? "terminal-dock--compact" : ""} ${empty ? "terminal-dock--empty" : ""}`}
      data-testid="terminal-dock"
      onMouseDown={() => {
        onFocus();
        focusTerminalAfterPaneActivation(activeTerminalId);
      }}
      style={style}
    >
      <div ref={ref} className="terminal-dock__main">
        <div className="terminal-dock__content">
          <div className="terminal-dock__header">
            <div className="terminal-dock__tabs">
              {sessions.map((session) => (
                <ChromeTab
                  key={session.id}
                  active={session.id === activeTerminalId}
                  className="terminal-tab"
                  testId={`terminal-tab-${session.kind}`}
                  itemId={session.id}
                  dropPaneId={paneId}
                  dropKind="terminal"
                  onClick={() => {
                    onSetActiveTerminal(session.id);
                    focusTerminalAfterPaneActivation(session.id);
                  }}
                  onDoubleClick={() => onTogglePlacement()}
                  onMouseDown={(event) => {
                    dragManager.startDrag(event, {
                      kind: "terminal",
                      sessionId: session.id,
                    });
                  }}
                  title={`${session.title} · ${session.health ?? session.status}${session.healthDetail ? ` · ${session.healthDetail}` : ""}`}
                  leading={<GripVertical size={11} />}
                  trailing={<TerminalTabIcon kind={session.kind} />}
                  closeLabel={`Close ${session.title}`}
                  closeTestId={`close-terminal-${session.kind}`}
                  closeIcon={<X size={12} />}
                  onClose={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                >
                  <span className={`status-dot status-dot--${session.health ?? session.status}`} />
                  {session.title}
                </ChromeTab>
              ))}
            </div>
            {headerActions || canReconnect || onToggleMonitorMode ? (
              <div className="terminal-dock__actions">
                <button
                  type="button"
                  className={`terminal-dock__header-button ${monitorMode ? "terminal-dock__header-button--active" : ""}`}
                  data-testid="terminal-monitor-mode"
                  title={monitorMode ? "Exit monitor mode" : "Monitor all terminals"}
                  aria-pressed={monitorMode}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleMonitorMode();
                  }}
                >
                  <LayoutGrid size={13} />
                </button>
                {canReconnect && activeSession ? (
                  <button
                    type="button"
                    className="terminal-dock__header-button terminal-dock__reconnect"
                    data-testid="terminal-reconnect"
                    title={activeSession.healthDetail ? `Reconnect terminal · ${activeSession.healthDetail}` : "Reconnect terminal"}
                    onClick={() => onReconnect?.(activeSession.id)}
                  >
                    <RefreshCw size={13} />
                    <span>Reconnect</span>
                  </button>
                ) : null}
                {headerActions}
              </div>
            ) : null}
          </div>

          {activeSession ? (
            <div className="terminal-dock__terminal-frame">
              <TerminalView
                key={`${activeSession.id}:${activeSession.attachGeneration}`}
                theme={theme}
                session={activeSession}
                focused={focused}
                hydrationSnapshot={hydrationSnapshots[activeSession.id] ?? ""}
                hydrationVersion={hydrationVersions[activeSession.id] ?? 0}
                hydrationReason={hydrationReasons[activeSession.id] ?? "bootstrap"}
                fontSize={fontSize}
                scrollbackLines={scrollbackLines}
                onFocus={onFocus}
                onInput={onWrite}
                onGeometryMeasured={onGeometryMeasured}
                onReady={(id) => hydrateRef.current(id)}
                onHydrated={onHydrated}
                inputEnabled={inputEnabled}
              />
            </div>
          ) : !empty ? (
            <div className="terminal-dock__empty">No terminals yet.</div>
          ) : null}
        </div>
        {overlay}
      </div>
    </section>
  );
}

function TerminalTabIcon({ kind }: { kind: TerminalSessionInfo["kind"] }) {
  if (kind === "shell") {
    return <SquareTerminal size={12} />;
  }
  if (kind === "claude" || kind === "codex") {
    return <AgentIcon kind={kind} size={12} />;
  }
  return <Bot size={12} />;
}
