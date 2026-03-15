import { Bot, ChevronDown, ChevronRight } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";

export interface AgentAnnotation {
  runLabel: string;
  parentId: string | null;
}

interface SubagentDockProps {
  collapsed: boolean;
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalOutputPreviewById: Record<string, string>;
  agentAnnotations: Record<string, AgentAnnotation>;
  onToggleCollapsed: () => void;
  onFocusAgent: (id: string) => void;
  onKickOffRun: () => void;
  onSpawnAgent: (kind: "claude" | "codex") => void;
}

export function SubagentDock(props: SubagentDockProps) {
  const {
    collapsed,
    terminalSessions,
    activeTerminalId,
    terminalOutputPreviewById,
    agentAnnotations,
    onToggleCollapsed,
    onFocusAgent,
    onKickOffRun,
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

  return (
    <div className={`footer-dock footer-dock--subagents ${collapsed ? "footer-dock--collapsed" : ""}`} data-testid="subagent-dock">
      <button className="footer-dock__bar" data-testid="subagents-toggle" onClick={onToggleCollapsed} type="button">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="footer-dock__label">Subagents</span>
        <span className="footer-dock__summary">{subagentSessions.length} sessions</span>
      </button>

      {collapsed ? null : (
        <div className="footer-panel footer-panel--subagents" data-testid="subagents-panel">
          <div className="footer-panel__section footer-panel__section--subagents">
            <div className="footer-panel__section-header">
              <div>
                <div className="footer-panel__title">Observed Sessions</div>
                <div className="footer-panel__subtitle">
                  {activeMainAgent ? activeMainAgent.title : "Select a main terminal above"}
                </div>
              </div>
              <div className="footer-panel__actions">
                <button className="toolbar-button toolbar-button--compact" data-testid="kickoff-run" onClick={onKickOffRun} type="button">
                  Kick Off Run
                </button>
                <button className="toolbar-button toolbar-button--compact" data-testid="spawn-claude-agent" onClick={() => onSpawnAgent("claude")} type="button">
                  Claude
                </button>
                <button className="toolbar-button toolbar-button--compact" data-testid="spawn-codex-agent" onClick={() => onSpawnAgent("codex")} type="button">
                  Codex
                </button>
              </div>
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
              <div className="footer-empty">
                {activeMainAgent ? "No observed subagent terminals yet" : "No main terminal selected"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
