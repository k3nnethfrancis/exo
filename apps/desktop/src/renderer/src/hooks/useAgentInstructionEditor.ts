import { useMemo, useState } from "react";

import type { AgentInstructionConfig, AgentInstructionProviderId, AgentInstructionScope, AgentInstructionScopeId } from "../../../shared/api";

export interface AgentInstructionEditorState {
  config: AgentInstructionConfig | null;
  selectedScopeId: AgentInstructionScopeId;
  draftBody: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  errorMessage: string | null;
}

const initialState: AgentInstructionEditorState = {
  config: null,
  selectedScopeId: "global",
  draftBody: "",
  saveStatus: "idle",
  errorMessage: null,
};

export function useAgentInstructionEditor() {
  const [state, setState] = useState<AgentInstructionEditorState>(initialState);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const selectedScope = state.config?.scopes.find((scope) => scope.id === state.selectedScopeId)
    ?? state.config?.scopes[0]
    ?? null;

  const partialErrors = useMemo(
    () =>
      uniqueMessages([
        ...loadErrors,
        ...(selectedScope?.errorMessages ?? []),
      ]),
    [loadErrors, selectedScope],
  );

  async function load(): Promise<string[]> {
    try {
      const config = await window.exo.workspace.getAgentInstructionConfig();
      setState((current) => {
        const nextScope = config.scopes.find((scope) => scope.id === current.selectedScopeId) ?? config.scopes[0] ?? null;
        return {
          ...current,
          config,
          selectedScopeId: nextScope?.id ?? "global",
          draftBody: nextScope ? editableAgentInstructionBody(nextScope) : "",
          saveStatus: "idle",
          errorMessage: null,
        };
      });
      const nextErrors = uniqueMessages(config.scopes.flatMap((scope) => scope.errorMessages));
      setLoadErrors(nextErrors);
      return nextErrors;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextErrors = [`agent instructions: ${message}`];
      setState((current) => ({
        ...current,
        config: null,
        draftBody: "",
        saveStatus: "error",
        errorMessage: message,
      }));
      setLoadErrors(nextErrors);
      return nextErrors;
    }
  }

  function resetLoadErrors() {
    setLoadErrors([]);
  }

  function selectScope(scopeId: AgentInstructionScopeId) {
    setState((current) => {
      const scope = current.config?.scopes.find((entry) => entry.id === scopeId);
      return scope
        ? {
            ...current,
            selectedScopeId: scope.id,
            draftBody: editableAgentInstructionBody(scope),
            saveStatus: "idle",
            errorMessage: null,
          }
        : current;
    });
  }

  function useProviderSource(providerId: AgentInstructionProviderId) {
    setState((current) => {
      const scope = current.config?.scopes.find((entry) => entry.id === current.selectedScopeId);
      const file = scope?.files[providerId];
      return file
        ? {
            ...current,
            draftBody: file.body,
            saveStatus: "idle",
            errorMessage: null,
          }
        : current;
    });
  }

  function loadTemplate() {
    setState((current) => ({
      ...current,
      draftBody: current.config?.starterTemplate ?? "",
      saveStatus: "idle",
      errorMessage: null,
    }));
  }

  function updateDraftBody(draftBody: string) {
    setState((current) => ({
      ...current,
      draftBody,
      saveStatus: "idle",
      errorMessage: null,
    }));
  }

  async function save() {
    const snapshot = state;
    if (!snapshot.config?.scopes.some((scope) => scope.id === snapshot.selectedScopeId)) {
      return;
    }
    setState((current) => ({ ...current, saveStatus: "saving", errorMessage: null }));
    try {
      const config = await window.exo.workspace.saveAgentInstructionConfig({
        scopeId: snapshot.selectedScopeId,
        body: snapshot.draftBody,
      });
      const scope = config.scopes.find((entry) => entry.id === snapshot.selectedScopeId) ?? config.scopes[0] ?? null;
      setState((current) => ({
        ...current,
        config,
        selectedScopeId: scope?.id ?? current.selectedScopeId,
        draftBody: scope ? editableAgentInstructionBody(scope) : current.draftBody,
        saveStatus: "saved",
        errorMessage: null,
      }));
      setLoadErrors(uniqueMessages(config.scopes.flatMap((entry) => entry.errorMessages)));
    } catch (error) {
      setState((current) => ({
        ...current,
        saveStatus: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return {
    state,
    selectedScope,
    partialErrors,
    load,
    resetLoadErrors,
    selectScope,
    useProviderSource,
    loadTemplate,
    updateDraftBody,
    save,
  };
}

export type AgentInstructionEditorController = ReturnType<typeof useAgentInstructionEditor>;

export function agentInstructionStatusLabel(scope: AgentInstructionScope | null): string {
  if (!scope) {
    return "Unavailable";
  }
  switch (scope.status) {
    case "aligned":
      return "Aligned";
    case "different":
      return "Different";
    case "missing-agents":
      return "Missing AGENTS.md";
    case "missing-claude":
      return "Missing CLAUDE.md";
    case "missing-both":
      return "Not set up";
    case "error":
      return "Error";
  }
}

function editableAgentInstructionBody(scope: AgentInstructionScope): string {
  return scope.status === "different" || scope.status === "error" ? "" : scope.body;
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
}
