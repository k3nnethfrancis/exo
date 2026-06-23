import { useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import { Bot, GripVertical, RefreshCw, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { DragManager } from "../hooks/useDragManager";
import { isReconnectableSession, isTerminalInputEnabled } from "../terminalSessions";
import type { ExoThemeVariant } from "../theme/types";
import { AgentIcon } from "./AgentIcon";
import { ChromeTab } from "./Chrome";
import { focusTerminal } from "./terminalRegistry";
import { TerminalView } from "./TerminalView";

interface TerminalDockProps {
  placement: "right" | "bottom";
  paneId: string;
  theme: ExoThemeVariant;
  compact: boolean;
  empty: boolean;
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  hydrationSnapshots: Record<string, string>;
  hydrationVersions: Record<string, number>;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onHydrate: (id: string, options?: { force?: boolean }) => void;
  onSetActiveTerminal: (id: string) => void;
  onWrite: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onKill: (id: string) => void;
  onReconnect?: (id: string) => void;
  dragManager: DragManager;
  onTogglePlacement: () => void;
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
    sessions,
    activeTerminalId,
    hydrationSnapshots,
    hydrationVersions,
    fontSize,
    scrollbackLines,
    onFocus,
    onHydrate,
    onSetActiveTerminal,
    onWrite,
    onResize,
    onKill,
    onReconnect,
    dragManager,
    onTogglePlacement,
    ref,
    headerActions,
    overlay,
    style,
  } = props;
  const activeSession = sessions.find((session) => session.id === activeTerminalId) ?? null;
  const canReconnect = Boolean(activeSession && isReconnectableSession(activeSession) && onReconnect);
  const inputEnabled = activeSession ? isTerminalInputEnabled(activeSession) : true;
  const hydrateRef = useRef(onHydrate);

  useEffect(() => {
    hydrateRef.current = onHydrate;
  }, [onHydrate]);

  useEffect(() => {
    if (activeSession) {
      hydrateRef.current(activeSession.id);
    }
  }, [activeSession?.id]);

  function focusTerminalAfterPaneActivation(sessionId: string | null) {
    if (!sessionId) {
      return;
    }
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
            {headerActions || canReconnect ? (
              <div className="terminal-dock__actions">
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
                theme={theme}
                session={activeSession}
                hydrationSnapshot={hydrationSnapshots[activeSession.id] ?? ""}
                hydrationVersion={hydrationVersions[activeSession.id] ?? 0}
                fontSize={fontSize}
                scrollbackLines={scrollbackLines}
                onFocus={onFocus}
                onInput={onWrite}
                onResize={onResize}
                inputEnabled={inputEnabled}
              />
              {!inputEnabled ? (
                <div className="terminal-dock__health-overlay" data-testid="terminal-health-overlay">
                  <div className="terminal-dock__health-title">{activeSession.status === "exited" ? "Terminal exited" : "Terminal unavailable"}</div>
                  <div className="terminal-dock__health-detail">{activeSession.healthDetail ?? "Reconnect or inspect terminal diagnostics."}</div>
                  {canReconnect ? (
                    <button
                      type="button"
                      className="terminal-dock__header-button terminal-dock__reconnect"
                      data-testid="terminal-overlay-reconnect"
                      onClick={() => onReconnect?.(activeSession.id)}
                    >
                      <RefreshCw size={13} />
                      <span>Reconnect</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
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
