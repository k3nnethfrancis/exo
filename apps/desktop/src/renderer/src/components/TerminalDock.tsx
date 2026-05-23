import type { CSSProperties, ReactNode, Ref } from "react";
import { FileDiff, GripVertical, SquareTerminal, X } from "lucide-react";

import type { TerminalSessionInfo, WorkspaceGitChange } from "../../../shared/api";
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
  sessionChanges?: TerminalSessionChange[];
  buffers: Record<string, string>;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onSetActiveTerminal: (id: string) => void;
  onOpenChangedFile?: (filePath: string, line?: number | null) => void;
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

interface TerminalSessionChange extends WorkspaceGitChange {
  rootPath: string;
  rootLabel: string;
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
    sessionChanges = [],
    buffers,
    fontSize,
    scrollbackLines,
    onFocus,
    onSetActiveTerminal,
    onOpenChangedFile,
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
  const visibleSessionChanges = activeSession ? sessionChanges.slice(0, 4) : [];

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

          {activeSession && visibleSessionChanges.length > 0 && onOpenChangedFile ? (
            <div className="terminal-review-strip" data-testid={`terminal-session-changes-${activeSession.id}`}>
              <div className="terminal-review-strip__label">
                <FileDiff size={13} />
                Changed files
              </div>
              <div className="terminal-review-strip__items">
                {visibleSessionChanges.map((change) => (
                  <button
                    className="terminal-review-strip__item"
                    key={`${change.rootPath}:${change.path}:${change.status}`}
                    onClick={() => onOpenChangedFile(change.absolutePath, change.firstChangedLine)}
                    title={`${change.status} ${change.absolutePath}`}
                    type="button"
                  >
                    <span className="terminal-review-strip__status">{change.status}</span>
                    <span className="terminal-review-strip__path">{change.path}</span>
                    {change.firstChangedLine ? <span className="terminal-review-strip__line">:{change.firstChangedLine}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeSession ? (
            <TerminalView
              appearance={appearance}
              session={activeSession}
              buffer={buffers[activeSession.id] ?? ""}
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
