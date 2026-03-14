import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Send, SquareTerminal } from "lucide-react";
import type { BranchFamily, NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";
import type { TerminalSessionInfo } from "../../../shared/api";

export interface AgentAnnotation {
  runLabel: string;
  role: string;
  task: string;
  parentId: string | null;
}

export interface AgentSteeringMessage {
  id: string;
  toAgentId: string;
  body: string;
  createdAt: string;
}

interface KnowledgeDockProps {
  document: NoteDocument | null;
  knowledge: NoteKnowledge | null;
  branchFamily: BranchFamily | null;
  collapsed: boolean;
  activeTag: string | null;
  tagResults: SearchResult[];
  onToggleCollapsed: () => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalOutputPreviewById: Record<string, string>;
  agentAnnotations: Record<string, AgentAnnotation>;
  agentMessages: AgentSteeringMessage[];
  onFocusAgent: (id: string) => void;
  onUpdateAgentAnnotation: (id: string, patch: Partial<AgentAnnotation>) => void;
  onSendAgentMessage: (targetId: string, body: string) => void;
}

export function KnowledgeDock(props: KnowledgeDockProps) {
  const {
    document,
    knowledge,
    branchFamily,
    collapsed,
    activeTag,
    tagResults,
    onToggleCollapsed,
    onOpenTarget,
    onOpenExternal,
    onOpenTag,
    terminalSessions,
    activeTerminalId,
    terminalOutputPreviewById,
    agentAnnotations,
    agentMessages,
    onFocusAgent,
    onUpdateAgentAnnotation,
    onSendAgentMessage,
  } = props;

  const isMarkdown = document?.kind === "markdown";
  const backlinkCount = isMarkdown ? knowledge?.backlinks.length ?? 0 : 0;
  const linkCount = isMarkdown ? (knowledge?.wikilinks.length ?? 0) + (knowledge?.markdownLinks.length ?? 0) : 0;
  const tagCount = isMarkdown ? knowledge?.tags.length ?? 0 : 0;
  const branchCount = isMarkdown ? branchFamily?.members.length ?? 0 : 0;
  const agentCount = terminalSessions.length;
  const [draftMessage, setDraftMessage] = useState("");

  const steeringTargetId = activeTerminalId ?? terminalSessions[0]?.id ?? null;
  const steeringMessages = steeringTargetId
    ? agentMessages.filter((message) => message.toAgentId === steeringTargetId).slice(-6).reverse()
    : [];

  return (
    <div className={`knowledge-drawer ${collapsed ? "knowledge-drawer--collapsed" : ""}`} data-testid="knowledge-drawer">
      <button className="knowledge-drawer__bar" data-testid="knowledge-toggle" onClick={onToggleCollapsed} type="button">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="knowledge-drawer__label">{isMarkdown ? "Knowledge" : "Inspector"}</span>
        <span className="knowledge-drawer__summary">Backlinks {backlinkCount}</span>
        <span className="knowledge-drawer__summary">Links {linkCount}</span>
        <span className="knowledge-drawer__summary">Tags {tagCount}</span>
        <span className="knowledge-drawer__summary">Branches {branchCount}</span>
        <span className="knowledge-drawer__summary">Agents {agentCount}</span>
      </button>

      {collapsed ? null : (
        <div className="knowledge-panel knowledge-panel--agents">
          <div className="knowledge-panel__section" data-testid="backlinks-panel">
            <div className="knowledge-panel__title">Backlinks</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : knowledge?.backlinks.length ? (
              knowledge.backlinks.map((backlink) => (
                <button
                  key={backlink.filePath}
                  className="knowledge-item"
                  onClick={() => onOpenTarget(backlink.filePath)}
                  type="button"
                >
                  {backlink.title}
                </button>
              ))
            ) : (
              <div className="knowledge-empty">No backlinks</div>
            )}
          </div>

          <div className="knowledge-panel__section">
            <div className="knowledge-panel__title">Links</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : (
              <>
                {knowledge?.wikilinks.map((item) => (
                  <button key={`wiki-${item.target}`} className="knowledge-item" onClick={() => onOpenTarget(item.target)} type="button">
                    [[{item.label}]]
                  </button>
                ))}
                {knowledge?.markdownLinks.map((item) => (
                  <button
                    key={`markdown-${item.target}`}
                    className="knowledge-item"
                    onClick={() => (item.target.startsWith("http") ? onOpenExternal(item.target) : onOpenTarget(item.target))}
                    type="button"
                  >
                    {item.label}
                    {item.target.startsWith("http") ? <ExternalLink size={12} /> : null}
                  </button>
                ))}
                {!knowledge?.wikilinks.length && !knowledge?.markdownLinks.length ? (
                  <div className="knowledge-empty">No links</div>
                ) : null}
              </>
            )}
          </div>

          <div className="knowledge-panel__section" data-testid="tags-panel">
            <div className="knowledge-panel__title">Tags</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : knowledge?.tags.length ? (
              <div className="tag-list">
                {knowledge.tags.map((tag) => (
                  <button key={tag.tag} className="tag-pill" onClick={() => onOpenTag(tag.tag)} type="button">
                    #{tag.tag}
                  </button>
                ))}
              </div>
            ) : (
              <div className="knowledge-empty">No tags</div>
            )}

            {isMarkdown && activeTag ? (
              <div className="tag-results" data-testid="tag-results">
                <div className="knowledge-panel__subtitle">Results for #{activeTag}</div>
                {tagResults.map((result) => (
                  <button key={result.filePath} className="knowledge-item" onClick={() => onOpenTarget(result.filePath)} type="button">
                    {result.title}
                  </button>
                ))}
                {tagResults.length === 0 ? <div className="knowledge-empty">No notes for #{activeTag}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="knowledge-panel__section" data-testid="branches-panel">
            <div className="knowledge-panel__title">Branches</div>
            {!isMarkdown ? (
              <div className="knowledge-empty">No note selected</div>
            ) : branchFamily?.members.length ? (
              <>
                {branchFamily.members.map((member) => (
                  <button
                    key={member.filePath}
                    className={`knowledge-item ${member.filePath === document?.filePath ? "knowledge-item--active" : ""}`}
                    onClick={() => onOpenTarget(member.filePath)}
                    type="button"
                  >
                    <span>{member.isRoot ? member.title : `${member.path.join(".")} · ${member.title}`}</span>
                  </button>
                ))}
                {branchFamily.members.length > 1 ? (
                  <pre className="branch-tree" data-testid="branch-tree">
                    {branchFamily.tree}
                  </pre>
                ) : null}
              </>
            ) : (
              <div className="knowledge-empty">No branch family yet</div>
            )}
          </div>

          <div className="knowledge-panel__section knowledge-panel__section--agents" data-testid="agents-panel">
            <div className="knowledge-panel__title">Agents</div>
            {terminalSessions.length === 0 ? (
              <div className="knowledge-empty">No active agent sessions</div>
            ) : (
              <>
                <div className="agent-list">
                  {terminalSessions.map((session) => {
                    const annotation = agentAnnotations[session.id] ?? {
                      runLabel: "",
                      role: "",
                      task: "",
                      parentId: null,
                    };
                    const preview = terminalOutputPreviewById[session.id] ?? "No activity yet";
                    const selected = session.id === activeTerminalId;

                    return (
                      <div key={session.id} className={`agent-card ${selected ? "agent-card--active" : ""}`}>
                        <button
                          className="agent-card__header"
                          onClick={() => onFocusAgent(session.id)}
                          type="button"
                        >
                          <div className="agent-card__title-row">
                            <SquareTerminal size={13} />
                            <span className="agent-card__title">{session.title}</span>
                            <span className={`status-dot status-dot--${session.status}`} />
                          </div>
                          <div className="agent-card__meta">{session.kind} · {session.cwd}</div>
                        </button>

                        <div className="agent-card__preview" title={preview}>
                          {preview}
                        </div>

                        <div className="agent-card__fields">
                          <label className="agent-card__field">
                            <span>Run</span>
                            <input
                              value={annotation.runLabel}
                              onChange={(event) => onUpdateAgentAnnotation(session.id, { runLabel: event.target.value })}
                            />
                          </label>
                          <label className="agent-card__field">
                            <span>Role</span>
                            <input
                              value={annotation.role}
                              onChange={(event) => onUpdateAgentAnnotation(session.id, { role: event.target.value })}
                            />
                          </label>
                          <label className="agent-card__field">
                            <span>Parent</span>
                            <select
                              value={annotation.parentId ?? ""}
                              onChange={(event) =>
                                onUpdateAgentAnnotation(session.id, { parentId: event.target.value || null })
                              }
                            >
                              <option value="">None</option>
                              {terminalSessions
                                .filter((candidate) => candidate.id !== session.id)
                                .map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.title}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="agent-card__field agent-card__field--wide">
                            <span>Task</span>
                            <input
                              value={annotation.task}
                              onChange={(event) => onUpdateAgentAnnotation(session.id, { task: event.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="agent-steering" data-testid="agent-steering">
                  <div className="knowledge-panel__subtitle">
                    {steeringTargetId
                      ? `Steer ${terminalSessions.find((session) => session.id === steeringTargetId)?.title ?? "agent"}`
                      : "Steering"}
                  </div>
                  <div className="agent-steering__composer">
                    <textarea
                      data-testid="agent-message-input"
                      placeholder="Send a steering message into the selected agent session..."
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                    />
                    <button
                      className="toolbar-button"
                      data-testid="agent-message-send"
                      disabled={!steeringTargetId || !draftMessage.trim()}
                      onClick={() => {
                        if (!steeringTargetId || !draftMessage.trim()) {
                          return;
                        }

                        onSendAgentMessage(steeringTargetId, draftMessage.trim());
                        setDraftMessage("");
                      }}
                      type="button"
                    >
                      <Send size={13} />
                      Send
                    </button>
                  </div>

                  <div className="agent-message-log" data-testid="agent-message-log">
                    {steeringMessages.length ? (
                      steeringMessages.map((message) => (
                        <div key={message.id} className="agent-message-log__item">
                          <div className="agent-message-log__meta">{message.createdAt}</div>
                          <div>{message.body}</div>
                        </div>
                      ))
                    ) : (
                      <div className="knowledge-empty">No steering messages yet</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
