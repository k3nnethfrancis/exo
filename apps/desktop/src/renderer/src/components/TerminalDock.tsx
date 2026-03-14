import { Bot, GripVertical, Plus, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import { TerminalView } from "./TerminalView";

interface TerminalDockProps {
  placement: "right" | "bottom";
  compact: boolean;
  collapsed: boolean;
  sessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  buffers: Record<string, string>;
  onCreateTerminal: (kind: "shell" | "claude" | "codex", cwd?: string) => void;
  onSetActiveTerminal: (id: string) => void;
  onWrite: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onKill: (id: string) => void;
  onStartDockDrag: () => void;
  onEndDockDrag: () => void;
  onTogglePlacement: () => void;
}

export function TerminalDock(props: TerminalDockProps) {
  const {
    placement,
    compact,
    collapsed,
    sessions,
    activeTerminalId,
    buffers,
    onCreateTerminal,
    onSetActiveTerminal,
    onWrite,
    onResize,
    onKill,
    onStartDockDrag,
    onEndDockDrag,
    onTogglePlacement,
  } = props;
  const activeSession = sessions.find((session) => session.id === activeTerminalId) ?? null;

  return (
    <section
      className={`terminal-dock terminal-dock--${placement} ${collapsed ? "terminal-dock--collapsed" : ""}`}
      data-testid="terminal-dock"
    >
      <div className="terminal-dock__header">
        {collapsed ? (
          <div className="terminal-dock__collapsed-label">
            <SquareTerminal size={13} />
            <span className="terminal-dock__collapsed-title">Terminal</span>
            <span className="terminal-dock__collapsed-summary">0 sessions</span>
          </div>
        ) : (
          <div className="terminal-dock__tabs">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`terminal-tab ${session.id === activeTerminalId ? "terminal-tab--active" : ""}`}
                data-testid={`terminal-tab-${session.kind}`}
                draggable
                onClick={() => onSetActiveTerminal(session.id)}
                onDoubleClick={() => onTogglePlacement()}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-exo-dock", session.id);
                  onStartDockDrag();
                }}
                onDragEnd={() => onEndDockDrag()}
                title={placement === "right" ? "Drag to bottom or double-click to dock bottom" : "Drag to right or double-click to dock right"}
                type="button"
              >
                <GripVertical size={12} />
                <span className={`status-dot status-dot--${session.status}`} />
                {session.title}
                {session.kind === "shell" ? <SquareTerminal size={12} /> : <Bot size={12} />}
                <span
                  aria-label={`Close ${session.title}`}
                  className="terminal-tab__close"
                  data-testid={`close-terminal-${session.kind}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onKill(session.id);
                  }}
                  role="button"
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="terminal-dock__actions">
          <button
            className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
            onClick={() => onCreateTerminal("shell")}
            title="New terminal"
            type="button"
          >
            <Plus size={14} />
          </button>
          <button
            className={`toolbar-button ${compact ? "toolbar-button--compact" : ""}`}
            data-testid="launch-claude"
            onClick={() => onCreateTerminal("claude")}
            title="Launch Claude"
            type="button"
          >
            <Bot size={14} />
            {compact ? null : "Claude"}
          </button>
          <button
            className={`toolbar-button ${compact ? "toolbar-button--compact" : ""}`}
            data-testid="launch-codex"
            onClick={() => onCreateTerminal("codex")}
            title="Launch Codex"
            type="button"
          >
            <Bot size={14} />
            {compact ? null : "Codex"}
          </button>
        </div>
      </div>

      {!collapsed && activeSession ? (
        <TerminalView
          session={activeSession}
          buffer={buffers[activeSession.id] ?? ""}
          onInput={onWrite}
          onResize={onResize}
        />
      ) : !collapsed ? (
        <div className="terminal-dock__empty">No terminals yet.</div>
      ) : null}
    </section>
  );
}
