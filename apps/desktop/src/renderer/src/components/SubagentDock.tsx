import type { RefObject } from "react";
import { Bot } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import { SnapDrawer } from "./SnapDrawer";

export interface AgentAnnotation {
  runLabel: string;
  parentId: string | null;
}

interface SubagentDockProps {
  collapsed: boolean;
  containerRef: RefObject<HTMLElement | null>;
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalOutputPreviewById: Record<string, string>;
  agentAnnotations: Record<string, AgentAnnotation>;
  onHeightChange?: (height: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onFocusAgent: (id: string) => void;
  onSpawnAgent: (kind: "claude" | "codex") => void;
}

export function SubagentDock(props: SubagentDockProps) {
  const {
    collapsed,
    containerRef,
    terminalSessions,
    activeTerminalId,
    terminalOutputPreviewById,
    agentAnnotations,
    onHeightChange,
    onCollapsedChange,
    onFocusAgent,
    onSpawnAgent,
  } = props;

  const activeSession = terminalSessions.find((session) => session.id === activeTerminalId) ?? terminalSessions[0] ?? null;
  const activeMainAgent =
    activeSession && agentAnnotations[activeSession.id]?.parentId
      ? terminalSessions.find((session) => session.id === agentAnnotations[activeSession.id]?.parentId) ?? activeSession
      : activeSession;
  const subagentSessions = activeMainAgent
    ? terminalSessions.filter((session) => agentAnnotations[session.id]?.parentId === activeMainAgent.id)
    : [];
  const showSpawnActions = subagentSessions.length > 0 && Boolean(activeMainAgent);

  return (
    <SnapDrawer
      className="footer-dock footer-dock--subagents"
      collapsed={collapsed}
      label="Subagents"
      summary={`${subagentSessions.length} sessions`}
      containerRef={containerRef}
      defaultOpenFraction={0.5}
      toggleTestId="subagents-toggle"
      panelTestId="subagents-panel"
      resizerTestId="subagents-resizer"
      onHeightChange={onHeightChange}
      onCollapsedChange={onCollapsedChange}
    >
      <div className="footer-panel footer-panel--subagents">
        <div className="footer-panel__section footer-panel__section--subagents">
          <div className="footer-panel__section-header">
            <div>
              <div className="footer-panel__title">Observed Sessions</div>
              {showSpawnActions ? <div className="footer-panel__subtitle">{activeMainAgent?.title}</div> : null}
            </div>
            {showSpawnActions ? (
              <div className="footer-panel__actions">
                <button className="toolbar-button toolbar-button--compact" data-testid="spawn-claude-agent" onClick={() => onSpawnAgent("claude")} type="button">
                  Claude
                </button>
                <button className="toolbar-button toolbar-button--compact" data-testid="spawn-codex-agent" onClick={() => onSpawnAgent("codex")} type="button">
                  Codex
                </button>
              </div>
            ) : null}
          </div>

          {subagentSessions.length ? (
            <div className="subagent-list">
              {subagentSessions.map((session) => {
                const preview = terminalOutputPreviewById[session.id] ?? "No activity yet";
                return (
                  <button
                    key={session.id}
                    className={`subagent-card ${session.id === activeTerminalId ? "subagent-card--active" : ""}`}
                    data-testid={`subagent-card-${session.id}`}
                    onClick={() => onFocusAgent(session.id)}
                    type="button"
                  >
                    <div className="subagent-card__title-row">
                      <div className="subagent-card__title">
                        <Bot size={13} />
                        {session.title}
                      </div>
                      <span className={`status-dot status-dot--${session.status}`} />
                    </div>
                    <div className="subagent-card__meta">{session.cwd}</div>
                    <div className="subagent-card__preview" title={preview}>
                      {preview}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="footer-empty">No observed subagent terminals yet</div>
          )}
        </div>
      </div>
    </SnapDrawer>
  );
}
