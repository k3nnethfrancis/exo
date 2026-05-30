import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type {
  BranchFamily,
  IndexStatus,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  WorkspaceLayoutSettings,
  WorkspaceModel,
  WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo, WorkspaceRegistryEntry } from "../../shared/api";
import type { FileStatInfo } from "../../shared/api";

import type { AppearanceMode, ResolvedAppearance } from "./appearance";
import { AgentConfigEditorDialog } from "./components/AgentConfigEditorDialog";
import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { BrowserPane } from "./components/BrowserPane";
import { InspectorDock } from "./components/InspectorDock";
import { PathList } from "./components/PathList";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { WorkspaceSettingsDialog } from "./components/WorkspaceSettingsDialog";
import { writeTerminalData } from "./components/terminalRegistry";
import { useAgentInstructionEditor } from "./hooks/useAgentInstructionEditor";
import { useProjectReviewState } from "./hooks/useProjectReviewState";
import { useShellLayout } from "./hooks/useShellLayout";
import { loadInitialTrees, useWorkspaceTrees } from "./hooks/useWorkspaceTrees";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { collectLeaves, findEditorLeaf, findNode, findTerminalLeaf, mapLeaves, paneId, pruneEmptyLeaves, removeNode, updateNode, type PaneLeaf, type PaneNode, type PaneNodeId, type BrowserPaneContent, type EditorPaneContent } from "./hooks/usePaneTree";
import { useDragManager, type DragDropTarget, type DragPayload, type DropEdge } from "./hooks/useDragManager";
import {
  addTerminalSessionToFirstLeaf,
  addTerminalSessionToTargetLeaf,
  collectActiveTerminalIds,
  collectOpenEditorPaths,
  collectTerminalSessionIds,
  countTerminalSessions,
  findActiveEditorPath,
  removeTerminalSessionFromTree,
  pruneStaleTerminalSessions,
  treeContainsTerminalSession,
} from "./paneTreeSelectors";
import { terminalSessionsEqual } from "./terminalSessions";
import {
  clampNumber,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  FULL_TERMINAL_SCROLLBACK_LINES,
  resolveSettingsTerminalRuntime,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "./workspaceSettingsModel";
import {
  directoryOf,
  pathLabel,
  pickInitialNote,
  uniquePaths,
} from "./workspaceTree";
import type { IndexBusyState, WorkspaceSettingsDialogState, WorkspaceSettingsSection } from "./workspaceSettingsDialogTypes";

interface OpenEditorDocument extends NoteDocument {
  dirty: boolean;
  diskVersion: FileStatInfo | null;
}

type WorkspaceDialogState =
  | {
      kind: "create-file";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "create-directory";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "rename";
      targetPath: string;
      value: string;
      title: string;
      confirmLabel: string;
    }
  | {
      kind: "delete";
      targetPath: string;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "move-conflict";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "attach-project";
      title: string;
      message: string;
      confirmLabel: string;
    };

interface OnboardingState {
  mode: "first-run" | "switch";
  step: "select" | "configure";
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

// DragState replaced by useDragManager — see DragPayload in hooks/useDragManager.ts

type ZoomSurface = "editor" | "terminal" | "explorer";

const NOTE_TREE_MAX_DEPTH = 3;
const PROJECT_TREE_MAX_DEPTH = 3;

export function App() {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const workspaceTrees = useWorkspaceTrees({ noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH, projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH });
  const { noteTrees, projectTrees } = workspaceTrees;
  const [exploreIndexSearchOnEnter, setExploreIndexSearchOnEnter] = useState(false);
  const workspaceSearch = useWorkspaceSearch({ indexedOnEnter: exploreIndexSearchOnEnter });
  const [openDocuments, setOpenDocuments] = useState<Record<string, OpenEditorDocument>>({});
  const [documentSaveStatuses, setDocumentSaveStatuses] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [knowledgeByPath, setKnowledgeByPath] = useState<Record<string, NoteKnowledge>>({});
  const [branchFamiliesByPath, setBranchFamiliesByPath] = useState<Record<string, BranchFamily>>({});
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [revealExplorerPathRequest, setRevealExplorerPathRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [editorRevealLineRequest, setEditorRevealLineRequest] = useState<{ filePath: string; line: number; nonce: number } | null>(null);
  const [editorScrollRestoreRequest, setEditorScrollRestoreRequest] = useState<{ filePath: string; scrollTop: number; nonce: number } | null>(null);
  const handleDropRef = useRef<(target: DragDropTarget, payload: DragPayload) => void>(() => {});
  const dragManager = useDragManager((target, payload) => handleDropRef.current(target, payload));
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalHydrationSnapshots, setTerminalHydrationSnapshots] = useState<Record<string, string>>({});
  const [terminalHydrationVersions, setTerminalHydrationVersions] = useState<Record<string, number>>({});
  const [, setAgentAnnotations] = useState<Record<string, { runLabel: string; parentId: string | null }>>({});
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState | null>(null);
  const [workspaceSettingsDialog, setWorkspaceSettingsDialog] = useState<WorkspaceSettingsDialogState | null>(null);
  const [agentContextManagerOpen, setAgentContextManagerOpen] = useState(false);
  const agentInstructionEditor = useAgentInstructionEditor();
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState<IndexBusyState>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system");
  const [zoomSurface, setZoomSurface] = useState<ZoomSurface>("editor");
  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [terminalRuntimeScrollbackLines, setTerminalRuntimeScrollbackLines] = useState(FULL_TERMINAL_SCROLLBACK_LINES);
  const [explorerScale, setExplorerScale] = useState(DEFAULT_EXPLORER_SCALE);
  const [layoutPersistenceReady, setLayoutPersistenceReady] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const bootstrapRunRef = useRef(0);
  const editorScrollRestoreNonceRef = useRef(0);
  const terminalRuntimeScrollbackLinesRef = useRef(FULL_TERMINAL_SCROLLBACK_LINES);
  const terminalSessionsRef = useRef<TerminalSessionInfo[]>([]);
  const terminalKindByIdRef = useRef<Record<string, TerminalSessionInfo["kind"]>>({});
  const openDocumentsRef = useRef(openDocuments);
  const saveDocumentRef = useRef<(filePath: string) => Promise<void>>(async () => {});
  const activeDocumentPathRef = useRef(activeDocumentPath);
  const pendingDocumentRefreshesRef = useRef<Map<string, { timeoutId: number; diskVersion: FileStatInfo | null }>>(new Map());
  const workspaceSettingsRef = useRef<WorkspaceSettings | null>(null);
  const shellLayout = useShellLayout();
  const projectReviewState = useProjectReviewState(workspaceModel, terminalSessions);

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;
  const activeKnowledge = activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null;
  const { tree: editorTree, focusedLeafId: editorFocusedLeafId, actions: editorActions } = shellLayout.editorPaneTree;
  const { tree: terminalTree, focusedLeafId: terminalFocusedLeafId, actions: terminalActions } = shellLayout.terminalPaneTree;
  const compactEditorChrome = collectLeaves(editorTree).length > 1;
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;

  useEffect(() => {
    terminalSessionsRef.current = terminalSessions;
    terminalKindByIdRef.current = Object.fromEntries(terminalSessions.map((session) => [session.id, session.kind]));
  }, [terminalSessions]);

  useEffect(() => {
    terminalRuntimeScrollbackLinesRef.current = terminalRuntimeScrollbackLines;
  }, [terminalRuntimeScrollbackLines]);

  function setTerminalHydrationSnapshot(id: string, snapshot: string) {
    setTerminalHydrationSnapshots((current) => ({ ...current, [id]: snapshot }));
    setTerminalHydrationVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  }

  async function hydrateTerminal(id: string) {
    const snapshot = await window.exo.terminals.read(id);
    setTerminalHydrationSnapshot(id, snapshot);
  }

  useEffect(() => {
    openDocumentsRef.current = openDocuments;
  }, [openDocuments]);

  useEffect(() => {
    activeDocumentPathRef.current = activeDocumentPath;
  }, [activeDocumentPath]);

  useEffect(() => {
    const openPaths = collectOpenEditorPaths(editorTree);
    setOpenDocuments((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([filePath, document]) => openPaths.has(filePath) || document.dirty),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setKnowledgeByPath((current) => pruneRecordToKeys(current, openPaths));
    setBranchFamiliesByPath((current) => pruneRecordToKeys(current, openPaths));
  }, [editorTree]);

  useEffect(() => {
    const activeTerminalIds = collectActiveTerminalIds(editorTree);
    for (const id of collectActiveTerminalIds(terminalTree)) {
      activeTerminalIds.add(id);
    }
    if (activeTerminalId) {
      activeTerminalIds.add(activeTerminalId);
    }
    setTerminalHydrationSnapshots((current) => pruneRecordToKeys(current, activeTerminalIds));
    setTerminalHydrationVersions((current) => pruneRecordToKeys(current, activeTerminalIds));
  }, [activeTerminalId, editorTree, terminalTree]);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function handleChange(event: MediaQueryListEvent) {
      setSystemPrefersDark(event.matches);
    }

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appearanceMode = appearanceMode;
    document.documentElement.dataset.theme = resolvedAppearance;
    document.documentElement.style.colorScheme = resolvedAppearance;
  }, [appearanceMode, resolvedAppearance]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const bootstrapRun = ++bootstrapRunRef.current;
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
      const terminalPolicy = resolveSettingsTerminalRuntime(settings);
      setAppearanceMode(settings.appearanceMode);
      setEditorFontSize(settings.editorFontSize);
      setTerminalFontSize(settings.terminalFontSize);
      setTerminalRuntimeScrollbackLines(terminalPolicy.scrollbackLines);
      setExplorerScale(settings.explorerScale);
      setExploreIndexSearchOnEnter(settings.exploreIndexSearchOnEnter);
      shellLayout.applyPersistedLayout(settings.layout);

      if (!setupState.complete) {
        setWorkspaceModel(model);
        setOnboardingState({
          mode: "first-run",
          step: "select",
          workspaces,
          selectedWorkspaceId: workspaces[0]?.id ?? null,
          notesFolder: "",
          projectFolders: settings.projectRoots,
          defaultTerminalCwd: "",
          indexMode: settings.indexing.mode,
            exploreIndexSearchOnEnter: false,
          indexUpdateStrategy: settings.indexUpdateStrategy,
          status: "idle",
          errorMessage: null,
        });
        return;
      }

      setOnboardingState(null);
      const status = await window.exo.workspace.getIndexStatus();
      setIndexStatus(status);
      const [nextNoteTrees, nextProjectTrees] = await loadInitialTrees(model, {
        noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH,
        projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH,
      });

      if (cancelled) {
        return;
      }

      const firstNote = pickInitialNote(Object.entries(nextNoteTrees));
      const defaultTerminal = await window.exo.terminals.ensureDefault();
      const sessions = await window.exo.terminals.list();
      const defaultTerminalSnapshot = await window.exo.terminals.read(defaultTerminal.id);

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

      if (firstNote) {
        const restoredPaths = settings.layout ? collectOpenEditorPaths(settings.layout.editorTree as PaneNode) : new Set<string>();
        if (restoredPaths.size > 0) {
          await Promise.all(
            Array.from(restoredPaths).map((filePath) =>
              ensureDocumentLoaded(filePath).catch((error) => {
                console.warn("[exo] failed to restore open document", { filePath, error });
              }),
            ),
          );
          const restoredActivePath = findActiveEditorPath(settings.layout?.editorTree as PaneNode | undefined);
          setActiveDocumentPath(restoredActivePath ?? restoredPaths.values().next().value ?? firstNote.path);
        } else {
          await openFile(firstNote.path, editorFocusedLeafId);
        }
      }

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      workspaceTrees.replaceTreesForModel(model, nextNoteTrees, nextProjectTrees);
      setTerminalSessions(sessions);
      setActiveTerminalId(defaultTerminal.id);
      setTerminalHydrationSnapshot(defaultTerminal.id, defaultTerminalSnapshot);

      const sessionIds = sessions.map((session) => session.id);
      const restoreTerminalsInEditor = Boolean(settings.layout?.terminalCollapsed && settings.layout.editorTree);
      const persistedEditorTerminalIds = settings.layout
        ? collectTerminalSessionIds(settings.layout.editorTree as PaneNode)
        : new Set<string>();
      const terminalTreeSessionIds = restoreTerminalsInEditor
        ? []
        : sessionIds.filter((sessionId) => !persistedEditorTerminalIds.has(sessionId));
      editorActions.setTree((currentTree) => {
        const pruned = pruneStaleTerminalSessions(currentTree, new Set(sessionIds));
        return restoreTerminalsInEditor
          ? sessionIds.reduce((nextTree, sessionId) => addTerminalSessionToFirstLeaf(nextTree, sessionId), pruned)
          : pruned;
      });
      terminalActions.setTree((currentTree) => {
        const pruned = pruneStaleTerminalSessions(currentTree, new Set(sessionIds));
        return restoreTerminalsInEditor
          ? pruned
          : terminalTreeSessionIds.reduce((nextTree, sessionId) => addTerminalSessionToFirstLeaf(nextTree, sessionId), pruned);
      });
      setLayoutPersistenceReady(true);
    }

    void bootstrap().catch((error) => {
      console.error("[exo] renderer bootstrap failed", error);
      if (!cancelled) {
        setBootstrapError(error instanceof Error ? error.message : String(error));
      }
    });

    const removeDataListener = window.exo.terminals.onData(({ id, data }) => {
      writeTerminalData(id, data);
    });

    const removeExitListener = window.exo.terminals.onExit(({ id, exitCode }) => {
      setTerminalSessions((current) =>
        current.map((session) => (session.id === id ? { ...session, status: "exited", exitCode } : session)),
      );
    });
    const removeCreatedListener = window.exo.terminals.onCreated((session) => {
      adoptExternalTerminalSessions([session], { activateLatest: true });
    });
    const syncTerminalSessionsInterval = window.setInterval(() => {
      void window.exo.terminals.list().then((sessions) => {
        const knownIds = new Set(terminalSessionsRef.current.map((session) => session.id));
        const unseenSessions = sessions.filter((session) => !knownIds.has(session.id));
        setTerminalSessions((current) => (terminalSessionsEqual(current, sessions) ? current : sessions));
        if (unseenSessions.length > 0) {
          adoptExternalTerminalSessions(unseenSessions, { activateLatest: true });
        }
      });
    }, 1500);

    return () => {
      cancelled = true;
      removeDataListener();
      removeExitListener();
      removeCreatedListener();
      window.clearInterval(syncTerminalSessionsInterval);
    };
  }, []);

  useEffect(() => {
    if (!activeTerminalId || terminalKindByIdRef.current[activeTerminalId] === "shell") {
      return;
    }

    let cancelled = false;
    async function refreshActiveAgentBuffer() {
      if (!activeTerminalId) {
        return;
      }
      const snapshot = await window.exo.terminals.read(activeTerminalId);
      if (cancelled) {
        return;
      }
      setTerminalHydrationSnapshot(activeTerminalId, snapshot);
    }

    void refreshActiveAgentBuffer();

    return () => {
      cancelled = true;
    };
  }, [activeTerminalId, terminalSessions]);

  useEffect(() => {
    if (!layoutPersistenceReady || onboardingState || !workspaceModel) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const currentSettings = workspaceSettingsRef.current;
      if (!currentSettings) {
        return;
      }

      const layout = createWorkspaceLayoutSnapshot({
        editorTree,
        terminalTree,
        terminalCollapsed: shellLayout.terminalCollapsed,
        sidePanesFlipped: shellLayout.sidePanesFlipped,
        zoneSplitRatio: shellLayout.zoneSplitRatio,
        sidebarCollapsed: shellLayout.sidebarCollapsed,
        sidebarWidth: shellLayout.sidebarWidth,
        inspectorCollapsed: shellLayout.inspectorCollapsed,
      });
      if (stableJson(currentSettings.layout ?? null) === stableJson(layout)) {
        return;
      }

      void window.exo.workspace.saveSettings({ ...currentSettings, layout }).then((saved) => {
        workspaceSettingsRef.current = saved;
      }).catch((error) => {
        console.warn("[exo] failed to persist workspace layout", error);
      });
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [
    editorTree,
    terminalTree,
    shellLayout.terminalCollapsed,
    shellLayout.sidePanesFlipped,
    shellLayout.zoneSplitRatio,
    shellLayout.sidebarCollapsed,
    shellLayout.sidebarWidth,
    shellLayout.inspectorCollapsed,
    layoutPersistenceReady,
    onboardingState,
    workspaceModel,
  ]);

  useEffect(() => {
    setAgentAnnotations((current) => {
      const next = { ...current };
      const activeIds = new Set(terminalSessions.map((session) => session.id));

      for (const session of terminalSessions) {
        if (!next[session.id]) {
          next[session.id] = {
            runLabel: "",
            parentId: null,
          };
        }
      }

      for (const agentId of Object.keys(next)) {
        if (!activeIds.has(agentId)) {
          delete next[agentId];
        } else if (next[agentId]?.parentId && !activeIds.has(next[agentId].parentId!)) {
          next[agentId] = { ...next[agentId], parentId: null };
        }
      }

      return next;
    });
  }, [terminalSessions]);

  // Command listener — agents can tell the app to open files via the command server
  useEffect(() => {
    return window.exo.workspace.onCommandOpenFile((filePath: string) => {
      void openFile(filePath);
    });
  }, []);

  useEffect(() => {
    const removeWorkspaceChangeListener = window.exo.workspace.onDidChange((event) => {
      if (event.eventType === "rename" || !event.filePath) {
        void reloadTrees();
      }
      if (event.filePath) {
        const filePath = event.filePath;
        scheduleOpenDocumentRefresh(filePath);
        projectReviewState.recordObservedWorkspaceWrite(event.rootPath, filePath);
        if (workspaceModel?.projectRoots.some((root) => isPathWithin(root.path, filePath))) {
          void projectReviewState.refreshProjectGitStatus(workspaceModel);
        }
      }
    });

    return () => {
      removeWorkspaceChangeListener();
    };
  }, [workspaceModel]);

  useEffect(() => {
    return window.exo.workspace.onIndexSyncState((event) => {
      if (event.state === "running") {
        setIndexBusy("syncing");
        return;
      }
      setIndexBusy(null);
      if (event.result?.status) {
        setIndexStatus(event.result.status);
        setWorkspaceSettingsDialog((current) =>
          current
            ? {
                ...current,
          }
        : current,
        );
      }
      if (event.state === "error") {
        setWorkspaceSettingsDialog((current) =>
          current
            ? {
                ...current,
                applyStatus: "error",
                applyErrorMessage: event.error ?? "Index sync failed.",
              }
            : current,
        );
      }
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && isZoomKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        updateFocusedSurfaceZoom(zoomDirection(event.key), resolveZoomSurface(event));
        return;
      }
      if (mod && event.key.toLowerCase() === "s" && activeDocument) {
        event.preventDefault();
        void saveDocument(activeDocument.filePath);
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void openOrCreateDailyNote();
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activeDocument, workspaceModel, editorFocusedLeafId, zoomSurface]);

  async function saveSettingsPatch(patch: Partial<WorkspaceSettings>) {
    const base = workspaceSettingsRef.current ?? await window.exo.workspace.getSettings();
    const nextSettings: WorkspaceSettings = {
      ...base,
      ...patch,
    };
    workspaceSettingsRef.current = nextSettings;
    const saved = await window.exo.workspace.saveSettings(nextSettings);
    workspaceSettingsRef.current = saved;
  }

  function updateAppearanceMode(nextMode: AppearanceMode) {
    setAppearanceMode(nextMode);
    void saveSettingsPatch({ appearanceMode: nextMode });
  }

  function updateFocusedSurfaceZoom(direction: -1 | 0 | 1, surface = zoomSurface) {
    if (surface === "terminal") {
      setTerminalFontSize((current) => {
        const next = direction === 0 ? DEFAULT_TERMINAL_FONT_SIZE : clampNumber(current + direction, 10, 22);
        void saveSettingsPatch({ terminalFontSize: next });
        return next;
      });
      return;
    }
    if (surface === "explorer") {
      setExplorerScale((current) => {
        const next = direction === 0 ? DEFAULT_EXPLORER_SCALE : clampNumber(Number((current + direction * 0.06).toFixed(2)), 0.82, 1.35);
        void saveSettingsPatch({ explorerScale: next });
        return next;
      });
      return;
    }
    setEditorFontSize((current) => {
      const next = direction === 0 ? DEFAULT_EDITOR_FONT_SIZE : clampNumber(current + direction, 11, 24);
      void saveSettingsPatch({ editorFontSize: next });
      return next;
    });
  }

  // Auto-save dirty documents every 5 seconds without resetting on unrelated renders.
  useEffect(() => {
    const timer = setInterval(() => {
      const dirtyPaths = Object.entries(openDocumentsRef.current)
        .filter(([, doc]) => doc.dirty)
        .map(([path]) => path);
      for (const filePath of dirtyPaths) {
        void saveDocumentRef.current(filePath);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const noteSections = useMemo(
    () =>
      workspaceModel?.noteRoots.map((root) => ({
        label: root.label,
        path: root.path,
        nodes: noteTrees[root.path] ?? [],
      })) ?? [],
    [noteTrees, workspaceModel],
  );
  const projectSections = useMemo(
    () =>
      workspaceModel?.projectRoots.map((root) => ({
        label: root.label,
        path: root.path,
        nodes: projectTrees[root.path] ?? [],
      })) ?? [],
    [projectTrees, workspaceModel],
  );
  const projectReviewChanges = projectReviewState.projectReviewChanges;
  const workspaceSettingsPartialErrors = useMemo(
    () =>
      workspaceSettingsDialog
        ? uniqueMessages([...workspaceSettingsDialog.partialErrorMessages, ...agentInstructionEditor.partialErrors])
        : agentInstructionEditor.partialErrors,
    [agentInstructionEditor.partialErrors, workspaceSettingsDialog],
  );

  async function reloadTrees() {
    if (!workspaceModel) {
      return;
    }

    await reloadTreesForModel(workspaceModel);
  }

  async function openProjectChangesFromStatus() {
    if (!workspaceModel || projectReviewChanges.length === 0) {
      return;
    }
    const attachedProjectRoots = workspaceModel.projectRoots.map((root) => root.path);
    const attachedChanges = projectReviewChanges.filter((change) =>
      attachedProjectRoots.some((rootPath) => isPathWithin(rootPath, change.absolutePath)),
    );
    if (attachedChanges.length === 0) {
      setWorkspaceDialog({
        kind: "attach-project",
        title: "Attach project to review changes",
        message: "Changed files belong to a folder that is not attached to this workspace. Attach or import the project before opening its changed files.",
        confirmLabel: "Open Settings",
      });
      return;
    }

    const changesToOpen = attachedChanges.slice(0, 8);
    await Promise.all(changesToOpen.map((change) => ensureDocumentLoaded(change.absolutePath)));
    const targetLeaf = findNode(editorTree, (n) => n.id === editorFocusedLeafId && n.kind === "leaf" && n.content.kind === "editor");
    const editorLeafId = targetLeaf?.id ?? findEditorLeaf(editorTree)?.id;
    if (editorLeafId) {
      editorActions.updateLeafContent(editorLeafId, (content) => {
        if (content.kind !== "editor") return content;
        const nextOpenPaths = [...content.openPaths];
        for (const change of changesToOpen) {
          if (!nextOpenPaths.includes(change.absolutePath)) {
            nextOpenPaths.push(change.absolutePath);
          }
        }
        return {
          ...content,
          activePath: changesToOpen[0].absolutePath,
          openPaths: nextOpenPaths,
        };
      });
      editorActions.focusLeaf(editorLeafId);
    }
    setActiveDocumentPath(changesToOpen[0].absolutePath);
    setActiveTag(null);
    setTagResults([]);
    if (changesToOpen[0].firstChangedLine && changesToOpen[0].firstChangedLine > 0) {
      setEditorRevealLineRequest({
        filePath: changesToOpen[0].absolutePath,
        line: changesToOpen[0].firstChangedLine,
        nonce: Date.now(),
      });
    }
  }

  async function reloadTreesForModel(model: WorkspaceModel) {
    await workspaceTrees.reloadTreesForModel(model);
  }

  async function refreshWorkspaceModel() {
    const [model] = await Promise.all([
      window.exo.workspace.getModel(),
      refreshIndexStatus(),
    ]);
    setWorkspaceModel(model);
    await reloadTreesForModel(model);
  }

  async function refreshIndexStatus() {
    const status = await window.exo.workspace.getIndexStatus();
    setIndexStatus(status);
    return status;
  }

  async function openAgentContextManager() {
    setWorkspaceSettingsDialog(null);
    setAgentContextManagerOpen(true);
    void agentInstructionEditor.load();
  }

  async function openWorkspaceSettingsDialog(section: WorkspaceSettingsSection = "workspace") {
    const settings = await window.exo.workspace.getSettings();
    const appliedWorkspaceKey = workspaceSettingsStructuralKeyFromSettings(settings);
    agentInstructionEditor.resetLoadErrors();
    setWorkspaceSettingsDialog({
      section,
      workspaceRoot: settings.workspaceRoot,
      defaultTerminalCwd: settings.defaultTerminalCwd,
      noteRoots: settings.noteRoots,
      projectRoots: settings.projectRoots,
      indexedRoots: settings.indexedRoots.map((root) => root.path),
      indexMode: settings.indexing.mode,
      appearanceMode: settings.appearanceMode,
      editorFontSize: String(settings.editorFontSize),
      terminalFontSize: String(settings.terminalFontSize),
      terminalHistoryMode: settings.terminalHistoryMode,
      terminalHistoryLines: String(settings.terminalHistoryLines),
      terminalTranscriptRetention: settings.terminalTranscriptRetention,
      terminalTranscriptRetentionDays: String(settings.terminalTranscriptRetentionDays),
      explorerScale: String(settings.explorerScale),
      exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
      indexUpdateStrategy: settings.indexUpdateStrategy,
      saveStatus: "idle",
      errorMessage: null,
      appliedWorkspaceKey,
      applyStatus: "idle",
      applyErrorMessage: null,
      partialErrorMessages: [],
    });
    void window.exo.workspace.getIndexStatus().then(setIndexStatus).catch((error) => {
      console.warn("[exo] failed to load index status", error);
      setIndexStatus(null);
    });
    void agentInstructionEditor.load().then((partialErrorMessages) => {
      setWorkspaceSettingsDialog((current) => current ? { ...current, partialErrorMessages } : current);
    });
  }

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
    setWorkspaceSettingsDialog(null);
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
    if (!onboardingState?.selectedWorkspaceId) {
      setOnboardingState((current) =>
        current ? { ...current, status: "error", errorMessage: "Select a workspace to continue." } : current,
      );
      return;
    }
    setOnboardingState({ ...onboardingState, status: "saving", errorMessage: null });
    try {
      const saved = await window.exo.workspace.activateWorkspace(onboardingState.selectedWorkspaceId);
      workspaceSettingsRef.current = saved;
      window.location.reload();
    } catch (error) {
      setOnboardingState({
        ...onboardingState,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to open workspace.",
      });
    }
  }

  async function chooseFolderForSettings(target: "workspaceRoot" | "defaultTerminalCwd" | "noteRoot" | "projectRoot") {
    const folders = await window.exo.workspace.selectFolder({
      title:
        target === "noteRoot"
          ? "Choose notes folder"
          : target === "projectRoot"
            ? "Add project folder"
            : "Choose folder",
      buttonLabel: target === "projectRoot" ? "Add Folder" : "Use Folder",
      allowMultiple: target === "projectRoot",
    });
    if (folders.length === 0) {
      return;
    }
    setWorkspaceSettingsDialog((current) => {
      if (!current) {
        return current;
      }
      if (target === "workspaceRoot") {
        return { ...current, workspaceRoot: folders[0], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "defaultTerminalCwd") {
        return { ...current, defaultTerminalCwd: folders[0], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "noteRoot") {
        return { ...current, noteRoots: [folders[0]], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "projectRoot") {
        return { ...current, projectRoots: uniquePaths([...current.projectRoots, ...folders]), applyStatus: "idle", applyErrorMessage: null };
      }
      return current;
    });
  }

  async function completeOnboarding() {
    if (!onboardingState) {
      return;
    }
    const notesFolder = onboardingState.notesFolder.trim();
    if (!notesFolder) {
      setOnboardingState({ ...onboardingState, status: "error", errorMessage: "Choose or create a notes folder to continue." });
      return;
    }

    setOnboardingState({ ...onboardingState, status: "saving", errorMessage: null });
    try {
      const base = workspaceSettingsRef.current ?? await window.exo.workspace.getSettings();
      const indexMode = onboardingState.indexMode;
      const indexedRootPaths = indexMode === "off" ? [] : [notesFolder];
      const nextSettings: WorkspaceSettings = {
        ...base,
        workspaceRoot: notesFolder,
        defaultTerminalCwd: onboardingState.defaultTerminalCwd.trim() || onboardingState.projectFolders[0] || notesFolder,
        noteRoots: [notesFolder],
        projectRoots: onboardingState.projectFolders,
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
        exploreIndexSearchOnEnter: indexMode !== "off" && onboardingState.exploreIndexSearchOnEnter,
        indexUpdateStrategy: onboardingState.indexUpdateStrategy,
      };
      const saved = await window.exo.workspace.saveSettings(nextSettings);
      workspaceSettingsRef.current = saved;
      window.location.reload();
    } catch (error) {
      setOnboardingState({
        ...onboardingState,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unable to save setup.",
      });
    }
  }

  async function runIndexUpdate(action: Exclude<IndexBusyState, null>) {
    setIndexBusy(action);
    setWorkspaceSettingsDialog((current) =>
      current
        ? {
            ...current,
            applyStatus: "idle",
            applyErrorMessage: null,
          }
        : current,
    );

    try {
      const status = action === "syncing"
        ? (await window.exo.workspace.syncIndex()).status
        : action === "embedding"
          ? await window.exo.workspace.embedIndex()
          : await window.exo.workspace.updateIndex();
      setIndexStatus(status);
    } catch (error) {
      setWorkspaceSettingsDialog((current) =>
        current
          ? {
              ...current,
              applyStatus: "error",
              applyErrorMessage: error instanceof Error ? error.message : "Unable to update the index.",
            }
          : current,
      );
    } finally {
      setIndexBusy(null);
    }
  }

  function workspaceSettingsFromDialog(settingsDialog: WorkspaceSettingsDialogState, options: { includeStructural: boolean }): WorkspaceSettings {
    const currentSettings = workspaceSettingsRef.current;
    const fallbackStructural = {
      workspaceRoot: settingsDialog.workspaceRoot.trim(),
      defaultTerminalCwd: settingsDialog.defaultTerminalCwd.trim(),
      noteRoots: settingsDialog.noteRoots
        .map((entry) => entry.trim())
        .filter(Boolean),
      projectRoots: settingsDialog.projectRoots
        .map((entry) => entry.trim())
        .filter(Boolean),
      indexedRoots: settingsDialog.indexedRoots
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.trim())
        .map(({ entry, index }) => ({
          id: `index-root-${index + 1}`,
          label: pathLabel(entry.trim()),
          path: entry.trim(),
          kind: "mixed" as const,
          pattern: "**/*.md",
          ignore: [],
          backend: "qmd" as const,
        })),
      indexing: {
        enabled: settingsDialog.indexMode !== "off",
        mode: settingsDialog.indexMode,
        backend: "qmd" as const,
      },
    };
    const terminalHistoryLines = clampNumber(Number(settingsDialog.terminalHistoryLines), 500, FULL_TERMINAL_SCROLLBACK_LINES);
    const nextSettings: WorkspaceSettings = {
      workspaceRoot: options.includeStructural ? fallbackStructural.workspaceRoot : currentSettings?.workspaceRoot ?? fallbackStructural.workspaceRoot,
      defaultTerminalCwd: options.includeStructural ? fallbackStructural.defaultTerminalCwd : currentSettings?.defaultTerminalCwd ?? fallbackStructural.defaultTerminalCwd,
      noteRoots: options.includeStructural
        ? fallbackStructural.noteRoots
        : currentSettings?.noteRoots ?? fallbackStructural.noteRoots,
      projectRoots: options.includeStructural
        ? fallbackStructural.projectRoots
        : currentSettings?.projectRoots ?? fallbackStructural.projectRoots,
      indexedRoots: options.includeStructural
        ? fallbackStructural.indexedRoots
        : currentSettings?.indexedRoots ?? fallbackStructural.indexedRoots,
      indexing: options.includeStructural
        ? fallbackStructural.indexing
        : currentSettings?.indexing ?? fallbackStructural.indexing,
      appearanceMode: settingsDialog.appearanceMode,
      editorFontSize: clampNumber(Number(settingsDialog.editorFontSize), 11, 24),
      terminalFontSize: clampNumber(Number(settingsDialog.terminalFontSize), 10, 22),
      terminalHistoryMode: settingsDialog.terminalHistoryMode,
      terminalHistoryLines,
      terminalTranscriptRetention: settingsDialog.terminalTranscriptRetention,
      terminalTranscriptRetentionDays: clampNumber(Number(settingsDialog.terminalTranscriptRetentionDays), 1, 3650),
      explorerScale: clampNumber(Number(settingsDialog.explorerScale), 0.82, 1.35),
      exploreIndexSearchOnEnter: settingsDialog.exploreIndexSearchOnEnter,
      indexUpdateStrategy: settingsDialog.indexUpdateStrategy,
    };

    return nextSettings;
  }

  async function saveWorkspaceSettingsDialog(settingsDialog = workspaceSettingsDialog, options = { includeStructural: false }) {
    if (!settingsDialog) {
      return;
    }

    const nextSettings = workspaceSettingsFromDialog(settingsDialog, options);
    const snapshotKey = options.includeStructural ? workspaceSettingsStructuralDraftKey(settingsDialog) : workspaceSettingsImmediateDraftKey(settingsDialog);

    setWorkspaceSettingsDialog((current) =>
      current && (options.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
        ? {
            ...current,
            ...(options.includeStructural
              ? { applyStatus: "applying" as const, applyErrorMessage: null }
              : { saveStatus: "saving" as const, errorMessage: null }),
          }
        : current,
    );

    try {
      const saved = await window.exo.workspace.saveSettings(nextSettings);
      workspaceSettingsRef.current = saved;
      setAppearanceMode(saved.appearanceMode);
      setEditorFontSize(saved.editorFontSize);
      setTerminalFontSize(saved.terminalFontSize);
      const savedTerminalPolicy = resolveSettingsTerminalRuntime(saved);
      setTerminalRuntimeScrollbackLines(savedTerminalPolicy.scrollbackLines);
      setExplorerScale(saved.explorerScale);
      setExploreIndexSearchOnEnter(saved.exploreIndexSearchOnEnter);
      setWorkspaceSettingsDialog((current) =>
        current && (options.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
          ? {
              ...current,
              ...(options.includeStructural
                ? {
                    appliedWorkspaceKey: workspaceSettingsStructuralKeyFromSettings(saved),
                    applyStatus: "applied" as const,
                    applyErrorMessage: null,
                  }
                : {
                    saveStatus: "saved" as const,
                    errorMessage: null,
                  }),
          }
          : current,
      );
      if (options.includeStructural) {
        void refreshWorkspaceModel();
      }
    } catch (error) {
      setWorkspaceSettingsDialog((current) =>
        current && (options.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
          ? {
              ...current,
              ...(options.includeStructural
                ? {
                    applyStatus: "error" as const,
                    applyErrorMessage: error instanceof Error ? error.message : "Unable to apply workspace settings.",
                  }
                : {
                    saveStatus: "error" as const,
                    errorMessage: error instanceof Error ? error.message : "Unable to save workspace settings.",
                  }),
            }
          : current,
      );
    }
  }

  useEffect(() => {
    if (!workspaceSettingsDialog || workspaceSettingsDialog.saveStatus !== "idle") {
      return;
    }

    const snapshot = workspaceSettingsDialog;
    const timeout = window.setTimeout(() => {
      void saveWorkspaceSettingsDialog(snapshot);
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [workspaceSettingsDialog]);

  function closeWorkspaceSettingsDialog() {
    const snapshot = workspaceSettingsDialog;
    if (snapshot && snapshot.saveStatus !== "saved" && snapshot.saveStatus !== "saving") {
      void saveWorkspaceSettingsDialog(snapshot, { includeStructural: false });
    }
    setWorkspaceSettingsDialog(null);
  }

  function focusEditorPane(leafId: PaneNodeId) {
    editorActions.focusLeaf(leafId);
    const leaf = findNode(editorTree, (n) => n.id === leafId) as PaneLeaf | undefined;
    const nextActivePath = leaf?.content.kind === "editor" ? leaf.content.activePath : null;
    setActiveDocumentPath(nextActivePath);
    setActiveTag(null);
    if (!nextActivePath) {
      setTagResults([]);
    }
  }

  function setPaneActivePath(leafId: PaneNodeId, filePath: string) {
    editorActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "editor") return content;
      return {
        ...content,
        activePath: filePath,
        openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
      };
    });
    editorActions.focusLeaf(leafId);
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
  }

  function closeDocumentInPane(leafId: PaneNodeId, filePath: string) {
    const nextTree = pruneEmptyLeaves(
      mapLeaves(editorTree, (leaf) => {
        if (leaf.id !== leafId || leaf.content.kind !== "editor") return leaf;
        const nextOpenPaths = leaf.content.openPaths.filter((p) => p !== filePath);
        const closedIndex = leaf.content.openPaths.indexOf(filePath);
        const nextActivePath = leaf.content.activePath === filePath
          ? (nextOpenPaths[Math.max(0, closedIndex - 1)] ?? nextOpenPaths[0] ?? null)
          : leaf.content.activePath;
        return { ...leaf, content: { ...leaf.content, openPaths: nextOpenPaths, activePath: nextActivePath } };
      }),
      (leaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0,
    );
    editorActions.setTree(nextTree);

    const focused = findNode(nextTree, (n) => n.id === editorFocusedLeafId) as PaneLeaf | undefined;
    const fallback = findEditorLeaf(nextTree);
    const nextLeaf = focused?.content.kind === "editor" ? focused : fallback;
    const nextPath = nextLeaf?.content.kind === "editor" ? nextLeaf.content.activePath : null;
    setActiveDocumentPath(nextPath);
    if (!nextPath) {
      setActiveTag(null);
      setTagResults([]);
      const editorLeavesNow = collectLeaves(nextTree).filter((leaf) => leaf.content.kind === "editor");
      const allEmpty = editorLeavesNow.every(
        (leaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0,
      );
      if (allEmpty) {
        void openOrCreateDailyNote();
      }
    }
  }

  /** Load a document's content into state without touching the pane tree. */
  async function ensureDocumentLoaded(filePath: string) {
    const [document, diskVersion] = await Promise.all([window.exo.notes.read(filePath), window.exo.notes.stat(filePath)]);
    const isAttachedNote = workspaceModel
      ? isInsideAttachedRoot(filePath, workspaceModel.noteRoots.map((root) => root.path))
      : true;
    const [knowledge, branchFamily] =
      document.kind === "markdown" && isAttachedNote
        ? await Promise.all([window.exo.notes.getKnowledge(filePath), window.exo.notes.getBranchFamily(filePath)])
        : [null, null];

    setOpenDocuments((current) => ({
      ...current,
      [filePath]: {
        ...document,
        dirty: current[filePath]?.dirty ?? false,
        diskVersion: current[filePath]?.dirty ? current[filePath].diskVersion : diskVersion,
        frontmatter: current[filePath]?.dirty ? current[filePath].frontmatter : document.frontmatter,
        body: current[filePath]?.dirty ? current[filePath].body : document.body,
      },
    }));
    setKnowledgeByPath((current) => ({
      ...current,
      ...(knowledge ? { [filePath]: knowledge } : {}),
    }));
    setBranchFamiliesByPath((current) => ({
      ...current,
      ...(branchFamily ? { [filePath]: branchFamily } : {}),
    }));
  }

  function scheduleOpenDocumentRefresh(filePath: string, diskVersion?: FileStatInfo | null) {
    const currentDocument = openDocumentsRef.current[filePath];
    if (!currentDocument || currentDocument.dirty) {
      return;
    }

    const pending = pendingDocumentRefreshesRef.current.get(filePath);
    if (pending) {
      window.clearTimeout(pending.timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      pendingDocumentRefreshesRef.current.delete(filePath);
      void refreshOpenDocumentFromDisk(filePath, diskVersion);
    }, 250);
    pendingDocumentRefreshesRef.current.set(filePath, { timeoutId, diskVersion: diskVersion ?? null });
  }

  async function refreshOpenDocumentFromDisk(filePath: string, knownVersion?: FileStatInfo | null) {
    const currentDocument = openDocumentsRef.current[filePath];
    if (!currentDocument || currentDocument.dirty) {
      return;
    }

    const scrollTop = filePath === activeDocumentPathRef.current ? getEditorScrollTopForPath(filePath) : null;
    const [document, diskVersion] = await Promise.all([
      window.exo.notes.read(filePath),
      knownVersion === undefined ? window.exo.notes.stat(filePath) : Promise.resolve(knownVersion),
    ]);
    const isAttachedNote = workspaceModel
      ? isInsideAttachedRoot(filePath, workspaceModel.noteRoots.map((root) => root.path))
      : true;
    const [knowledge, branchFamily] =
      document.kind === "markdown" && isAttachedNote
        ? await Promise.all([window.exo.notes.getKnowledge(filePath), window.exo.notes.getBranchFamily(filePath)])
        : [null, null];

    setOpenDocuments((current) => {
      const currentDocument = current[filePath];
      if (!currentDocument || currentDocument.dirty) {
        return current;
      }

      if (
        currentDocument.body === document.body &&
        JSON.stringify(currentDocument.frontmatter) === JSON.stringify(document.frontmatter)
      ) {
        return {
          ...current,
          [filePath]: {
            ...currentDocument,
            diskVersion,
          },
        };
      }

      return {
        ...current,
        [filePath]: {
          ...document,
          dirty: false,
          diskVersion,
        },
      };
    });
    setKnowledgeByPath((current) => ({
      ...current,
      ...(knowledge ? { [filePath]: knowledge } : {}),
    }));
    setBranchFamiliesByPath((current) => ({
      ...current,
      ...(branchFamily ? { [filePath]: branchFamily } : {}),
    }));

    if (scrollTop !== null) {
      editorScrollRestoreNonceRef.current += 1;
      setEditorScrollRestoreRequest({ filePath, scrollTop, nonce: editorScrollRestoreNonceRef.current });
    }
  }

  async function openFile(filePath: string, leafId?: PaneNodeId, options?: { line?: number | null }) {
    const targetLeafId = leafId ?? editorFocusedLeafId;
    await ensureDocumentLoaded(filePath);

    // Find the target editor leaf — use targetLeafId if it's an editor, otherwise find any editor leaf
    const targetLeaf = findNode(editorTree, (n) => n.id === targetLeafId && n.kind === "leaf" && n.content.kind === "editor");
    const editorLeafId = targetLeaf?.id ?? findEditorLeaf(editorTree)?.id;
    if (editorLeafId) {
      editorActions.updateLeafContent(editorLeafId, (content) => {
        if (content.kind !== "editor") return content;
        return {
          ...content,
          activePath: filePath,
          openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
        };
      });
      editorActions.focusLeaf(editorLeafId);
    }
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
    if (options?.line && options.line > 0) {
      setEditorRevealLineRequest({ filePath, line: options.line, nonce: Date.now() });
    }
  }

  function updateBody(body: string) {
    if (!activeDocumentPath) {
      return;
    }

    setOpenDocuments((current) => ({
      ...current,
      [activeDocumentPath]: {
        ...current[activeDocumentPath],
        body,
        dirty: true,
      },
    }));
    setDocumentSaveStatuses((current) => ({ ...current, [activeDocumentPath]: "idle" }));
  }

  function updateFrontmatter(key: string, value: unknown) {
    if (!activeDocumentPath) {
      return;
    }

    setOpenDocuments((current) => ({
      ...current,
      [activeDocumentPath]: {
        ...current[activeDocumentPath],
        frontmatter: {
          ...current[activeDocumentPath].frontmatter,
          [key]: value,
        },
        dirty: true,
      },
    }));
    setDocumentSaveStatuses((current) => ({ ...current, [activeDocumentPath]: "idle" }));
  }

  async function saveDocument(filePath: string) {
    const document = openDocumentsRef.current[filePath];
    if (!document) {
      return;
    }

    setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "saving" }));
    try {
      await window.exo.notes.save(filePath, document.frontmatter, document.body);
      const diskVersion = await window.exo.notes.stat(filePath);
      const remainsOpen = collectOpenEditorPaths(editorTree).has(filePath);
      const isAttachedNote = workspaceModel
        ? isInsideAttachedRoot(filePath, workspaceModel.noteRoots.map((root) => root.path))
        : true;
      if (document.kind === "markdown" && remainsOpen && isAttachedNote) {
        const [knowledge, branchFamily] = await Promise.all([
          window.exo.notes.getKnowledge(filePath),
          window.exo.notes.getBranchFamily(filePath),
        ]);
        setKnowledgeByPath((current) => ({
          ...current,
          [filePath]: knowledge,
        }));
        setBranchFamiliesByPath((current) => ({
          ...current,
          [filePath]: branchFamily,
        }));
      }
      setOpenDocuments((current) => {
        if (!current[filePath]) {
          return current;
        }
        if (!remainsOpen) {
          const next = { ...current };
          delete next[filePath];
          return next;
        }
        return {
          ...current,
          [filePath]: {
            ...current[filePath],
            dirty: false,
            diskVersion,
          },
        };
      });
      setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "saved" }));
      window.setTimeout(() => {
        setDocumentSaveStatuses((current) => current[filePath] === "saved" ? { ...current, [filePath]: "idle" } : current);
      }, 1600);
    } catch (error) {
      console.error("[exo] failed to save document", { filePath, error });
      setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "error" }));
      throw error;
    }
  }
  saveDocumentRef.current = saveDocument;

  async function openKnowledgeTarget(target: string) {
    if (!activeDocumentPath) {
      return;
    }

    if (/^https?:\/\//.test(target)) {
      await window.exo.shell.openExternal(target);
      return;
    }

    const resolved = target.endsWith(".md") || target.includes("/")
      ? await window.exo.notes.resolveTarget(activeDocumentPath, target)
      : await window.exo.notes.resolveTarget(activeDocumentPath, `${target}.md`);

    const ensured = resolved ?? await window.exo.notes.ensureTarget(activeDocumentPath, target);
    await reloadTrees();
    await openFile(ensured, editorFocusedLeafId);
  }

  async function openTag(tag: string) {
    if (activeDocumentPath) {
      const resolved = await window.exo.notes.resolveTarget(activeDocumentPath, tag);
      if (resolved) {
        await openFile(resolved, editorFocusedLeafId);
        return;
      }
    }

    setActiveTag(tag);
    const results = await window.exo.workspace.searchTag(tag);
    setTagResults(results);
  }

  async function suggestNoteTargets(query: string) {
    if (!activeDocumentPath) {
      return [];
    }

    const suggestions = await window.exo.notes.suggestTargets(activeDocumentPath, query);
    return suggestions.map((suggestion) => ({
      label: suggestion.title,
      target: suggestion.target,
      detail: suggestion.snippet,
    }));
  }

  async function createTerminal(kind: "shell" | "claude" | "codex", cwd?: string, activate = true) {
    const session = await window.exo.terminals.create({ kind, cwd });
    shellLayout.setTerminalCollapsed(false);
    setTerminalSessions((current) =>
      current.some((existing) => existing.id === session.id) ? current : [...current, session],
    );

    // Add to the focused terminal leaf, or find any terminal leaf
    const focusedLeaf = findNode(terminalTree, (n) => n.id === terminalFocusedLeafId) as PaneLeaf | undefined;
    const termLeaf = (focusedLeaf?.content.kind === "terminal" ? focusedLeaf : null) ?? findTerminalLeaf(terminalTree);
    if (termLeaf) {
      terminalActions.updateLeafContent(termLeaf.id, (content) => {
        if (content.kind !== "terminal") return content;
        if (content.terminalIds.includes(session.id)) {
          return { ...content, activeTerminalId: activate ? session.id : content.activeTerminalId };
        }
        return {
          ...content,
          terminalIds: [...content.terminalIds, session.id],
          activeTerminalId: activate ? session.id : content.activeTerminalId,
        };
      });
    }
    if (activate) {
      setActiveTerminalId(session.id);
    }
    return session;
  }

  function adoptExternalTerminalSessions(
    sessions: TerminalSessionInfo[],
    options: { activateLatest: boolean },
  ) {
    if (sessions.length === 0) {
      return;
    }
    shellLayout.setTerminalCollapsed(false);

    setTerminalSessions((current) => {
      const seen = new Set(current.map((session) => session.id));
      const next = [...current];
      for (const session of sessions) {
        if (!seen.has(session.id)) {
          next.push(session);
        }
      }
      return next;
    });

    terminalActions.setTree((currentTree) =>
      sessions.reduce((nextTree, session) => addTerminalSessionToFirstLeaf(nextTree, session.id), currentTree),
    );

    if (!options.activateLatest) {
      return;
    }

    const latest = sessions.at(-1);
    if (!latest) {
      return;
    }

    setActiveTerminalId(latest.id);
    void hydrateTerminal(latest.id);
  }

  async function activateTerminal(leafId: PaneNodeId, id: string) {
    terminalActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "terminal") return content;
      return { ...content, activeTerminalId: id };
    });
    setActiveTerminalId(id);
    await hydrateTerminal(id);
  }

  async function focusTerminalSession(id: string) {
    const editorTerminalLeaf = collectLeaves(editorTree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(id),
    );
    if (editorTerminalLeaf) {
      editorActions.focusLeaf(editorTerminalLeaf.id);
      editorActions.updateLeafContent(editorTerminalLeaf.id, (content) =>
        content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
      );
      setZoomSurface("terminal");
      setActiveTerminalId(id);
      await hydrateTerminal(id);
      return;
    }

    const dockTerminalLeaf = collectLeaves(terminalTree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(id),
    );
    if (!dockTerminalLeaf) {
      return;
    }
    shellLayout.setTerminalCollapsed(false);
    setZoomSurface("terminal");
    terminalActions.focusLeaf(dockTerminalLeaf.id);
    await activateTerminal(dockTerminalLeaf.id, id);
  }

  function createBrowserPane(url = "about:blank") {
    const focusedLeaf = findNode(editorTree, (node) => node.id === editorFocusedLeafId && node.kind === "leaf") as PaneLeaf | undefined;
    const targetLeaf = focusedLeaf ?? collectLeaves(editorTree)[0];
    if (!targetLeaf) {
      return;
    }

    const newLeafId = paneId();
    const browserContent: BrowserPaneContent = { kind: "browser", url };
    editorActions.setTree((prev) =>
      updateNode(prev, targetLeaf.id, (node) => ({
        kind: "split" as const,
        id: paneId(),
        direction: "horizontal",
        ratio: 0.58,
        children: [
          node as PaneLeaf,
          { kind: "leaf", id: newLeafId, content: browserContent },
        ],
      })),
    );
    editorActions.focusLeaf(newLeafId);
    setZoomSurface("editor");
  }

  async function closeTerminal(id: string) {
    await window.exo.terminals.kill(id);
    setTerminalSessions((current) => current.filter((session) => session.id !== id));
    setTerminalHydrationSnapshots((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTerminalHydrationVersions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setAgentAnnotations((current) => {
      const next = { ...current };
      delete next[id];
      for (const key of Object.keys(next)) {
        if (next[key]?.parentId === id) {
          next[key] = { ...next[key], parentId: null };
        }
      }
      return next;
    });

    const remainingSessions = terminalSessions.filter((session) => session.id !== id);

    // Remove the session from whichever leaves hold it, then prune any leaf left empty.
    editorActions.setTree((prev) =>
      pruneEmptyLeaves(removeTerminalSessionFromTree(prev, id), (leaf) =>
        leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0,
      ),
    );
    terminalActions.setTree((prev) => {
      const next = removeTerminalSessionFromTree(prev, id);
      return pruneEmptyLeaves(next, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
    });

    if (activeTerminalId === id) {
      const fallback = remainingSessions.at(-1);
      setActiveTerminalId(fallback?.id ?? null);
    }
    if (remainingSessions.length === 0) {
      shellLayout.setTerminalCollapsed(true);
    }
  }

  async function createBranchFromActiveDocument() {
    if (!activeDocumentPath) {
      return;
    }

    const document = openDocuments[activeDocumentPath];
    if (!document || document.kind !== "markdown") {
      return;
    }

    const result = await window.exo.notes.createBranch(activeDocumentPath, document.frontmatter, document.body);
    setBranchFamiliesByPath((current) => ({
      ...current,
      [activeDocumentPath]: result.family,
      [result.branchFilePath]: result.family,
    }));
    await reloadTrees();
    await openFile(result.branchFilePath, editorFocusedLeafId);
  }

  function createFileInDirectory(directoryPath: string) {
    if (!workspaceModel) {
      return;
    }

    const noteRootPaths = workspaceModel.noteRoots.map((root) => root.path);
    const suggested = isInsideAttachedRoot(directoryPath, noteRootPaths) ? "new-note.md" : "new-file.txt";
    setWorkspaceDialog({
      kind: "create-file",
      targetPath: directoryPath,
      value: suggested,
      title: "Create file",
      confirmLabel: "Create",
    });
  }

  async function commitCreateFile(directoryPath: string, name: string) {
    if (!workspaceModel) {
      return;
    }

    const noteRootPaths = workspaceModel.noteRoots.map((root) => root.path);
    const nextPath = await window.exo.workspace.createFile(
      joinPath(directoryPath, ensureDefaultExtension(name, directoryPath, noteRootPaths)),
    );
    await reloadTrees();
    await openFile(nextPath, editorFocusedLeafId);
  }

  async function openOrCreateDailyNote() {
    if (!workspaceModel || workspaceModel.noteRoots.length === 0) {
      return;
    }
    const noteRoot = workspaceModel.noteRoots[0].path;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dailyPath = joinPath(noteRoot, `${yyyy}-${mm}-${dd}.md`);

    try {
      await window.exo.notes.read(dailyPath);
    } catch {
      const seed = `# ${yyyy}-${mm}-${dd}\n\n`;
      await window.exo.workspace.createFile(dailyPath, seed);
      await reloadTrees();
    }

    await openFile(dailyPath, editorFocusedLeafId);
  }

  function createDirectoryInDirectory(directoryPath: string) {
    setWorkspaceDialog({
      kind: "create-directory",
      targetPath: directoryPath,
      value: "new-folder",
      title: "Create folder",
      confirmLabel: "Create",
    });
  }

  async function commitCreateDirectory(directoryPath: string, name: string) {
    await window.exo.workspace.createDirectory(joinPath(directoryPath, name));
    await reloadTrees();
  }

  function renameWorkspacePath(sourcePath: string) {
    const currentName = sourcePath.split("/").at(-1) ?? sourcePath;
    setWorkspaceDialog({
      kind: "rename",
      targetPath: sourcePath,
      value: currentName,
      title: "Rename",
      confirmLabel: "Rename",
    });
  }

  async function commitRenameWorkspacePath(sourcePath: string, nextName: string) {
    const currentName = sourcePath.split("/").at(-1) ?? sourcePath;
    if (!nextName || nextName === currentName) {
      return;
    }
    const nextPath = joinPath(directoryOf(sourcePath), nextName);
    const previousPath = sourcePath;
    await window.exo.workspace.renamePath(sourcePath, nextPath);
    remapOpenPaths(previousPath, nextPath);
    await reloadTrees();
    if (previousPath === activeDocumentPath) {
      await openFile(nextPath, editorFocusedLeafId);
    }
  }

  async function moveWorkspacePathIntoDirectory(sourcePath: string, targetDirectoryPath: string) {
    const sourceLabel = pathLabel(sourcePath);
    const targetLabel = pathLabel(targetDirectoryPath);
    if (sourcePath === targetDirectoryPath) {
      return;
    }
    if (directoryOf(sourcePath) === targetDirectoryPath) {
      return;
    }
    if (isPathWithin(sourcePath, targetDirectoryPath)) {
      return;
    }

    const nextPath = joinPath(targetDirectoryPath, sourceLabel);
    try {
      await window.exo.workspace.renamePath(sourcePath, nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Destination already exists")) {
        setWorkspaceDialog({
          kind: "move-conflict",
          title: "Destination already exists",
          message: `${sourceLabel} cannot be moved into ${targetLabel} because ${pathLabel(nextPath)} already exists there. Exo will not merge or overwrite folders automatically.`,
          confirmLabel: "OK",
        });
      }
      throw error;
    }
    remapOpenPaths(sourcePath, nextPath);
    await reloadTrees();
    setRevealExplorerPathRequest({ path: targetDirectoryPath, nonce: Date.now() });
    if (sourcePath === activeDocumentPath) {
      await openFile(nextPath, editorFocusedLeafId);
    }
  }

  function deleteWorkspacePath(targetPath: string) {
    setWorkspaceDialog({
      kind: "delete",
      targetPath,
      title: "Delete path",
      message: `Delete ${targetPath.split("/").at(-1) ?? targetPath}?`,
      confirmLabel: "Delete",
    });
  }

  async function commitDeleteWorkspacePath(targetPath: string) {
    await window.exo.workspace.deletePath(targetPath);
    setOpenDocuments((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
    setKnowledgeByPath((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
    setBranchFamiliesByPath((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
    // Remove deleted paths from all editor leaves
    editorActions.setTree(mapLeaves(editorTree, (leaf) => {
      if (leaf.content.kind !== "editor") return leaf;
      const nextOpenPaths = leaf.content.openPaths.filter((fp) => !isPathWithin(targetPath, fp));
      return {
        ...leaf,
        content: {
          ...leaf.content,
          openPaths: nextOpenPaths,
          activePath: leaf.content.activePath && !isPathWithin(targetPath, leaf.content.activePath)
            ? leaf.content.activePath
            : nextOpenPaths.at(-1) ?? null,
        },
      };
    }));
    if (activeDocumentPath && isPathWithin(targetPath, activeDocumentPath)) {
      const focused = findNode(editorTree, (n) => n.id === editorFocusedLeafId) as PaneLeaf | undefined;
      const nextActivePath = focused?.content.kind === "editor" ? focused.content.activePath : null;
      setActiveDocumentPath(nextActivePath);
    }
    await reloadTrees();
  }

  async function submitWorkspaceDialog() {
    if (!workspaceDialog) {
      return;
    }

    if (workspaceDialog.kind === "move-conflict") {
      setWorkspaceDialog(null);
      return;
    }

    if (workspaceDialog.kind === "attach-project") {
      setWorkspaceDialog(null);
      await openWorkspaceSettingsDialog("workspace");
      return;
    }

    if (workspaceDialog.kind === "delete") {
      await commitDeleteWorkspacePath(workspaceDialog.targetPath);
      setWorkspaceDialog(null);
      return;
    }

    const value = workspaceDialog.value.trim();
    if (!value) {
      return;
    }

    if (workspaceDialog.kind === "create-file") {
      await commitCreateFile(workspaceDialog.targetPath, value);
    } else if (workspaceDialog.kind === "create-directory") {
      await commitCreateDirectory(workspaceDialog.targetPath, value);
    } else {
      await commitRenameWorkspacePath(workspaceDialog.targetPath, value);
    }

    setWorkspaceDialog(null);
  }

  function remapOpenPaths(sourcePath: string, nextPath: string) {
    const remapRecord = <T,>(record: Record<string, T>): Record<string, T> =>
      Object.fromEntries(
        Object.entries(record).map(([filePath, value]) => [
          isPathWithin(sourcePath, filePath) ? filePath.replace(sourcePath, nextPath) : filePath,
          value,
        ]),
      );

    setOpenDocuments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([filePath, value]) => {
          const remappedPath = isPathWithin(sourcePath, filePath) ? filePath.replace(sourcePath, nextPath) : filePath;
          return [
            remappedPath,
            {
              ...value,
              filePath: remappedPath,
            },
          ];
        }),
      ),
    );
    setKnowledgeByPath((current) => remapRecord(current));
    setBranchFamiliesByPath((current) => remapRecord(current));
    editorActions.setTree(mapLeaves(editorTree, (leaf) => {
      if (leaf.content.kind !== "editor") return leaf;
      return {
        ...leaf,
        content: {
          ...leaf.content,
          openPaths: leaf.content.openPaths.map((fp) =>
            isPathWithin(sourcePath, fp) ? fp.replace(sourcePath, nextPath) : fp,
          ),
          activePath: leaf.content.activePath && isPathWithin(sourcePath, leaf.content.activePath)
            ? leaf.content.activePath.replace(sourcePath, nextPath)
            : leaf.content.activePath,
        },
      };
    }));
    if (activeDocumentPath && isPathWithin(sourcePath, activeDocumentPath)) {
      setActiveDocumentPath(activeDocumentPath.replace(sourcePath, nextPath));
    }
  }

  // Assign the drop handler ref — called by useDragManager on mouseup over a drop zone
  handleDropRef.current = (target: DragDropTarget, payload: DragPayload) => {
    if (target.kind === "explorer") {
      if (payload.kind === "workspace-path") {
        const targetDirectoryPath = target.targetKind === "file" ? directoryOf(target.targetPath) : target.targetPath;
        void moveWorkspacePathIntoDirectory(payload.path, targetDirectoryPath).catch((error) => {
          console.error("[workspace] move failed", error);
        });
      }
      return;
    }

    if (payload.kind === "document") {
      handleDocumentDrop(target.leafId, target.edge, payload.filePath, payload.sourcePaneId);
    } else if (payload.kind === "workspace-path" && payload.nodeKind === "file") {
      handleDocumentDrop(target.leafId, target.edge, payload.path);
    } else if (payload.kind === "terminal") {
      handleTerminalDrop(target.leafId, target.edge, payload.sessionId);
    } else if (payload.kind === "browser") {
      handleBrowserDrop(target.leafId, target.edge, payload.url, payload.sourcePaneId);
    }
  };

  function handleDocumentDrop(leafId: PaneNodeId, edge: DropEdge, filePath: string, sourceLeafId?: string) {
    // Ensure the document content is loaded (may be a new file dragged from explorer)
    void ensureDocumentLoaded(filePath);
    const targetLeaf = findNode(editorTree, (n) => n.id === leafId && n.kind === "leaf") as PaneLeaf | undefined;
    const dropEdge = targetLeaf?.content.kind !== "editor" && edge === "center" ? "right" : edge;

    // All operations are within the editor tree only.
    const isEmptyEditor = (leaf: PaneLeaf) =>
      leaf.content.kind === "editor" && leaf.content.openPaths.length === 0;

    if (dropEdge === "center") {
      editorActions.setTree((prev) => {
        let tree = mapLeaves(prev, (leaf) => {
          if (leaf.content.kind !== "editor") return leaf;
          if (sourceLeafId && leaf.id === sourceLeafId && leaf.id !== leafId) {
            const remaining = leaf.content.openPaths.filter((p) => p !== filePath);
            return {
              ...leaf,
              content: {
                ...leaf.content,
                openPaths: remaining,
                activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath,
              },
            };
          }
          if (leaf.id === leafId) {
            return {
              ...leaf,
              content: {
                ...leaf.content,
                activePath: filePath,
                openPaths: leaf.content.openPaths.includes(filePath) ? leaf.content.openPaths : [...leaf.content.openPaths, filePath],
              },
            };
          }
          return leaf;
        });
        tree = pruneEmptyLeaves(tree, isEmptyEditor);
        return tree;
      });
      editorActions.focusLeaf(leafId);
      setActiveDocumentPath(filePath);
    } else {
      // Edge-drop within the source pane with only this doc would orphan one half — skip.
      if (sourceLeafId && sourceLeafId === leafId) {
        const src = findNode(editorTree, (n) => n.id === sourceLeafId) as PaneLeaf | undefined;
        if (src?.content.kind === "editor" && src.content.openPaths.length <= 1) {
          setActiveDocumentPath(filePath);
          return;
        }
      }

      const direction: "horizontal" | "vertical" = (dropEdge === "left" || dropEdge === "right") ? "horizontal" : "vertical";
      const position: "before" | "after" = (dropEdge === "left" || dropEdge === "top") ? "before" : "after";
      const newLeafId = `pane-${Date.now().toString(36)}`;
      const newContent: EditorPaneContent = { kind: "editor", openPaths: [filePath], activePath: filePath };

      editorActions.setTree((prev) => {
        const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: newContent };
        let tree = updateNode(prev, leafId, (node) => ({
          kind: "split" as const,
          id: `split-${Date.now().toString(36)}`,
          direction,
          ratio: 0.5,
          children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
        }));
        if (sourceLeafId) {
          tree = mapLeaves(tree, (leaf) => {
            if (leaf.id !== sourceLeafId || leaf.content.kind !== "editor") return leaf;
            const remaining = leaf.content.openPaths.filter((p) => p !== filePath);
            return {
              ...leaf,
              content: {
                ...leaf.content,
                openPaths: remaining,
                activePath: leaf.content.activePath === filePath ? (remaining.at(-1) ?? null) : leaf.content.activePath,
              },
            };
          });
        }
        return pruneEmptyLeaves(tree, isEmptyEditor);
      });
      editorActions.focusLeaf(newLeafId);
      setActiveDocumentPath(filePath);
    }
  }

  function handleTerminalDrop(leafId: PaneNodeId, edge: DropEdge, sessionId: string) {
    const targetInEditorTree = findNode(editorTree, (node) => node.id === leafId);
    const targetInTerminalTree = findNode(terminalTree, (node) => node.id === leafId);
    if (!targetInEditorTree && !targetInTerminalTree) {
      return;
    }

    editorActions.setTree((prev) => {
      const withoutSession = removeTerminalSessionFromTree(prev, sessionId);
      const moved = targetInEditorTree
        ? addTerminalSessionToTargetLeaf(withoutSession, leafId, edge, sessionId)
        : withoutSession;
      return pruneEmptyLeaves(moved, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
    });

    terminalActions.setTree((prev) => {
      const withoutSession = removeTerminalSessionFromTree(prev, sessionId);
      const moved = targetInTerminalTree
        ? addTerminalSessionToTargetLeaf(withoutSession, leafId, edge, sessionId)
        : withoutSession;
      return pruneEmptyLeaves(moved, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
    });

    if (targetInEditorTree) {
      editorActions.focusLeaf(leafId);
      if (treeContainsTerminalSession(terminalTree, sessionId) && countTerminalSessions(terminalTree) <= 1) {
        shellLayout.setTerminalCollapsed(true);
      }
    } else {
      shellLayout.setTerminalCollapsed(false);
      terminalActions.focusLeaf(leafId);
    }
    setActiveTerminalId(sessionId);
  }

  function handleBrowserDrop(leafId: PaneNodeId, edge: DropEdge, url: string, sourceLeafId: string) {
    const targetLeaf = findNode(editorTree, (node) => node.id === leafId && node.kind === "leaf") as PaneLeaf | undefined;
    if (!targetLeaf) {
      return;
    }
    if (sourceLeafId === leafId) {
      editorActions.focusLeaf(leafId);
      setZoomSurface("editor");
      return;
    }

    const browserContent: BrowserPaneContent = { kind: "browser", url };
    const dropEdge = targetLeaf.content.kind === "browser" ? edge : (edge === "center" ? "right" : edge);

    if (dropEdge === "center") {
      editorActions.setTree((prev) => {
        let tree = mapLeaves(prev, (leaf) =>
          leaf.id === leafId && leaf.content.kind === "browser"
            ? { ...leaf, content: browserContent }
            : leaf,
        );
        const withoutSource = removeNode(tree, sourceLeafId);
        tree = withoutSource ?? tree;
        return tree;
      });
      editorActions.focusLeaf(leafId);
      setZoomSurface("editor");
      return;
    }

    const direction: "horizontal" | "vertical" = (dropEdge === "left" || dropEdge === "right") ? "horizontal" : "vertical";
    const position: "before" | "after" = (dropEdge === "left" || dropEdge === "top") ? "before" : "after";
    const newLeafId = paneId();
    const newLeaf: PaneLeaf = { kind: "leaf", id: newLeafId, content: browserContent };

    editorActions.setTree((prev) => {
      let tree = updateNode(prev, leafId, (node) => ({
        kind: "split" as const,
        id: paneId(),
        direction,
        ratio: 0.5,
        children: (position === "before" ? [newLeaf, node as PaneLeaf] : [node as PaneLeaf, newLeaf]) as [PaneNode, PaneNode],
      }));
      const withoutSource = removeNode(tree, sourceLeafId);
      return withoutSource ?? tree;
    });
    editorActions.focusLeaf(newLeafId);
    setZoomSurface("editor");
  }

  if (!workspaceModel) {
    return (
      <div className="shell shell--loading">
        <div>Loading Exo…</div>
        {bootstrapError ? <div className="dialog-card__status dialog-card__status--error">{bootstrapError}</div> : null}
      </div>
    );
  }

  if (onboardingState) {
    const selectedWorkspace = onboardingState.workspaces.find((workspace) => workspace.id === onboardingState.selectedWorkspaceId) ?? null;
    return (
      <div className="onboarding-shell" data-testid="onboarding">
        <div className="onboarding-card">
          <div className="onboarding-card__eyebrow">
            {onboardingState.mode === "first-run" ? "First setup" : "Switch workspace"}
          </div>
          {onboardingState.step === "select" ? (
            <>
              <h1 className="onboarding-card__title">Select workspace</h1>
              <p className="onboarding-card__copy">
                Workspaces are saved notes folders with their own projects, terminal defaults, settings, and local index state.
              </p>
              <div className="workspace-picker" data-testid="workspace-picker">
                {onboardingState.workspaces.length > 0 ? (
                  onboardingState.workspaces.map((workspace) => (
                    <button
                      className={`workspace-picker__item${workspace.id === onboardingState.selectedWorkspaceId ? " workspace-picker__item--selected" : ""}`}
                      data-testid="workspace-picker-item"
                      key={workspace.id}
                      onClick={() =>
                        setOnboardingState((current) =>
                          current ? { ...current, selectedWorkspaceId: workspace.id, status: "idle", errorMessage: null } : current,
                        )
                      }
                      type="button"
                    >
                      <span className="workspace-picker__name">{workspace.label}</span>
                      <span className="workspace-picker__path">{workspace.notesFolder}</span>
                    </button>
                  ))
                ) : (
                  <div className="path-list__empty" data-testid="workspace-picker-empty">No workspaces yet.</div>
                )}
              </div>
              {selectedWorkspace ? (
                <div className="onboarding-section onboarding-section--summary" data-testid="workspace-picker-detail">
                  <div className="dialog-field__label">{selectedWorkspace.label}</div>
                  <div className="onboarding-section__hint">{selectedWorkspace.notesFolder}</div>
                  <div className="workspace-picker__meta">
                    {selectedWorkspace.settings.projectRoots.length} project{selectedWorkspace.settings.projectRoots.length === 1 ? "" : "s"}
                    {" | "}
                    index {selectedWorkspace.settings.indexing.mode}
                    {" | "}
                    terminal {pathLabel(selectedWorkspace.settings.defaultTerminalCwd)}
                  </div>
                </div>
              ) : null}
              <div className="onboarding-card__actions">
                {onboardingState.mode === "switch" ? (
                  <button className="toolbar-button" onClick={() => setOnboardingState(null)} type="button">
                    Cancel
                  </button>
                ) : null}
                <button className="toolbar-button" data-testid="workspace-picker-new" onClick={startNewWorkspaceSetup} type="button">
                  New workspace
                </button>
                <button
                  className="toolbar-button toolbar-button--primary"
                  data-testid="workspace-picker-open"
                  disabled={!onboardingState.selectedWorkspaceId || onboardingState.status === "saving"}
                  onClick={() => void activateSelectedWorkspace()}
                  type="button"
                >
                  {onboardingState.status === "saving" ? "Opening…" : "Open workspace"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="onboarding-card__title">New workspace</h1>
              <p className="onboarding-card__copy">
                Choose a notes folder first, then confirm the default terminal, projects, and local index mode.
              </p>
              <div className="onboarding-grid">
                <div className="onboarding-section onboarding-section--primary">
                  <div className="onboarding-section__header">
                    <div>
                      <div className="dialog-field__label">Notes folder</div>
                      <div className="onboarding-section__hint">Required. This Markdown folder identifies the workspace.</div>
                    </div>
                    <button className="toolbar-button" data-testid="onboarding-choose-notes" onClick={() => void selectNotesFolderForOnboarding()} type="button">
                      Select
                    </button>
                  </div>
                  <PathList
                    emptyLabel="No notes folder selected."
                    paths={onboardingState.notesFolder ? [onboardingState.notesFolder] : []}
                    testId="onboarding-notes-folder"
                    onRemove={() =>
                      setOnboardingState((current) =>
                        current ? { ...current, notesFolder: "", status: "idle", errorMessage: null } : current,
                      )
                    }
                  />
                </div>
                <div className="onboarding-section">
                  <div className="onboarding-section__header">
                    <div>
                      <div className="dialog-field__label">Project folders</div>
                      <div className="onboarding-section__hint">Optional code folders for terminals, review, and agents.</div>
                    </div>
                    <button className="toolbar-button toolbar-button--icon" data-testid="onboarding-add-project" onClick={() => void addProjectFoldersForOnboarding()} type="button">
                      <Plus size={15} />
                    </button>
                  </div>
                  <PathList
                    emptyLabel="No project folders added."
                    paths={onboardingState.projectFolders}
                    testId="onboarding-project-folders"
                    onRemove={(targetPath) =>
                      setOnboardingState((current) =>
                        current
                          ? {
                              ...current,
                              projectFolders: current.projectFolders.filter((entry) => entry !== targetPath),
                              status: "idle",
                              errorMessage: null,
                            }
                          : current,
                      )
                    }
                  />
                </div>
                <div className="onboarding-section">
                  <div className="onboarding-section__header">
                    <div>
                      <div className="dialog-field__label">Default terminal</div>
                      <div className="onboarding-section__hint">Where new shell, Claude, and Codex sessions start.</div>
                    </div>
                    <button className="toolbar-button" data-testid="onboarding-choose-terminal" onClick={() => void selectDefaultTerminalForOnboarding()} type="button">
                      Select
                    </button>
                  </div>
                  <PathList
                    emptyLabel={onboardingState.projectFolders[0] || onboardingState.notesFolder || "Defaults to your notes folder."}
                    paths={onboardingState.defaultTerminalCwd ? [onboardingState.defaultTerminalCwd] : []}
                    testId="onboarding-terminal-folder"
                    onRemove={() =>
                      setOnboardingState((current) =>
                        current ? { ...current, defaultTerminalCwd: "", status: "idle", errorMessage: null } : current,
                      )
                    }
                  />
                </div>
                <div className="onboarding-section onboarding-section--index">
                  <div className="onboarding-section__header">
                    <div>
                      <div className="dialog-field__label">Knowledge index</div>
                      <div className="onboarding-section__hint">Optional local search over the notes folder. Hybrid uses embeddings.</div>
                    </div>
                    <select
                      className="dialog-card__input onboarding-select"
                      data-testid="onboarding-index-mode"
                      value={onboardingState.indexMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as WorkspaceSettings["indexing"]["mode"];
                        setOnboardingState((current) =>
                          current
                            ? {
                                ...current,
                                indexMode: nextMode,
                                exploreIndexSearchOnEnter: nextMode !== "off",
                                status: "idle",
                                errorMessage: null,
                              }
                            : current,
                        );
                      }}
                    >
                      <option value="off">Off</option>
                      <option value="lexical">Lexical</option>
                      <option value="semantic">Semantic</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                  {onboardingState.indexMode !== "off" ? (
                    <label className="dialog-check">
                      <input
                        checked={onboardingState.exploreIndexSearchOnEnter}
                        data-testid="onboarding-index-enter"
                        onChange={(event) =>
                          setOnboardingState((current) =>
                            current ? { ...current, exploreIndexSearchOnEnter: event.target.checked } : current,
                          )
                        }
                        type="checkbox"
                      />
                      <span>Use indexed search when pressing Enter in Explore.</span>
                    </label>
                  ) : null}
                </div>
              </div>
              <div className="onboarding-card__actions">
                {onboardingState.workspaces.length > 0 || onboardingState.mode === "switch" ? (
                  <button
                    className="toolbar-button"
                    onClick={() =>
                      setOnboardingState((current) =>
                        current ? { ...current, step: "select", status: "idle", errorMessage: null } : current,
                      )
                    }
                    type="button"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  className="toolbar-button toolbar-button--primary"
                  data-testid="onboarding-continue"
                  disabled={!onboardingState.notesFolder.trim() || onboardingState.status === "saving"}
                  onClick={() => void completeOnboarding()}
                  type="button"
                >
                  {onboardingState.status === "saving" ? "Setting up…" : "Create workspace"}
                </button>
              </div>
            </>
          )}
          {onboardingState.errorMessage ? (
            <div className="dialog-card__status dialog-card__status--error">{onboardingState.errorMessage}</div>
          ) : null}
        </div>
      </div>
    );
  }

  const indexStatusLine = summarizeIndexStatus(indexStatus, indexBusy);

  return (
    <>
      <ShellLayout
      noteSections={noteSections}
      projectSections={projectSections}
      appearanceMode={appearanceMode}
      resolvedAppearance={resolvedAppearance}
      searchQuery={workspaceSearch.query}
      searchResults={workspaceSearch.results}
      searchResultMode={workspaceSearch.resultMode}
      searchResultQuery={workspaceSearch.resultQuery}
      searchMessage={workspaceSearch.message}
      projectChanges={projectReviewChanges}
      statusLine={{
        workspaceLabel: workspaceModel ? pathLabel(workspaceModel.workspaceRoot) : "workspace",
        projectLabel: workspaceModel?.projectRoots[0] ? pathLabel(workspaceModel.projectRoots[0].path) : null,
        gitBranch: projectReviewState.workspaceGitStatus?.branch ?? null,
        gitDirty: projectReviewState.workspaceGitStatus?.dirty ?? false,
        changedFiles: projectReviewChanges.length,
        index: indexStatusLine,
      }}
      shellLayout={shellLayout}
      revealExplorerPathRequest={revealExplorerPathRequest}
      renderEditorLeaf={(leaf, isFocused) => {
        if (leaf.content.kind === "browser") {
          return (
            <BrowserPane
              paneId={leaf.id}
              url={leaf.content.url}
              compact={compactEditorChrome}
              onFocus={() => {
                setZoomSurface("editor");
                editorActions.focusLeaf(leaf.id);
              }}
              onNavigate={(url) => {
                editorActions.updateLeafContent(leaf.id, (content) =>
                  content.kind === "browser" ? { ...content, url } : content,
                );
              }}
              onClosePane={collectLeaves(editorTree).length > 1 ? () => editorActions.removeLeaf(leaf.id) : null}
              dragManager={dragManager}
            />
          );
        }
        if (leaf.content.kind === "terminal") {
          const terminalLeafSessions = terminalSessions.filter((s) => leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(s.id));
          return (
            <TerminalDock
              placement="right"
              paneId={leaf.id}
              compact={compactEditorChrome}
              empty={terminalLeafSessions.length === 0}
              sessions={terminalLeafSessions}
              activeTerminalId={leaf.content.activeTerminalId}
              hydrationSnapshots={terminalHydrationSnapshots}
              hydrationVersions={terminalHydrationVersions}
              appearance={resolvedAppearance}
              fontSize={terminalFontSize}
              scrollbackLines={terminalRuntimeScrollbackLines}
              onFocus={() => {
                setZoomSurface("terminal");
                editorActions.focusLeaf(leaf.id);
              }}
              onSetActiveTerminal={(id) => {
                setZoomSurface("terminal");
                editorActions.updateLeafContent(leaf.id, (content) =>
                  content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
                );
                setActiveTerminalId(id);
                void hydrateTerminal(id);
              }}
              onWrite={(id, data) => void window.exo.terminals.write(id, data)}
              onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
              onKill={(id) => void closeTerminal(id)}
              dragManager={dragManager}
              onTogglePlacement={() => {}}
              headerActions={null}
            />
          );
        }
        const pane: EditorPaneState = {
          id: leaf.id,
          openPaths: leaf.content.openPaths,
          activePath: leaf.content.activePath,
        };
        return (
          <>
            <EditorPane
              key={leaf.id}
              pane={pane}
              documents={openDocuments}
              saveStatuses={documentSaveStatuses}
              branchFamiliesByPath={branchFamiliesByPath}
              propertiesCollapsed={propertiesCollapsed}
              isFocused={isFocused}
              onFocusPane={() => {
                setZoomSurface("editor");
                focusEditorPane(leaf.id);
              }}
              onActivateTab={(filePath) => setPaneActivePath(leaf.id, filePath)}
              onCloseTab={(filePath) => closeDocumentInPane(leaf.id, filePath)}
              onClosePane={collectLeaves(editorTree).length > 1 ? () => editorActions.removeLeaf(leaf.id) : null}
              dragManager={dragManager}
              onToggleProperties={() => setPropertiesCollapsed((current) => !current)}
              onUpdateFrontmatter={updateFrontmatter}
              onBodyChange={updateBody}
              onSave={() => void (leaf.content.kind === "editor" && leaf.content.activePath ? saveDocument(leaf.content.activePath) : Promise.resolve())}
              onOpenTag={(tag) => void openTag(tag)}
              onOpenTarget={(target) => void openKnowledgeTarget(target)}
              onOpenBranch={(filePath) => void openFile(filePath, leaf.id)}
              onSuggestTargets={(query) => suggestNoteTargets(query)}
              onCreateBranch={() => void createBranchFromActiveDocument()}
              appearance={resolvedAppearance}
              fontSize={editorFontSize}
              onZoomEditor={(direction) => updateFocusedSurfaceZoom(direction, "editor")}
              compact={compactEditorChrome}
              revealLineRequest={editorRevealLineRequest}
              scrollRestoreRequest={editorScrollRestoreRequest}
            />
            <InspectorDock
              document={activeDocument}
              knowledge={activeKnowledge}
              open={!shellLayout.inspectorCollapsed}
              activeTag={activeTag}
              tagResults={tagResults}
              onToggle={() => shellLayout.setInspectorCollapsed((c) => !c)}
              onOpenTarget={(target) => void openKnowledgeTarget(target)}
              onOpenExternal={(target) => void window.exo.shell.openExternal(target)}
              onOpenTag={(tag) => void openTag(tag)}
            />
          </>
        );
      }}
      renderTerminalLeaf={(leaf) => {
        const terminalLeafSessions = terminalSessions.filter((s) => leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(s.id));
        const leafActiveTerminalId = leaf.content.kind === "terminal" ? leaf.content.activeTerminalId : null;
        return (
          <TerminalDock
            placement="right"
            paneId={leaf.id}
            compact={false}
            empty={terminalLeafSessions.length === 0}
            sessions={terminalLeafSessions}
            activeTerminalId={leafActiveTerminalId}
            hydrationSnapshots={terminalHydrationSnapshots}
            hydrationVersions={terminalHydrationVersions}
            appearance={resolvedAppearance}
            fontSize={terminalFontSize}
            scrollbackLines={terminalRuntimeScrollbackLines}
            onFocus={() => setZoomSurface("terminal")}
            onSetActiveTerminal={(id) => {
              setZoomSurface("terminal");
              void activateTerminal(leaf.id, id);
            }}
            onWrite={(id, data) => void window.exo.terminals.write(id, data)}
            onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
            onKill={(id) => void closeTerminal(id)}
            dragManager={dragManager}
            onTogglePlacement={() => {}}
            headerActions={null}
          />
        );
      }}
      onAppearanceModeChange={updateAppearanceMode}
      onOpenWorkspaceSettings={() => void openWorkspaceSettingsDialog()}
      onOpenIndexSettings={() => void openWorkspaceSettingsDialog("index")}
      onOpenProjectChanges={() => void openProjectChangesFromStatus()}
      onSearchQueryChange={(value) => {
        workspaceSearch.setQuery(value);
        workspaceSearch.setSubmittedQuery(value.trim());
      }}
      onSearchSubmit={() => void workspaceSearch.runIndexedSearch()}
      onOpenFile={(filePath, line) => void openFile(filePath, undefined, { line })}
      onOpenTerminalSession={(sessionId) => void focusTerminalSession(sessionId)}
      onOpenTag={(tag) => void openTag(tag)}
      onExpandDirectory={(directoryPath, rootKind) => void workspaceTrees.expandTreeDirectory(directoryPath, rootKind)}
      explorerScale={explorerScale}
      onFocusExplorer={() => setZoomSurface("explorer")}
      dragManager={dragManager}
      onCreateFile={(directoryPath) => createFileInDirectory(directoryPath)}
      onCreateDirectory={(directoryPath) => createDirectoryInDirectory(directoryPath)}
      onCreateTerminalInDirectory={(directoryPath) => void createTerminal("shell", directoryPath)}
      onRenamePath={(targetPath) => renameWorkspacePath(targetPath)}
      onDeletePath={(targetPath) => deleteWorkspacePath(targetPath)}
      onCreateTerminal={(kind) => void createTerminal(kind)}
      onCreateBrowserPane={() => createBrowserPane()}
      />

      {workspaceDialog ? (
        <div className="dialog-overlay" data-testid="workspace-dialog-overlay">
          <div className="dialog-card" data-testid="workspace-dialog">
            <div className="dialog-card__title">{workspaceDialog.title}</div>
            {"message" in workspaceDialog ? <div className="dialog-card__message">{workspaceDialog.message}</div> : null}
            {"value" in workspaceDialog ? (
              <input
                autoFocus
                className="dialog-card__input"
                data-testid="workspace-dialog-input"
                value={workspaceDialog.value}
                onChange={(event) =>
                  setWorkspaceDialog((current) => (current && "value" in current ? { ...current, value: event.target.value } : current))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitWorkspaceDialog();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setWorkspaceDialog(null);
                  }
                }}
              />
            ) : null}
            <div className="dialog-card__actions">
              <button className="toolbar-button" onClick={() => setWorkspaceDialog(null)} type="button">
                Cancel
              </button>
              <button
                className={`toolbar-button ${workspaceDialog.kind === "delete" ? "toolbar-button--danger" : ""}`}
                data-testid="workspace-dialog-confirm"
                onClick={() => void submitWorkspaceDialog()}
                type="button"
              >
                {workspaceDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {workspaceSettingsDialog ? (
        <WorkspaceSettingsDialog
          agentInstructionEditor={agentInstructionEditor}
          indexBusy={indexBusy}
          indexStatus={indexStatus}
          partialErrors={workspaceSettingsPartialErrors}
          settings={workspaceSettingsDialog}
          setSettings={setWorkspaceSettingsDialog}
          structuralDraftKey={workspaceSettingsStructuralDraftKey}
          onChooseFolder={(target) => void chooseFolderForSettings(target)}
          onClose={closeWorkspaceSettingsDialog}
          onOpenAgentConfigEditor={() => void openAgentContextManager()}
          onOpenWorkspaceSwitcher={() => void openWorkspaceSwitcher()}
          onRunIndexUpdate={(kind) => void runIndexUpdate(kind)}
          onSave={(settingsDialog, options) => void saveWorkspaceSettingsDialog(settingsDialog, options)}
        />
      ) : null}
      {agentContextManagerOpen ? (
        <AgentConfigEditorDialog
          editor={agentInstructionEditor}
          onClose={() => setAgentContextManagerOpen(false)}
        />
      ) : null}
    </>
  );
}

function isZoomKey(key: string): boolean {
  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0";
}

function zoomDirection(key: string): -1 | 0 | 1 {
  if (key === "-" || key === "_") {
    return -1;
  }
  if (key === "0") {
    return 0;
  }
  return 1;
}

function resolveZoomSurface(event: KeyboardEvent): ZoomSurface {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof Element)) {
      continue;
    }
    if (entry.closest(".terminal-dock, .terminal-surface")) {
      return "terminal";
    }
    if (entry.closest(".editor-pane, .editor-panel, .cm-editor")) {
      return "editor";
    }
    if (entry.closest(".sidebar")) {
      return "explorer";
    }
  }

  const activeElement = document.activeElement;
  if (activeElement?.closest(".terminal-dock, .terminal-surface")) {
    return "terminal";
  }
  if (activeElement?.closest(".editor-pane, .editor-panel, .cm-editor")) {
    return "editor";
  }
  if (activeElement?.closest(".sidebar")) {
    return "explorer";
  }
  return "editor";
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
}

function createWorkspaceLayoutSnapshot(input: WorkspaceLayoutSettings): WorkspaceLayoutSettings {
  return {
    editorTree: input.editorTree,
    terminalTree: input.terminalTree,
    terminalCollapsed: input.terminalCollapsed,
    sidePanesFlipped: input.sidePanesFlipped,
    zoneSplitRatio: roundLayoutNumber(input.zoneSplitRatio),
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: Math.round(input.sidebarWidth),
    inspectorCollapsed: input.inspectorCollapsed,
  };
}

function roundLayoutNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function pruneRecordToKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const entries = Object.entries(record).filter(([key]) => keys.has(key));
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
}

function formatIndexStatus(status: IndexStatus): string {
  const pieces = [
    `Mode: ${status.mode}`,
    `${status.indexedRoots.length} root${status.indexedRoots.length === 1 ? "" : "s"}`,
    `${status.documentCount} document${status.documentCount === 1 ? "" : "s"}`,
  ];
  if (status.pendingEmbeddings > 0) {
    pieces.push(`${status.pendingEmbeddings} pending embeddings`);
  }
  return pieces.join(" | ");
}

function summarizeIndexStatus(status: IndexStatus | null, busy: IndexBusyState): {
  label: string;
  tone: "muted" | "ok" | "warn" | "info" | "error";
  title: string;
  busy: boolean;
} {
  if (busy === "updating") {
    return { label: "Re-indexing", tone: "info", title: "Updating the local knowledge index.", busy: true };
  }
  if (busy === "syncing") {
    return { label: "Syncing index", tone: "info", title: "Refreshing documents and embeddings for the local knowledge index.", busy: true };
  }
  if (busy === "embedding") {
    return { label: "Embedding", tone: "info", title: "Building semantic embeddings for the local knowledge index.", busy: true };
  }
  if (!status) {
    return { label: "Index unknown", tone: "muted", title: "Index status has not loaded yet.", busy: false };
  }
  if (status.errors.length > 0) {
    return { label: "Index error", tone: "error", title: status.errors.join("\n"), busy: false };
  }
  if (!status.enabled || status.mode === "off" || status.indexedRoots.length === 0) {
    return { label: "Index not set up", tone: "warn", title: "Enable the local QMD index in Workspace Settings.", busy: false };
  }
  if (status.documentCount === 0) {
    return { label: "Index empty", tone: "warn", title: "The index is configured but has no documents yet.", busy: false };
  }
  if ((status.mode === "semantic" || status.mode === "hybrid") && (!status.hasVectorIndex || status.pendingEmbeddings > 0)) {
    return { label: "Embeddings needed", tone: "warn", title: formatIndexStatus(status), busy: false };
  }
  return { label: "Index ready", tone: "ok", title: formatIndexStatus(status), busy: false };
}

function joinPath(parentPath: string, name: string): string {
  return `${parentPath.replace(/\/$/, "")}/${name.replace(/^\//, "")}`;
}

function isInsideAttachedRoot(targetPath: string, rootPaths: string[]): boolean {
  return rootPaths.some((rootPath) => isPathWithin(rootPath, targetPath));
}

function ensureDefaultExtension(name: string, directoryPath: string, noteRootPaths: string[]): string {
  if (name.includes(".")) {
    return name;
  }

  return isInsideAttachedRoot(directoryPath, noteRootPaths) ? `${name}.md` : name;
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

function getEditorScrollTopForPath(filePath: string): number | null {
  const scroller = getEditorScrollerForPath(filePath);
  return scroller ? scroller.scrollTop : null;
}

function getEditorScrollerForPath(filePath: string): HTMLElement | null {
  for (const title of document.querySelectorAll<HTMLElement>(".editor-panel__title[title]")) {
    if (title.title !== filePath) {
      continue;
    }
    return title.closest(".editor-pane")?.querySelector<HTMLElement>(".editor-surface .cm-scroller") ?? null;
  }
  return null;
}
