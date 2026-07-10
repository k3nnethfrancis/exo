import { useEffect, useRef, useState } from "react";
import type { IndexStatus, TreeNode, WorkspaceModel, WorkspaceSettings, WorkspaceSettingsRevision } from "@exo/core";

import type { TerminalSessionInfo, WorkspaceRegistryEntry, WorkspaceSetupState } from "../../../shared/api";
import type { PaneNode } from "./usePaneTree";
import { loadInitialTrees, type UseWorkspaceTreesOptions } from "./useWorkspaceTrees";
import { pathLabel, pickInitialNote } from "../workspaceTree";

export interface OnboardingState {
  mode: "first-run" | "switch";
  step: "select" | "configure";
  workspaces: WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  notesFolder: string;
  defaultTerminalCwd: string;
  indexMode: WorkspaceSettings["indexing"]["mode"];
  exploreIndexSearchOnEnter: boolean;
  indexUpdateStrategy: WorkspaceSettings["indexUpdateStrategy"];
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
    nextProjectTrees: Record<string, TreeNode[]>,
  ) => void;
  restoreInitialDocuments: (input: {
    settings: WorkspaceSettings;
    firstNotePath: string | null;
  }) => Promise<void>;
  restoreTerminals: (input: {
    settings: WorkspaceSettings;
    sessions: TerminalSessionInfo[];
    defaultTerminalId: string;
    defaultTerminalSnapshot?: string;
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
        setOnboardingState({
          mode: "first-run",
          step: workspaces.length > 0 ? "select" : "configure",
          workspaces,
          selectedWorkspaceId: workspaces[0]?.id ?? null,
          notesFolder: "",
          defaultTerminalCwd: "",
          indexMode: "hybrid",
          exploreIndexSearchOnEnter: false,
          indexUpdateStrategy: settings.indexUpdateStrategy,
          status: "idle",
          errorMessage: null,
        });
        return;
      }

      setOnboardingState(null);
      const status = await window.exo.workspace.getIndexStatus();
      currentOptions.setIndexStatus(status);
      const [nextNoteTrees, nextProjectTrees] = await loadInitialTrees(model, currentOptions);

      if (cancelled) {
        return;
      }

      const firstNote = pickInitialNote(Object.entries(nextNoteTrees));

      await currentOptions.restoreInitialDocuments({
        settings,
        firstNotePath: firstNote?.path ?? null,
      });

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      currentOptions.replaceTreesForModel(model, nextNoteTrees, nextProjectTrees);
      setLayoutPersistenceReady(true);

      try {
        const defaultTerminal = await window.exo.terminals.ensureDefault();
        const sessions = await window.exo.terminals.list();
        const defaultTerminalSnapshot = await window.exo.terminals.restoreSnapshot(defaultTerminal.id).catch((error) => {
          console.warn("[exo] default terminal snapshot failed", error);
          return undefined;
        });

        if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
          return;
        }

        if (import.meta.env.DEV) {
          console.info("[exo] renderer bootstrap", {
            workspaceRoot: model.workspaceRoot,
            defaultTerminalCwd: model.defaultTerminalCwd,
            noteRoots: model.noteRoots.map((root) => root.path),
            projectRoots: model.projectRoots.map((root) => root.path),
            initialNotePath: firstNote?.path ?? null,
            defaultTerminalId: defaultTerminal.id,
            defaultTerminalSessionCwd: defaultTerminal.cwd,
            sessionCount: sessions.length,
          });
        }

        currentOptions.restoreTerminals({
          settings,
          sessions,
          defaultTerminalId: defaultTerminal.id,
          defaultTerminalSnapshot,
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

  async function selectNotesFolderForOnboarding() {
    const folders = await window.exo.workspace.selectFolder({
      title: "Choose your notes folder",
      buttonLabel: "Use Notes Folder",
    });
    if (folders[0]) {
      setOnboardingState((current) =>
        current
          ? {
              ...current,
              notesFolder: folders[0],
              defaultTerminalCwd: current.defaultTerminalCwd || defaultTerminalCwdForNotesFolder(folders[0]),
              errorMessage: null,
              status: "idle",
            }
          : current,
      );
    }
  }

  async function selectDefaultTerminalForOnboarding() {
    const folders = await window.exo.workspace.selectFolder({
      title: "Choose default terminal folder",
      buttonLabel: "Use Terminal Folder",
    });
    if (folders[0]) {
      setOnboardingState((current) =>
        current
          ? {
              ...current,
              defaultTerminalCwd: folders[0],
              errorMessage: null,
              status: "idle",
            }
          : current,
      );
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
      indexMode: current?.indexing.mode ?? "off",
      exploreIndexSearchOnEnter: current?.exploreIndexSearchOnEnter ?? false,
      indexUpdateStrategy: current?.indexUpdateStrategy ?? "on-save",
      status: "idle",
      errorMessage: null,
    });
  }

  function startNewWorkspaceSetup() {
    setOnboardingState((current) =>
      current
        ? {
            ...current,
            step: "configure",
            selectedWorkspaceId: null,
            notesFolder: "",
            defaultTerminalCwd: "",
            indexMode: "hybrid",
            exploreIndexSearchOnEnter: true,
            indexUpdateStrategy: "on-save",
            status: "idle",
            errorMessage: null,
          }
        : current,
    );
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
      const saved = await window.exo.workspace.activateWorkspace({
        workspaceId: current.selectedWorkspaceId,
        expectedRevision: workspaceSettingsRevisionRef.current,
      });
      workspaceSettingsRef.current = saved.settings;
      workspaceSettingsRevisionRef.current = saved.revision;
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
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
      const baseSnapshot = workspaceSettingsRef.current
        ? { settings: workspaceSettingsRef.current, revision: workspaceSettingsRevisionRef.current }
        : await window.exo.workspace.getSettings();
      const base = baseSnapshot.settings;
      const indexMode = current.indexMode;
      const indexedRootPaths = indexMode === "off" ? [] : [notesFolder];
      const nextSettings: WorkspaceSettings = {
        ...base,
        workspaceRoot: notesFolder,
        defaultTerminalCwd: current.defaultTerminalCwd.trim() || defaultTerminalCwdForNotesFolder(notesFolder),
        noteRoots: [notesFolder],
        projectRoots: [],
        indexedRoots: indexedRootPaths.map((rootPath, index) => ({
          id: `index-root-${index + 1}`,
          label: pathLabel(rootPath),
          path: rootPath,
          kind: "notes",
          pattern: "**/*.md",
          ignore: [],
          backend: "qmd",
        })),
        indexing: { enabled: indexMode !== "off" && indexedRootPaths.length > 0, mode: indexMode, backend: "qmd" },
        exploreIndexSearchOnEnter: indexMode !== "off" && current.exploreIndexSearchOnEnter,
        indexUpdateStrategy: current.indexUpdateStrategy,
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
    setLayoutPersistenceReady,
    workspaceSettingsRef,
    workspaceSettingsRevisionRef,
    selectNotesFolderForOnboarding,
    selectDefaultTerminalForOnboarding,
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
