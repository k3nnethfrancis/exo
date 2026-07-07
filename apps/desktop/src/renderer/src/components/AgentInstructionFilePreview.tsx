import type { AgentInstructionProviderFile, AgentInstructionProviderId, AgentInstructionScope, AgentInstructionScopeId } from "../../../shared/api";
import { agentInstructionStatusLabel } from "../hooks/useAgentInstructionEditor";

const PROVIDER_ORDER: AgentInstructionProviderId[] = ["agents", "claude"];

interface AgentInstructionFilePreviewProps {
  scopes: AgentInstructionScope[];
  selectedProviderId: AgentInstructionProviderId;
  selectedScopeId: AgentInstructionScopeId;
  onSelectProvider: (providerId: AgentInstructionProviderId) => void;
  onSelectScope: (scopeId: AgentInstructionScopeId) => void;
}

export function AgentInstructionFilePreview({
  scopes,
  selectedProviderId,
  selectedScopeId,
  onSelectProvider,
  onSelectScope,
}: AgentInstructionFilePreviewProps) {
  const selectedScope = scopes.find((scope) => scope.id === selectedScopeId) ?? scopes[0] ?? null;
  const selectedFile = selectedScope?.files[selectedProviderId] ?? selectedScope?.files.agents ?? null;

  if (!selectedScope || !selectedFile) {
    return (
      <div className="dialog-card__status dialog-card__status--warning" data-testid="agent-instruction-file-preview-empty">
        No instruction files are available for this workspace.
      </div>
    );
  }

  return (
    <div className="agent-instruction-preview" data-testid="agent-instruction-file-preview">
      {scopes.length > 1 ? (
        <div className="agent-config-editor__scope">
          <span className="dialog-field__label">Scope</span>
          <div className="agent-config-editor__scope-buttons" role="group" aria-label="Agent instruction preview scope">
            {scopes.map((scope) => (
              <button
                className={`agent-config-editor__scope-button ${scope.id === selectedScope.id ? "agent-config-editor__scope-button--active" : ""}`}
                data-testid={`agent-instruction-preview-scope-${scope.id}`}
                key={scope.id}
                onClick={() => onSelectScope(scope.id)}
                type="button"
              >
                <strong>{scope.label}</strong>
                <small>{scope.description}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="agent-config-editor__status">
        <div>
          <span className="dialog-field__label">{agentInstructionStatusLabel(selectedScope)}</span>
          <div className="agent-config-editor__path">{selectedScope.rootPath}</div>
        </div>
        <div className="agent-config-editor__files">
          {PROVIDER_ORDER.map((providerId) => (
            <button
              className={`agent-instruction-preview__file-button ${providerId === selectedFile.id ? "agent-instruction-preview__file-button--active" : ""}`}
              data-testid={`agent-instruction-preview-file-${providerId}`}
              key={providerId}
              onClick={() => onSelectProvider(providerId)}
              type="button"
            >
              <strong>{selectedScope.files[providerId].label}</strong>
              <span>{providerFileStatusLabel(selectedScope.files[providerId])}</span>
              <small>{selectedScope.files[providerId].path}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="agent-instruction-preview__body">
        <div className="agent-instruction-preview__body-header">
          <span className="dialog-field__label">{selectedFile.label}</span>
          <span>{providerFileStatusLabel(selectedFile)}</span>
        </div>
        <pre data-testid="agent-instruction-preview-body">{providerFileBody(selectedFile)}</pre>
      </div>
    </div>
  );
}

function providerFileStatusLabel(file: AgentInstructionProviderFile): string {
  if (file.errorMessage) {
    return "Error";
  }
  if (!file.exists) {
    return "Missing";
  }
  if (!file.body.trim()) {
    return "Empty";
  }
  return "Existing";
}

function providerFileBody(file: AgentInstructionProviderFile): string {
  if (file.errorMessage) {
    return file.errorMessage;
  }
  if (!file.exists) {
    return "File is missing. Agent Config can create it from aligned instruction content.";
  }
  if (!file.body.trim()) {
    return "File exists but is empty.";
  }
  return file.body;
}
