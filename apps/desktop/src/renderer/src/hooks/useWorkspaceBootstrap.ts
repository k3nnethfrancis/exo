import { useEffect, useRef, useState } from "react";
import type {
  AgentCommand,
  IndexStatus,
  OnboardingMcpProvider,
  OnboardingProgressDraft,
  TreeNode,
  WorkspaceContentInspection,
  WorkspaceContentPolicy,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSettingsRevision,
} from "@exo/core";
import { createDefaultClaudeAgentCommand, createDefaultCodexAgentCommand } from "@exo/core/default-agent-command";
import { DEFAULT_AGENT_INVOCATION_PROMPT } from "@exo/core/agent-invocation-prompt";
import { defaultWorkspaceContentPolicy } from "@exo/core/workspace-content-policy";

import type {
  TerminalSessionInfo,
  WorkspaceRegistryEntry,
  WorkspaceSettingsRuntimeApplyOutcome,
  WorkspaceSetupState,
} from "../../../shared/api";
import { loadInitialTrees, type UseWorkspaceTreesOptions } from "./useWorkspaceTrees";
import { pathLabel } from "../workspaceTree";

export interface OnboardingState {
  mode: "first-run" | "switch";
  step: OnboardingProgressDraft["step"] | "recovery";
  workspaces: WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  notesFolder: string;
  defaultTerminalCwd: string;
  contentPolicy: WorkspaceContentPolicy;
  contentInspection: WorkspaceContentInspection | null;
  indexMode: WorkspaceSettings["indexing"]["mode"];
  searchEngine: "qmd" | "filesystem";
  exploreIndexSearchOnEnter: boolean;
  indexUpdateStrategy: WorkspaceSettings["indexUpdateStrategy"];
  agentCommands: AgentCommand[];
  agentInvocationPrompt: string;
  selectedMcpProviders: OnboardingMcpProvider[];
  status: "idle" | "saving" | "error";
  errorMessage: string | null;
}

export interface UseWorkspaceBootstrapOptions extends UseWorkspaceTreesOptions {
  applyWorkspaceSettings: (settings: WorkspaceSettings) => void;
  applyPersistedLayout: (layout: WorkspaceSettings["layout"] | undefined) => void;
  setIndexStatus: (status: IndexStatus) => void;
  replaceTreesForModel: (
    model: WorkspaceModel,
    nextNoteTrees: Record<string, TreeNode[]>,
  ) => void;
  restoreInitialDocuments: (settings: WorkspaceSettings) => Promise<void>;
  restoreTerminals: (input: {
    settings: WorkspaceSettings;
    sessions: TerminalSessionInfo[];
  }) => void;
}

export function useWorkspaceBootstrap(options: UseWorkspaceBootstrapOptions) {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [setupState, setSetupState] = useState<WorkspaceSetupState | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [layoutPersistenceReady, setLayoutPersistenceReady] = useState(false);
  const workspaceSettingsRef = useRef<WorkspaceSettings | null>(null);
  const workspaceSettingsRevisionRef = useRef<WorkspaceSettingsRevision>(null);
  const bootstrapRunRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const bootstrapRun = ++bootstrapRunRef.current;
      const currentOptions = optionsRef.current;
      const workspaceListPromise = window.exo.workspace.listWorkspaces().catch(() => []);
      const [setupState, model, settingsSnapshot, workspaces] = await Promise.all([
        window.exo.workspace.getSetupState(),
        window.exo.workspace.getModel(),
        window.exo.workspace.getSettings(),
        workspaceListPromise,
      ]);
      const settings = settingsSnapshot.settings;

      setBootstrapError(null);
      setSetupState(setupState);
      workspaceSettingsRef.current = settings;
      workspaceSettingsRevisionRef.current = settingsSnapshot.revision;
      setLayoutPersistenceReady(false);
      currentOptions.applyWorkspaceSettings(settings);
      currentOptions.applyPersistedLayout(settings.layout);

      if (!setupState.complete) {
        setWorkspaceModel(model);
        const initialState = setupState.onboardingRecovery
          ? {
              ...defaultFirstRunOnboardingState(settings, workspaces),
              step: "recovery" as const,
              status: "error" as const,
              errorMessage: setupState.onboardingRecovery.message,
            }
          : setupState.onboarding.status === "in-progress" && setupState.onboarding.draft
            ? onboardingStateFromDraft(setupState.onboarding.draft, workspaces)
            : defaultFirstRunOnboardingState(settings, workspaces);
        setOnboardingState(initialState);
        if (initialState.step !== "recovery" && initialState.notesFolder) {
          void inspectOnboardingContentScope(initialState.notesFolder, false);
        }
        return;
      }

      setOnboardingState(null);
      const status = await window.exo.workspace.getIndexStatus();
      currentOptions.setIndexStatus(status);
      const nextNoteTrees = await loadInitialTrees(model, currentOptions);

      if (cancelled) {
        return;
      }

      await currentOptions.restoreInitialDocuments(settings);

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      currentOptions.replaceTreesForModel(model, nextNoteTrees);
      setLayoutPersistenceReady(true);

      try {
        const sessions = await window.exo.terminals.list();

        if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[exo] renderer bootstrap", {
            workspaceRoot: model.workspaceRoot,
            defaultTerminalCwd: model.defaultTerminalCwd,
            noteRoots: model.noteRoots.map((root) => root.path),
            sessionCount: sessions.length,
          });
        }

        currentOptions.restoreTerminals({
          settings,
          sessions,
        });
      } catch (error) {
        console.error("[exo] terminal bootstrap failed", error);
        if (!cancelled && bootstrapRun === bootstrapRunRef.current) {
          setBootstrapError(error instanceof Error ? `Terminal setup failed: ${error.message}` : `Terminal setup failed: ${String(error)}`);
        }
      }
    }

    void bootstrap().catch((error) => {
      console.error("[exo] renderer bootstrap failed", error);
      if (!cancelled) {
        setBootstrapError(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function persistOnboardingState(current: OnboardingState): Promise<void> {
    if (current.mode !== "first-run" || current.step === "recovery") return;
    await window.exo.workspace.saveOnboardingProgress(onboardingDraftFromState(current));
  }

  async function confirmOnboardingChange(update: (current: OnboardingState) => OnboardingState): Promise<void> {
    const current = onboardingState;
    if (!current) return;
    const next = update(current);
    setOnboardingState({ ...next, status: "idle", errorMessage: null });
    try {
      await persistOnboardingState(next);
    } catch (error) {
      setOnboardingState({
        ...next,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to save setup progress.",
      });
    }
  }

  async function persistCurrentOnboardingState(): Promise<void> {
    const current = onboardingState;
    if (!current) return;
    try {
      await persistOnboardingState(current);
    } catch (error) {
      setOnboardingState({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to save setup progress.",
      });
      throw error;
    }
  }

  async function resetMalformedOnboardingProgress() {
    try {
      await window.exo.workspace.resetOnboardingProgress();
      window.location.reload();
    } catch (error) {
      setOnboardingState((current) => current ? {
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to restart setup.",
      } : current);
    }
  }

  async function selectNotesFolderForOnboarding() {
    const folders = await window.exo.workspace.selectFolder({
      title: "Choose your notes folder",
      buttonLabel: "Use Notes Folder",
    });
    if (folders[0]) {
      const notesFolder = folders[0];
      await confirmOnboardingChange((current) => ({
        ...current,
        notesFolder,
        defaultTerminalCwd: current.defaultTerminalCwd || defaultTerminalCwdForNotesFolder(notesFolder),
        contentInspection: null,
      }));
      void inspectOnboardingContentScope(notesFolder, true);
    }
  }

  async function selectDefaultTerminalForOnboarding() {
    const folders = await window.exo.workspace.selectFolder({
      title: "Choose default terminal folder",
      buttonLabel: "Use Terminal Folder",
    });
    if (folders[0]) {
      await confirmOnboardingChange((current) => ({
        ...current,
        defaultTerminalCwd: folders[0],
      }));
    }
  }

  async function openWorkspaceSwitcher() {
    const current = workspaceSettingsRef.current;
    const workspaces = await window.exo.workspace.listWorkspaces();
    setOnboardingState({
      mode: "switch",
      step: "select",
      workspaces,
      selectedWorkspaceId: workspaces.find((workspace) => workspace.notesFolder === current?.noteRoots[0])?.id ?? workspaces[0]?.id ?? null,
      notesFolder: current?.noteRoots[0] ?? "",
      defaultTerminalCwd: current?.defaultTerminalCwd ?? current?.noteRoots[0] ?? "",
      contentPolicy: current?.contentPolicy ?? defaultWorkspaceContentPolicy(),
      contentInspection: null,
      indexMode: current?.indexing.mode ?? "off",
      searchEngine: current?.searchEngine ?? (current?.indexing.enabled && current.indexing.mode !== "off" && current.indexedRoots.length > 0 ? "qmd" : "filesystem"),
      exploreIndexSearchOnEnter: current?.exploreIndexSearchOnEnter ?? false,
      indexUpdateStrategy: current?.indexUpdateStrategy ?? "on-save",
      agentCommands: current?.agentCommands ?? defaultOnboardingAgentCommands(),
      agentInvocationPrompt: current?.agentInvocationPrompt ?? DEFAULT_AGENT_INVOCATION_PROMPT,
      selectedMcpProviders: ["claude", "codex"],
      status: "idle",
      errorMessage: null,
    });
  }

  function startNewWorkspaceSetup() {
    void confirmOnboardingChange((current) => ({
      ...current,
      step: "configure",
      selectedWorkspaceId: null,
      notesFolder: "",
      defaultTerminalCwd: "",
      contentPolicy: defaultWorkspaceContentPolicy(),
      contentInspection: null,
      indexMode: "lexical",
      searchEngine: "qmd",
      exploreIndexSearchOnEnter: true,
      indexUpdateStrategy: "on-save",
      agentCommands: defaultOnboardingAgentCommands(),
      agentInvocationPrompt: DEFAULT_AGENT_INVOCATION_PROMPT,
      selectedMcpProviders: ["claude", "codex"],
    }));
  }

  async function activateSelectedWorkspace() {
    const current = onboardingState;
    if (!current?.selectedWorkspaceId) {
      setOnboardingState((state) =>
        state ? { ...state, status: "error", errorMessage: "Select a workspace to continue." } : state,
      );
      return;
    }
    setOnboardingState({ ...current, status: "saving", errorMessage: null });
    try {
      await persistOnboardingState(current);
      const saved = await window.exo.workspace.activateWorkspace({
        workspaceId: current.selectedWorkspaceId,
        expectedRevision: workspaceSettingsRevisionRef.current,
      });
      workspaceSettingsRef.current = saved.settings;
      workspaceSettingsRevisionRef.current = saved.revision;
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      const runtimeDecision = onboardingRuntimeApplyDecision(saved.runtimeApply);
      if (runtimeDecision.action === "retry") {
        setOnboardingState({
          ...current,
          status: "error",
          errorMessage: runtimeDecision.errorMessage,
        });
        return;
      }
      await window.exo.workspace.markOnboardingComplete();
      window.location.reload();
    } catch (error) {
      setOnboardingState({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to open workspace.",
      });
    }
  }

  async function inspectOnboardingContentScope(notesFolder: string, applyRecommendation: boolean) {
    try {
      const contentInspection = await window.exo.workspace.inspectContentScope(notesFolder);
      setOnboardingState((current) =>
        current?.notesFolder === notesFolder
          ? {
              ...current,
              contentInspection,
              contentPolicy: applyRecommendation ? contentInspection.recommendedPolicy : current.contentPolicy,
            }
          : current,
      );
    } catch {
      // Scope inspection is a setup convenience. A selected folder remains
      // usable even if a filesystem race makes classification unavailable.
    }
  }

  async function completeOnboarding() {
    const current = onboardingState;
    if (!current) {
      return;
    }
    const notesFolder = current.notesFolder.trim();
    if (!notesFolder) {
      setOnboardingState({ ...current, status: "error", errorMessage: "Choose or create a notes folder to continue." });
      return;
    }

    setOnboardingState({ ...current, status: "saving", errorMessage: null });
    try {
      await persistOnboardingState(current);
      const baseSnapshot = workspaceSettingsRef.current
        ? { settings: workspaceSettingsRef.current, revision: workspaceSettingsRevisionRef.current }
        : await window.exo.workspace.getSettings();
      const base = baseSnapshot.settings;
      const indexMode = current.indexMode;
      const indexedRootPaths = current.searchEngine === "qmd" ? [notesFolder] : [];
      const nextSettings: WorkspaceSettings = {
        ...base,
        workspaceRoot: notesFolder,
        defaultTerminalCwd: current.defaultTerminalCwd.trim() || defaultTerminalCwdForNotesFolder(notesFolder),
        noteRoots: [notesFolder],
        indexedRoots: indexedRootPaths.map((rootPath, index) => ({
          id: `index-root-${index + 1}`,
          label: pathLabel(rootPath),
          path: rootPath,
          kind: "notes",
          pattern: "**/*.md",
          ignore: [],
          backend: "qmd",
        })),
        indexing: { enabled: current.searchEngine === "qmd" && indexedRootPaths.length > 0, mode: current.searchEngine === "qmd" ? indexMode : "off", backend: "qmd" },
        searchEngine: current.searchEngine,
        exploreIndexSearchOnEnter: current.searchEngine === "qmd" && current.exploreIndexSearchOnEnter,
        indexUpdateStrategy: current.indexUpdateStrategy,
        agentCommands: current.agentCommands,
        agentInvocationPrompt: current.agentInvocationPrompt,
        contentPolicy: current.contentPolicy,
      };
      const saved = await window.exo.workspace.saveSettings({
        settings: nextSettings,
        expectedRevision: baseSnapshot.revision,
      });
      workspaceSettingsRef.current = saved.settings;
      workspaceSettingsRevisionRef.current = saved.revision;
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      const runtimeDecision = onboardingRuntimeApplyDecision(saved.runtimeApply);
      if (runtimeDecision.action === "retry") {
        setOnboardingState({
          ...current,
          status: "error",
          errorMessage: runtimeDecision.errorMessage,
        });
        return;
      }
      await window.exo.workspace.markOnboardingComplete();
      window.location.reload();
    } catch (error) {
      setOnboardingState({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to save setup.",
      });
    }
  }

  return {
    workspaceModel,
    setWorkspaceModel,
    onboardingState,
    setOnboardingState,
    setupState,
    setSetupState,
    bootstrapError,
    layoutPersistenceReady,
    workspaceSettingsRef,
    workspaceSettingsRevisionRef,
    selectNotesFolderForOnboarding,
    selectDefaultTerminalForOnboarding,
    confirmOnboardingChange,
    persistCurrentOnboardingState,
    resetMalformedOnboardingProgress,
    openWorkspaceSwitcher,
    startNewWorkspaceSetup,
    activateSelectedWorkspace,
    completeOnboarding,
  };
}

export function defaultTerminalCwdForNotesFolder(notesFolder: string): string {
  const normalized = notesFolder.trim().replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return normalized || notesFolder;
  }
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

/** A degraded activation has already committed the Workspace. Do not mark
 * onboarding complete or reload into a falsely healthy state; retrying this
 * screen safely reapplies the runtime transaction. */
export function onboardingRuntimeApplyDecision(
  outcome: WorkspaceSettingsRuntimeApplyOutcome,
): { action: "complete" } | { action: "retry"; errorMessage: string } {
  if (outcome.status === "applied") return { action: "complete" };
  if (outcome.status === "degraded") {
    return {
      action: "retry",
      errorMessage: `Your workspace is open, but one runtime service needs attention: ${outcome.errorMessage} Retry to recover it before continuing.`,
    };
  }
  return { action: "retry", errorMessage: outcome.errorMessage };
}

export function defaultOnboardingAgentCommands(): AgentCommand[] {
  return [createDefaultClaudeAgentCommand(), createDefaultCodexAgentCommand()];
}

export function defaultFirstRunOnboardingState(
  settings: WorkspaceSettings,
  workspaces: WorkspaceRegistryEntry[],
): OnboardingState {
  return {
    mode: "first-run",
    step: workspaces.length > 0 ? "select" : "configure",
    workspaces,
    selectedWorkspaceId: workspaces[0]?.id ?? null,
    notesFolder: "",
    defaultTerminalCwd: "",
    contentPolicy: defaultWorkspaceContentPolicy(),
    contentInspection: null,
    indexMode: "lexical",
    searchEngine: "qmd",
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: settings.indexUpdateStrategy,
    agentCommands: settings.agentCommands && settings.agentCommands.length > 0
      ? settings.agentCommands
      : defaultOnboardingAgentCommands(),
    agentInvocationPrompt: settings.agentInvocationPrompt ?? DEFAULT_AGENT_INVOCATION_PROMPT,
    selectedMcpProviders: ["claude", "codex"],
    status: "idle",
    errorMessage: null,
  };
}

export function onboardingStateFromDraft(
  draft: OnboardingProgressDraft,
  workspaces: WorkspaceRegistryEntry[],
): OnboardingState {
  return {
    mode: "first-run",
    step: draft.step,
    workspaces,
    selectedWorkspaceId: draft.selectedWorkspaceId,
    notesFolder: draft.notesFolder,
    defaultTerminalCwd: draft.defaultTerminalCwd,
    contentPolicy: draft.contentPolicy,
    contentInspection: null,
    indexMode: draft.search.indexMode,
    searchEngine: draft.search.searchEngine,
    exploreIndexSearchOnEnter: draft.search.exploreIndexSearchOnEnter,
    indexUpdateStrategy: draft.search.indexUpdateStrategy,
    agentCommands: draft.agentCommands,
    agentInvocationPrompt: draft.agentInvocationPrompt,
    selectedMcpProviders: draft.selectedMcpProviders,
    status: "idle",
    errorMessage: null,
  };
}

export function onboardingDraftFromState(state: OnboardingState): OnboardingProgressDraft {
  if (state.step === "recovery") {
    throw new Error("Malformed onboarding recovery cannot be persisted as progress.");
  }
  return {
    version: 1,
    step: state.step,
    selectedWorkspaceId: state.selectedWorkspaceId,
    notesFolder: state.notesFolder,
    defaultTerminalCwd: state.defaultTerminalCwd,
    contentPolicy: state.contentPolicy,
    search: {
      indexMode: state.indexMode,
      searchEngine: state.searchEngine,
      exploreIndexSearchOnEnter: state.exploreIndexSearchOnEnter,
      indexUpdateStrategy: state.indexUpdateStrategy,
    },
    agentCommands: state.agentCommands,
    agentInvocationPrompt: state.agentInvocationPrompt,
    selectedMcpProviders: state.selectedMcpProviders,
  };
}
