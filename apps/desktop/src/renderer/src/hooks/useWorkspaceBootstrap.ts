import type { IndexStatus, TreeNode, WorkspaceModel, WorkspaceSettings } from "@exo/core";
import { useEffect, useRef, useState } from "react";

import type { TerminalSessionInfo, WorkspaceRegistryEntry } from "../../../shared/api";
import type { PaneNode } from "./usePaneTree";
import { loadInitialTrees, type UseWorkspaceTreesOptions } from "./useWorkspaceTrees";
import { pathLabel, pickInitialNote, uniquePaths } from "../workspaceTree";

export interface OnboardingState {
  mode: "first-run" | "switch";
  step: "select" | "configure" | "capabilities";
  workspaces: WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  notesFolder: string;
  projectFolders: string[];
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
    defaultTerminalSnapshot: string;
  }) => void;
}

export function useWorkspaceBootstrap(options: UseWorkspaceBootstrapOptions) {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [layoutPersistenceReady, setLayoutPersistenceReady] = useState(false);
  const workspaceSettingsRef = useRef<WorkspaceSettings | null>(null);
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
      const [setupState, model, settings, workspaces] = await Promise.all([
        window.exo.workspace.getSetupState(),
        window.exo.workspace.getModel(),
        window.exo.workspace.getSettings(),
        workspaceListPromise,
      ]);

      setBootstrapError(null);
      workspaceSettingsRef.current = settings;
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
          projectFolders: settings.projectRoots,
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
      const defaultTerminal = await window.exo.terminals.ensureDefault();
      const sessions = await window.exo.terminals.list();
      const defaultTerminalSnapshot = await window.exo.terminals.restoreSnapshot(defaultTerminal.id);

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

      await currentOptions.restoreInitialDocuments({
        settings,
        firstNotePath: firstNote?.path ?? null,
      });

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      currentOptions.replaceTreesForModel(model, nextNoteTrees, nextProjectTrees);
      currentOptions.restoreTerminals({
        settings,
        sessions,
        defaultTerminalId: defaultTerminal.id,
        defaultTerminalSnapshot,
      });
      setLayoutPersistenceReady(true);
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

  async function addProjectFoldersForOnboarding() {
    const folders = await window.exo.workspace.selectFolder({
      title: "Add project folders",
      buttonLabel: "Add Projects",
      allowMultiple: true,
    });
    if (folders.length > 0) {
      setOnboardingState((current) =>
        current
          ? {
              ...current,
              projectFolders: uniquePaths([...current.projectFolders, ...folders]),
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
      projectFolders: current?.projectRoots ?? [],
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
            projectFolders: [],
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
      const saved = await window.exo.workspace.activateWorkspace(current.selectedWorkspaceId);
      workspaceSettingsRef.current = saved;
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
      const base = workspaceSettingsRef.current ?? await window.exo.workspace.getSettings();
      const indexMode = current.indexMode;
      const indexedRootPaths = indexMode === "off" ? [] : [notesFolder];
      const nextSettings: WorkspaceSettings = {
        ...base,
        workspaceRoot: notesFolder,
        defaultTerminalCwd: current.defaultTerminalCwd.trim() || defaultTerminalCwdForNotesFolder(notesFolder),
        noteRoots: [notesFolder],
        projectRoots: current.projectFolders,
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
      const saved = await window.exo.workspace.saveSettings(nextSettings);
      workspaceSettingsRef.current = saved;
      await window.exo.workspace.markOnboardingProfileSetup({ status: "pending", setupStep: "plugins" });
      window.location.reload();
    } catch (error) {
      setOnboardingState({
        ...current,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to save setup.",
      });
    }
  }

  function enterWorkspaceAfterCapabilityReview() {
    window.location.reload();
  }

  return {
    workspaceModel,
    setWorkspaceModel,
    onboardingState,
    setOnboardingState,
    bootstrapError,
    layoutPersistenceReady,
    setLayoutPersistenceReady,
    workspaceSettingsRef,
    selectNotesFolderForOnboarding,
    addProjectFoldersForOnboarding,
    selectDefaultTerminalForOnboarding,
    openWorkspaceSwitcher,
    startNewWorkspaceSetup,
    activateSelectedWorkspace,
    completeOnboarding,
    enterWorkspaceAfterCapabilityReview,
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
