import { X } from "lucide-react";

import { agentInstructionStatusLabel, type useAgentInstructionEditor } from "../hooks/useAgentInstructionEditor";

type AgentInstructionEditor = ReturnType<typeof useAgentInstructionEditor>;

interface AgentConfigEditorDialogProps {
  editor: AgentInstructionEditor;
  onClose: () => void;
}

export function AgentConfigEditorDialog({ editor, onClose }: AgentConfigEditorDialogProps) {
  const { state, selectedScope, partialErrors } = editor;

  return (
    <div className="dialog-overlay" data-testid="agent-context-manager-overlay">
      <div className="dialog-card dialog-card--agent-context-manager" data-testid="agent-context-manager">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Agent Config Editor</div>
            <div className="dialog-card__message">Edit the shared instructions Exo keeps aligned for Codex and Claude.</div>
          </div>
          <button
            aria-label="Close agent config editor"
            className="dialog-card__close"
            data-testid="agent-context-manager-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {partialErrors.length > 0 ? (
          <div className="dialog-card__status dialog-card__status--error" data-testid="agent-context-manager-partial-errors">
            <div>Some agent instruction data could not be loaded.</div>
            {partialErrors.slice(0, 3).map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        ) : null}

        <div className="agent-config-editor" data-testid="agent-context-manager-body">
          <div className="agent-config-editor__scope" data-testid="agent-context-scope-controls">
            <span className="dialog-field__label">Scope</span>
            <div className="agent-config-editor__scope-buttons" role="group" aria-label="Agent instruction scope">
              {state.config?.scopes.map((scope) => (
                <button
                  className={`agent-config-editor__scope-button ${scope.id === selectedScope?.id ? "agent-config-editor__scope-button--active" : ""}`}
                  data-testid={`agent-context-scope-${scope.id}`}
                  key={scope.id}
                  onClick={() => editor.selectScope(scope.id)}
                  type="button"
                >
                  <strong>{scope.label}</strong>
                  <small>{scope.description}</small>
                </button>
              ))}
            </div>
          </div>

          {selectedScope ? (
            <>
              <div className="agent-config-editor__status" data-testid="agent-config-status">
                <div>
                  <span className="dialog-field__label">{agentInstructionStatusLabel(selectedScope)}</span>
                  <div className="agent-config-editor__path">{selectedScope.rootPath}</div>
                </div>
                <div className="agent-config-editor__files">
                  <div>
                    <strong>AGENTS.md</strong>
                    <span>{selectedScope.files.agents.exists ? "Existing" : "Missing"}</span>
                    <small>{selectedScope.files.agents.path}</small>
                  </div>
                  <div>
                    <strong>CLAUDE.md</strong>
                    <span>{selectedScope.files.claude.exists ? "Existing" : "Missing"}</span>
                    <small>{selectedScope.files.claude.path}</small>
                  </div>
                </div>
              </div>

              {selectedScope.status === "different" ? (
                <div className="dialog-card__status dialog-card__status--warning" data-testid="agent-config-divergence">
                  <div>AGENTS.md and CLAUDE.md are different. Choose a source, or edit the text below before saving both files.</div>
                  <div className="dialog-card__actions dialog-card__actions--split">
                    <button className="toolbar-button" data-testid="agent-config-use-agents" onClick={() => editor.useProviderSource("agents")} type="button">
                      Use AGENTS.md
                    </button>
                    <button className="toolbar-button" data-testid="agent-config-use-claude" onClick={() => editor.useProviderSource("claude")} type="button">
                      Use CLAUDE.md
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedScope.status === "missing-agents" || selectedScope.status === "missing-claude" ? (
                <div className="dialog-card__status" data-testid="agent-config-missing">
                  Saving will create the missing provider file from the editor content.
                </div>
              ) : null}

              <label className="dialog-field agent-config-editor__editor-field">
                <span className="dialog-field__label">Agent instructions</span>
                <textarea
                  className="dialog-card__input agent-config-editor__textarea"
                  data-testid="agent-context-unified-editor"
                  spellCheck={false}
                  value={state.draftBody}
                  onChange={(event) => editor.updateDraftBody(event.target.value)}
                />
              </label>

              <div className="dialog-card__actions dialog-card__actions--split">
                <button
                  className="toolbar-button"
                  data-testid="agent-config-load-template"
                  onClick={editor.loadTemplate}
                  type="button"
                >
                  Load Exo starter template
                </button>
                <button
                  className="toolbar-button"
                  data-testid="agent-context-save-unified"
                  disabled={state.saveStatus === "saving" || selectedScope.status === "error"}
                  onClick={() => void editor.save()}
                  type="button"
                >
                  {state.saveStatus === "saving" ? "Saving..." : "Save both files"}
                </button>
              </div>

              {state.saveStatus === "saved" ? (
                <div className="dialog-card__status" data-testid="agent-context-unified-status">AGENTS.md and CLAUDE.md are aligned.</div>
              ) : null}
              {state.saveStatus === "error" && state.errorMessage ? (
                <div className="dialog-card__status dialog-card__status--error">{state.errorMessage}</div>
              ) : null}
            </>
          ) : (
            <div className="dialog-card__status dialog-card__status--error">No agent instruction scope is available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
