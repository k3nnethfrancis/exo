import type { RefObject } from "react";
import { Bot, Orbit } from "lucide-react";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ObservedAgent } from "../App";
import { SnapDrawer } from "./SnapDrawer";

export interface AgentAnnotation {
  runLabel: string;
  parentId: string | null;
}

interface SubagentDockProps {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalOutputPreviewById: Record<string, string>;
  agentAnnotations: Record<string, AgentAnnotation>;
  observedAgents: ObservedAgent[];
  onToggle: () => void;
  onFocusAgent: (id: string) => void;
}

export function SubagentDock(props: SubagentDockProps) {
  const {
    open,
    containerRef,
    terminalSessions,
    activeTerminalId,
    terminalOutputPreviewById,
    agentAnnotations,
    observedAgents,
    onToggle,
    onFocusAgent,
  } = props;

  const activeSession = terminalSessions.find((session) => session.id === activeTerminalId) ?? terminalSessions[0] ?? null;
  const activeMainAgent =
    activeSession && agentAnnotations[activeSession.id]?.parentId
      ? terminalSessions.find((session) => session.id === agentAnnotations[activeSession.id]?.parentId) ?? activeSession
      : activeSession;
  const subagentSessions = activeMainAgent
    ? terminalSessions.filter((session) => agentAnnotations[session.id]?.parentId === activeMainAgent.id)
    : [];

  const totalCount = observedAgents.length + subagentSessions.length;

  return (
    <SnapDrawer
      className="subagent-snap-drawer"
      collapsed={!open}
      label="Subagents"
      icon={<Orbit size={12} />}
      summary={<span>{totalCount}</span>}
      containerRef={containerRef}
      defaultOpenFraction={0.4}
      minHeight={80}
      minRemaining={120}
      toggleTestId="subagents-toggle"
      panelTestId="subagents-panel"
      onCollapsedChange={(collapsed) => {
        if (collapsed !== !open) onToggle();
      }}
    >
      {observedAgents.length > 0 ? (
        <div className="subagent-drawer__section">
          <div className="subagent-drawer__section-title">Observed Agents</div>
          <div className="subagent-drawer__list">
            {observedAgents.map((agent, i) => (
              <div key={`${agent.name}-${i}`} className={`subagent-card subagent-card--observed ${agent.status === "done" ? "subagent-card--done" : ""}`}>
                <div className="subagent-card__title-row">
                  <div className="subagent-card__title">
                    <Bot size={12} />
                    <span className="subagent-card__name">{agent.name}</span>
                  </div>
                  <span className={`status-dot status-dot--${agent.status === "done" ? "exited" : "running"}`} />
                </div>
                <div className="subagent-card__desc">{agent.description}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {subagentSessions.length > 0 ? (
        <div className="subagent-drawer__section">
          <div className="subagent-drawer__section-title">Terminal Sessions</div>
          <div className="subagent-drawer__list">
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
                      <Bot size={12} />
                      <span className="subagent-card__name">{session.title}</span>
                    </div>
                    <span className={`status-dot status-dot--${session.status}`} />
                  </div>
                  <div className="subagent-card__desc">{preview}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {totalCount === 0 ? (
        <div className="subagent-drawer__empty">No observed subagent terminals yet</div>
      ) : null}
    </SnapDrawer>
  );
}
