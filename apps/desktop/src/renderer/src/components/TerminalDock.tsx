import { Bot, LayoutPanelTop, Plus, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import { TerminalView } from "./TerminalView";

interface TerminalDockProps {
  placement: "right" | "bottom";
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  buffers: Record<string, string>;
  onSetPlacement: (placement: "right" | "bottom") => void;
  onCreateTerminal: (kind: "shell" | "claude" | "codex", cwd?: string) => void;
  onSetActiveTerminal: (id: string) => void;
  onWrite: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onKill: (id: string) => void;
}

export function TerminalDock(props: TerminalDockProps) {
  const {
    placement,
    sessions,
    activeTerminalId,
    buffers,
    onSetPlacement,
    onCreateTerminal,
    onSetActiveTerminal,
    onWrite,
    onResize,
    onKill,
  } = props;

  const activeSession = sessions.find((session) => session.id === activeTerminalId) ?? null;

  return (
    <section className="terminal-dock" data-testid="terminal-dock">
      <div className="terminal-dock__header">
        <div className="terminal-dock__left">
          <div className="terminal-dock__tabs">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`terminal-tab ${session.id === activeTerminalId ? "terminal-tab--active" : ""}`}
                data-testid={`terminal-tab-${session.kind}`}
                onClick={() => onSetActiveTerminal(session.id)}
                type="button"
              >
                <span className={`status-dot status-dot--${session.status}`} />
                {session.title}
                {session.kind === "shell" ? <SquareTerminal size={12} /> : <Bot size={12} />}
                <span
                  className="terminal-tab__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
          {activeSession ? (
            <div className="terminal-dock__meta" data-testid="terminal-meta">
              {activeSession.cwd} · {activeSession.command}
            </div>
          ) : null}
        </div>

        <div className="terminal-dock__actions">
          <button className="toolbar-button toolbar-button--icon" onClick={() => onCreateTerminal("shell")} type="button">
            <Plus size={14} />
          </button>
          <button className="toolbar-button" data-testid="launch-claude" onClick={() => onCreateTerminal("claude")} type="button">
            Claude
          </button>
          <button className="toolbar-button" data-testid="launch-codex" onClick={() => onCreateTerminal("codex")} type="button">
            Codex
          </button>
          <button
            className="toolbar-button toolbar-button--icon"
            data-testid="toggle-terminal-placement"
            onClick={() => onSetPlacement(placement === "right" ? "bottom" : "right")}
            type="button"
          >
            <LayoutPanelTop size={14} />
            {placement === "right" ? "Bottom" : "Right"}
          </button>
        </div>
      </div>

      {activeSession ? (
        <TerminalView
          session={activeSession}
          buffer={buffers[activeSession.id] ?? ""}
          onInput={onWrite}
          onResize={onResize}
        />
      ) : (
        <div className="terminal-dock__empty">No terminals yet.</div>
      )}
    </section>
  );
}
