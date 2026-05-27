import type { CSSProperties, ReactNode, Ref } from "react";
import { GripVertical, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ResolvedAppearance } from "../App";
import type { DragManager } from "../hooks/useDragManager";
import { AgentIcon } from "./AgentIcon";
import { ChromeTab } from "./Chrome";
import { TerminalView } from "./TerminalView";

interface TerminalDockProps {
  placement: "right" | "bottom";
  paneId: string;
  appearance: ResolvedAppearance;
  compact: boolean;
  empty: boolean;
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  buffers: Record<string, string>;
  bufferVersions: Record<string, number>;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onSetActiveTerminal: (id: string) => void;
  onWrite: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onKill: (id: string) => void;
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
    appearance,
    compact,
    empty,
    sessions,
    activeTerminalId,
    buffers,
    bufferVersions,
    fontSize,
    scrollbackLines,
    onFocus,
    onSetActiveTerminal,
    onWrite,
    onResize,
    onKill,
    dragManager,
    onTogglePlacement,
    ref,
    headerActions,
    overlay,
    style,
  } = props;
  const activeSession = sessions.find((session) => session.id === activeTerminalId) ?? null;

  return (
    <section
      className={`terminal-dock terminal-dock--${placement} ${compact ? "terminal-dock--compact" : ""} ${empty ? "terminal-dock--empty" : ""}`}
      data-testid="terminal-dock"
      onMouseDown={onFocus}
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
                  onClick={() => onSetActiveTerminal(session.id)}
                  onDoubleClick={() => onTogglePlacement()}
                  onMouseDown={(event) => {
                    dragManager.startDrag(event, {
                      kind: "terminal",
                      sessionId: session.id,
                    });
                  }}
                  title={placement === "right" ? "Drag to bottom or double-click to dock bottom" : "Drag to right or double-click to dock right"}
                  leading={<GripVertical size={11} />}
                  trailing={session.kind === "shell" ? <SquareTerminal size={12} /> : <AgentIcon kind={session.kind} size={12} />}
                  closeLabel={`Close ${session.title}`}
                  closeTestId={`close-terminal-${session.kind}`}
                  closeIcon={<X size={12} />}
                  onClose={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                >
                  <span className={`status-dot status-dot--${session.status}`} />
                  {session.title}
                </ChromeTab>
              ))}
            </div>
            {headerActions ? <div className="terminal-dock__actions">{headerActions}</div> : null}
          </div>

          {activeSession ? (
            <TerminalView
              appearance={appearance}
              session={activeSession}
              buffer={buffers[activeSession.id] ?? ""}
              bufferVersion={bufferVersions[activeSession.id] ?? 0}
              fontSize={fontSize}
              scrollbackLines={scrollbackLines}
              onFocus={onFocus}
              onInput={onWrite}
              onResize={onResize}
            />
          ) : !empty ? (
            <div className="terminal-dock__empty">No terminals yet.</div>
          ) : null}
        </div>
        {overlay}
      </div>
    </section>
  );
}
