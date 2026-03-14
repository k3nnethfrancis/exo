import { ChevronDown, ChevronRight, ExternalLink, Bot } from "lucide-react";
import type { NoteDocument, NoteKnowledge, SearchResult } from "@exo/core";
import type { TerminalSessionInfo } from "../../../shared/api";

export interface AgentAnnotation {
  runLabel: string;
  parentId: string | null;
}

interface KnowledgeDockProps {
  document: NoteDocument | null;
  knowledge: NoteKnowledge | null;
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
  onFocusAgent: (id: string) => void;
  onKickOffRun: () => void;
  onSpawnAgent: (kind: "claude" | "codex") => void;
}

export function KnowledgeDock(props: KnowledgeDockProps) {
  const {
    document,
    knowledge,
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
    onFocusAgent,
    onKickOffRun,
    onSpawnAgent,
  } = props;

  const isMarkdown = document?.kind === "markdown";
  const backlinkCount = isMarkdown ? knowledge?.backlinks.length ?? 0 : 0;
  const linkCount = isMarkdown ? (knowledge?.wikilinks.length ?? 0) + (knowledge?.markdownLinks.length ?? 0) : 0;
  const tagCount = isMarkdown ? knowledge?.tags.length ?? 0 : 0;
  const activeSession = terminalSessions.find((session) => session.id === activeTerminalId) ?? terminalSessions[0] ?? null;
  const activeMainAgent =
    activeSession && agentAnnotations[activeSession.id]?.parentId
      ? terminalSessions.find((session) => session.id === agentAnnotations[activeSession.id]?.parentId) ?? activeSession
      : activeSession;
  const subagentSessions = activeMainAgent
    ? terminalSessions.filter((session) => agentAnnotations[session.id]?.parentId === activeMainAgent.id)
    : [];
  const subagentCount = subagentSessions.length;

  return (
    <div className={`knowledge-drawer ${collapsed ? "knowledge-drawer--collapsed" : ""}`} data-testid="knowledge-drawer">
      <button className="knowledge-drawer__bar" data-testid="knowledge-toggle" onClick={onToggleCollapsed} type="button">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="knowledge-drawer__label">Inspector</span>
        <span className="knowledge-drawer__summary">Backlinks {backlinkCount}</span>
        <span className="knowledge-drawer__summary">Links {linkCount}</span>
        <span className="knowledge-drawer__summary">Tags {tagCount}</span>
        <span className="knowledge-drawer__summary">Subagents {subagentCount}</span>
      </button>

      {collapsed ? null : (
        <div className="knowledge-panel knowledge-panel--subagents">
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

          <div className="knowledge-panel__section knowledge-panel__section--subagents" data-testid="subagents-panel">
            <div className="knowledge-panel__section-header">
              <div>
                <div className="knowledge-panel__title">Subagents</div>
                <div className="knowledge-panel__subtitle">
                  {activeMainAgent ? activeMainAgent.title : "Select a main terminal above"}
                </div>
              </div>
              <div className="knowledge-panel__actions">
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
              <div className="knowledge-empty">
                {activeMainAgent ? "No observed subagent terminals yet" : "No main terminal selected"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
