import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type {
  IndexStatus,
  SearchResult,
  WorkspaceModel,
  WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo } from "../../shared/api";

import type { AppearanceMode, ResolvedAppearance } from "./appearance";
import { AgentConfigEditorDialog } from "./components/AgentConfigEditorDialog";
import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { BrowserPane } from "./components/BrowserPane";
import { InspectorDock } from "./components/InspectorDock";
import { PathList } from "./components/PathList";
import { PluginManagerDialog } from "./components/PluginManagerDialog";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { WorkspaceSettingsDialog } from "./components/WorkspaceSettingsDialog";
import { useAgentInstructionEditor } from "./hooks/useAgentInstructionEditor";
import { useAppKeybindings } from "./hooks/useAppKeybindings";
import { useOpenDocuments } from "./hooks/useOpenDocuments";
import { usePaneDropOrchestration } from "./hooks/usePaneDropOrchestration";
import { useProjectReviewState } from "./hooks/useProjectReviewState";
import { useShellLayout } from "./hooks/useShellLayout";
import { useTerminalPaneController, type TerminalPaneController } from "./hooks/useTerminalPaneController";
import { useTerminalSessions } from "./hooks/useTerminalSessions";
import { useWorkspaceBootstrap } from "./hooks/useWorkspaceBootstrap";
import { useWorkspaceCommandHandlers } from "./hooks/useWorkspaceCommandHandlers";
import { useWorkspaceLayoutPersistence } from "./hooks/useWorkspaceLayoutPersistence";
import { useWorkspaceMutations } from "./hooks/useWorkspaceMutations";
import { useWorkspaceSettingsController } from "./hooks/useWorkspaceSettingsController";
import { useWorkspaceTrees } from "./hooks/useWorkspaceTrees";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { applyTheme } from "./theme/applyTheme";
import { DEFAULT_COLOR_THEME_ID, resolveTheme } from "./theme/registry";
import type { ColorThemeId } from "./theme/types";
import { collectLeaves, findEditorLeaf, findNode, mapLeaves, paneId, pruneEmptyLeaves, updateNode, type PaneLeaf, type PaneNode, type PaneNodeId } from "./hooks/usePaneTree";
import {
  addTerminalSessionToFirstLeaf,
  collectActiveTerminalIds,
  collectOpenEditorPaths,
  collectTerminalSessionIds,
  findActiveEditorPath,
  pruneStaleTerminalSessions,
} from "./paneTreeSelectors";
import {
  clampNumber,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_READ_TAIL_CHARS,
  resolveSettingsTerminalRuntime,
  workspaceSettingsStructuralDraftKey,
} from "./workspaceSettingsModel";
import { pathLabel } from "./workspaceTree";
import type { IndexBusyState } from "./workspaceSettingsDialogTypes";
import { getPreviewTitle, markdownPreviewExcerpt, suggestWikilinkTargetsFromTrees } from "./graphAffordances";

type ZoomSurface = "editor" | "terminal" | "explorer";

const NOTE_TREE_MAX_DEPTH = 3;
const PROJECT_TREE_MAX_DEPTH = 3;

export function App() {
  const workspaceTrees = useWorkspaceTrees({ noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH, projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH });
  const { noteTrees, projectTrees } = workspaceTrees;
  const [exploreIndexSearchOnEnter, setExploreIndexSearchOnEnter] = useState(false);
  const workspaceSearch = useWorkspaceSearch({ indexedOnEnter: exploreIndexSearchOnEnter });
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [revealExplorerPathRequest, setRevealExplorerPathRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [editorRevealLineRequest, setEditorRevealLineRequest] = useState<{ filePath: string; line: number; nonce: number } | null>(null);
  const [agentContextManagerOpen, setAgentContextManagerOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const agentInstructionEditor = useAgentInstructionEditor();
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system");
  const [colorThemeId, setColorThemeId] = useState<ColorThemeId>(DEFAULT_COLOR_THEME_ID);
  const [zoomSurface, setZoomSurface] = useState<ZoomSurface>("editor");
  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [terminalRuntimeScrollbackLines, setTerminalRuntimeScrollbackLines] = useState(DEFAULT_TERMINAL_HISTORY_LINES);
  const [terminalRuntimeReadTailChars, setTerminalRuntimeReadTailChars] = useState(DEFAULT_TERMINAL_READ_TAIL_CHARS);
  const [explorerScale, setExplorerScale] = useState(DEFAULT_EXPLORER_SCALE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const terminalRuntimeScrollbackLinesRef = useRef(DEFAULT_TERMINAL_HISTORY_LINES);
  const terminalPaneControllerRef = useRef<TerminalPaneController | null>(null);
  const shellLayout = useShellLayout();

  const { tree: editorTree, focusedLeafId: editorFocusedLeafId, actions: editorActions } = shellLayout.editorPaneTree;
  const { tree: terminalTree, focusedLeafId: terminalFocusedLeafId, actions: terminalActions } = shellLayout.terminalPaneTree;
  const terminalState = useTerminalSessions({
    maxPendingDataChars: terminalRuntimeReadTailChars,
    onExternalSessions: (sessions, options) => {
      terminalPaneControllerRef.current?.attachExternalTerminalSessions(sessions, options);
    },
  });
  const {
    sessions: terminalSessions,
    activeTerminalId,
    hydrationSnapshots: terminalHydrationSnapshots,
    hydrationVersions: terminalHydrationVersions,
    hydrationReasons: terminalHydrationReasons,
  } = terminalState;
  const terminalPaneController = useTerminalPaneController({
    editorTree,
    terminalTree,
    editorFocusedLeafId,
    terminalFocusedLeafId,
    editorActions,
    terminalActions,
    terminalState,
    setTerminalCollapsed: shellLayout.setTerminalCollapsed,
    setZoomSurface,
  });
  terminalPaneControllerRef.current = terminalPaneController;
  const workspaceBootstrap = useWorkspaceBootstrap({
    noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH,
    projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH,
    applyWorkspaceSettings,
    applyPersistedLayout: shellLayout.applyPersistedLayout,
    setIndexStatus,
    replaceTreesForModel: workspaceTrees.replaceTreesForModel,
    restoreInitialDocuments,
    restoreTerminals,
  });
  const {
    workspaceModel,
    setWorkspaceModel,
    onboardingState,
    setOnboardingState,
    bootstrapError,
    layoutPersistenceReady,
    setLayoutPersistenceReady,
    workspaceSettingsRef,
  } = workspaceBootstrap;
  const workspaceSettingsController = useWorkspaceSettingsController({
    workspaceSettingsRef,
    applyWorkspaceSettings,
    refreshWorkspaceModel,
    setIndexStatus,
  });
  const {
    dialog: workspaceSettingsDialog,
    setDialog: setWorkspaceSettingsDialog,
    indexBusy,
  } = workspaceSettingsController;
  const projectReviewState = useProjectReviewState(workspaceModel, terminalSessions);
  const openDocumentsState = useOpenDocuments({
    workspaceModel,
    getOpenEditorPaths: () => collectOpenEditorPaths(shellLayout.editorPaneTree.tree),
    getEditorScrollTopForPath,
  });
  const {
    openDocuments,
    knowledgeByPath,
    documentSaveStatuses,
    branchFamiliesByPath,
    activeDocumentPath,
    activeDocument,
    activeKnowledge,
    scrollRestoreRequest: editorScrollRestoreRequest,
    setActiveDocumentPath,
    ensureDocumentLoaded,
    scheduleRefresh: scheduleOpenDocumentRefresh,
    updateBody,
    updateFrontmatter,
    saveDocument,
  } = openDocumentsState;
  const workspaceMutations = useWorkspaceMutations({
    workspaceModel,
    activeDocumentPath,
    editorFocusedLeafId,
    reloadTrees,
    openFile,
    openWorkspaceSettings: () => workspaceSettingsController.openDialog("workspace"),
    remapOpenPaths: remapOpenPathsInEditor,
    removeDeletedPaths: removeDeletedPathsFromEditor,
    setActiveDocumentPath,
    resolveActiveEditorPathAfterDelete,
    revealExplorerPath: (path) => setRevealExplorerPathRequest({ path, nonce: Date.now() }),
  });
  const { dialog: workspaceDialog, setDialog: setWorkspaceDialog } = workspaceMutations;
  const dragManager = usePaneDropOrchestration({
    editorTree,
    terminalTree,
    editorActions,
    terminalActions,
    setTerminalCollapsed: shellLayout.setTerminalCollapsed,
    setActiveTerminalId: terminalState.setActiveTerminalId,
    setActiveDocumentPath,
    setZoomSurface,
    ensureDocumentLoaded,
    moveWorkspacePathIntoDirectory: workspaceMutations.moveWorkspacePathIntoDirectory,
  });
  const compactEditorChrome = collectLeaves(editorTree).length > 1;
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;
  const resolvedTheme = useMemo(() => resolveTheme(colorThemeId, resolvedAppearance), [colorThemeId, resolvedAppearance]);

  useEffect(() => {
    terminalRuntimeScrollbackLinesRef.current = terminalRuntimeScrollbackLines;
  }, [terminalRuntimeScrollbackLines]);

  useEffect(() => {
    const openPaths = collectOpenEditorPaths(editorTree);
    openDocumentsState.pruneToOpenPaths(openPaths);
  }, [editorTree]);

  useEffect(() => {
    const activeTerminalIds = collectActiveTerminalIds(editorTree);
    for (const id of collectActiveTerminalIds(terminalTree)) {
      activeTerminalIds.add(id);
    }
    if (activeTerminalId) {
      activeTerminalIds.add(activeTerminalId);
    }
    terminalState.pruneHydration(activeTerminalIds);
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
    applyTheme(document.documentElement, resolvedTheme);
  }, [appearanceMode, resolvedAppearance, resolvedTheme]);

  useWorkspaceLayoutPersistence({
    editorTree,
    terminalTree,
    terminalCollapsed: shellLayout.terminalCollapsed,
    sidePanesFlipped: shellLayout.sidePanesFlipped,
    zoneSplitRatio: shellLayout.zoneSplitRatio,
    sidebarCollapsed: shellLayout.sidebarCollapsed,
    sidebarWidth: shellLayout.sidebarWidth,
    inspectorCollapsed: shellLayout.inspectorCollapsed,
    layoutPersistenceReady,
    onboardingActive: Boolean(onboardingState),
    workspaceModel,
    workspaceSettingsRef,
  });

  useWorkspaceCommandHandlers({
    workspaceModel,
    openFile,
    openPreview: createBrowserPane,
    focusPreview: focusBrowserPane,
    closePreview: closeBrowserPane,
    openSettings: workspaceSettingsController.openDialog,
    reloadTrees,
    scheduleOpenDocumentRefresh,
    recordObservedWorkspaceWrite: projectReviewState.recordObservedWorkspaceWrite,
    refreshProjectGitStatus: projectReviewState.refreshProjectGitStatus,
  });

  useAppKeybindings({
    activeDocumentPath,
    zoomSurface,
    saveDocument,
    openOrCreateDailyNote,
    updateFocusedSurfaceZoom,
  });

  function applyWorkspaceSettings(settings: WorkspaceSettings) {
    const terminalPolicy = resolveSettingsTerminalRuntime(settings);
    setAppearanceMode(settings.appearanceMode);
    setColorThemeId(settings.colorThemeId);
    setEditorFontSize(settings.editorFontSize);
    setTerminalFontSize(settings.terminalFontSize);
    setTerminalRuntimeScrollbackLines(terminalPolicy.scrollbackLines);
    setTerminalRuntimeReadTailChars(terminalPolicy.readTailChars);
    setExplorerScale(settings.explorerScale);
    setExploreIndexSearchOnEnter(settings.exploreIndexSearchOnEnter);
  }

  async function restoreInitialDocuments(input: {
    settings: WorkspaceSettings;
    firstNotePath: string | null;
  }) {
    if (!input.firstNotePath) {
      return;
    }

    const restoredPaths = input.settings.layout
      ? collectOpenEditorPaths(input.settings.layout.editorTree as PaneNode)
      : new Set<string>();
    if (restoredPaths.size > 0) {
      await Promise.all(
        Array.from(restoredPaths).map((filePath) =>
          ensureDocumentLoaded(filePath).catch((error) => {
            console.warn("[exo] failed to restore open document", { filePath, error });
          }),
        ),
      );
      const restoredActivePath = findActiveEditorPath(input.settings.layout?.editorTree as PaneNode | undefined);
      setActiveDocumentPath(restoredActivePath ?? restoredPaths.values().next().value ?? input.firstNotePath);
      return;
    }

    await openFile(input.firstNotePath, editorFocusedLeafId);
  }

  function restoreTerminals(input: {
    settings: WorkspaceSettings;
    sessions: TerminalSessionInfo[];
    defaultTerminalId: string;
    defaultTerminalSnapshot: string;
  }) {
    const sessionIds = input.sessions.map((session) => session.id);
    const sessionIdSet = new Set(sessionIds);
    const persistedActiveTerminalId = findPersistedActiveTerminalId(input.settings.layout, sessionIdSet);
    const restoredActiveTerminalId = persistedActiveTerminalId ?? input.sessions.at(-1)?.id ?? input.defaultTerminalId;
    terminalState.initialize(
      input.sessions,
      restoredActiveTerminalId,
      restoredActiveTerminalId === input.defaultTerminalId ? input.defaultTerminalSnapshot : undefined,
    );

    const restoreTerminalsInEditor = Boolean(input.settings.layout?.terminalCollapsed && input.settings.layout.editorTree);
    const persistedEditorTerminalIds = input.settings.layout
      ? collectTerminalSessionIds(input.settings.layout.editorTree as PaneNode)
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
  }

  function updateAppearanceMode(nextMode: AppearanceMode) {
    setAppearanceMode(nextMode);
    void workspaceSettingsController.saveSettingsPatch({ appearanceMode: nextMode });
  }

  function updateFocusedSurfaceZoom(direction: -1 | 0 | 1, surface = zoomSurface) {
    if (surface === "terminal") {
      setTerminalFontSize((current) => {
        const next = direction === 0 ? DEFAULT_TERMINAL_FONT_SIZE : clampNumber(current + direction, 10, 22);
        void workspaceSettingsController.saveSettingsPatch({ terminalFontSize: next });
        return next;
      });
      return;
    }
    if (surface === "explorer") {
      setExplorerScale((current) => {
        const next = direction === 0 ? DEFAULT_EXPLORER_SCALE : clampNumber(Number((current + direction * 0.06).toFixed(2)), 0.82, 1.35);
        void workspaceSettingsController.saveSettingsPatch({ explorerScale: next });
        return next;
      });
      return;
    }
    setEditorFontSize((current) => {
      const next = direction === 0 ? DEFAULT_EDITOR_FONT_SIZE : clampNumber(current + direction, 11, 24);
      void workspaceSettingsController.saveSettingsPatch({ editorFontSize: next });
      return next;
    });
  }

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
      workspaceMutations.showAttachProjectDialog();
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

  async function openFile(filePath: string, leafId?: PaneNodeId, options?: { line?: number | null }) {
    const targetLeafId = leafId ?? editorFocusedLeafId;
    await ensureDocumentLoaded(filePath);

    // File opens should never be trapped by a focused browser/terminal leaf.
    // Prefer the requested editor leaf, then any editor leaf, then recover by
    // converting the focused/first leaf back into an editor leaf.
    const targetLeaf = findNode(editorTree, (n) => n.id === targetLeafId && n.kind === "leaf") as PaneLeaf | undefined;
    const targetEditorLeaf = targetLeaf?.content.kind === "editor" ? targetLeaf : undefined;
    const fallbackLeaf = targetLeaf ?? collectLeaves(editorTree)[0];
    const editorLeafId = targetEditorLeaf?.id ?? findEditorLeaf(editorTree)?.id ?? fallbackLeaf?.id;
    if (editorLeafId) {
      editorActions.updateLeafContent(editorLeafId, (content) => {
        if (content.kind !== "editor") {
          return { kind: "editor", activePath: filePath, openPaths: [filePath] };
        }
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
    return suggestWikilinkTargetsFromTrees(workspaceModel, noteTrees, query);
  }

  async function previewKnowledgeTarget(target: string) {
    if (!activeDocumentPath || /^https?:\/\//.test(target)) {
      return null;
    }

    const resolved = target.endsWith(".md") || target.includes("/")
      ? await window.exo.notes.resolveTarget(activeDocumentPath, target)
      : await window.exo.notes.resolveTarget(activeDocumentPath, `${target}.md`);
    if (!resolved) {
      return null;
    }

    const document = await window.exo.notes.read(resolved);
    return {
      title: document.title || getPreviewTitle(resolved),
      excerpt: markdownPreviewExcerpt(document.body),
    };
  }

  function createBrowserPane(url = "about:blank") {
    editorActions.openBrowserPane(editorFocusedLeafId, url);
    setZoomSurface("editor");
  }

  function focusBrowserPane() {
    const browserLeaf = collectLeaves(editorTree).find((leaf) => leaf.content.kind === "browser");
    if (!browserLeaf) {
      createBrowserPane();
      return;
    }
    editorActions.focusLeaf(browserLeaf.id);
    setZoomSurface("editor");
  }

  function closeBrowserPane() {
    const leaves = collectLeaves(editorTree);
    if (leaves.length <= 1) {
      return;
    }
    const focusedBrowserLeaf = leaves.find((leaf) => leaf.id === editorFocusedLeafId && leaf.content.kind === "browser");
    const browserLeaf = focusedBrowserLeaf ?? leaves.find((leaf) => leaf.content.kind === "browser");
    if (!browserLeaf) {
      return;
    }
    editorActions.removeLeaf(browserLeaf.id);
  }

  async function createBranchFromActiveDocument() {
    const result = await openDocumentsState.createBranchFromActiveDocument();
    if (!result) {
      return;
    }
    await reloadTrees();
    await openFile(result.branchFilePath, editorFocusedLeafId);
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
      await window.exo.workspace.createFile(dailyPath, "");
      await reloadTrees();
    }

    await openFile(dailyPath, editorFocusedLeafId);
  }

  function remapOpenPathsInEditor(sourcePath: string, nextPath: string) {
    openDocumentsState.remapOpenPaths(sourcePath, nextPath);
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

  function removeDeletedPathsFromEditor(targetPath: string) {
    openDocumentsState.deletePathsWithin(targetPath);
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
  }

  function resolveActiveEditorPathAfterDelete(): string | null {
    const focused = findNode(editorTree, (n) => n.id === editorFocusedLeafId) as PaneLeaf | undefined;
    return focused?.content.kind === "editor" ? focused.content.activePath : null;
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
                <button className="toolbar-button" data-testid="workspace-picker-new" onClick={workspaceBootstrap.startNewWorkspaceSetup} type="button">
                  Add notes folder
                </button>
                <button
                  className="toolbar-button toolbar-button--primary"
                  data-testid="workspace-picker-open"
                  disabled={!onboardingState.selectedWorkspaceId || onboardingState.status === "saving"}
                  onClick={() => void workspaceBootstrap.activateSelectedWorkspace()}
                  type="button"
                >
                  {onboardingState.status === "saving" ? "Opening…" : "Open workspace"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="onboarding-card__title">
                {onboardingState.mode === "first-run" ? "Open notes folder" : "Choose notes folder"}
              </h1>
              <p className="onboarding-card__copy">
                Select an existing Markdown folder or create one, then confirm the default terminal, projects, and local index mode.
              </p>
              <div className="onboarding-grid">
                <div className="onboarding-section onboarding-section--primary">
                  <div className="onboarding-section__header">
                    <div>
                      <div className="dialog-field__label">Notes folder</div>
                      <div className="onboarding-section__hint">Required. This Markdown folder identifies the workspace.</div>
                    </div>
                    <button className="toolbar-button" data-testid="onboarding-choose-notes" onClick={() => void workspaceBootstrap.selectNotesFolderForOnboarding()} type="button">
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
                    <button className="toolbar-button toolbar-button--icon" data-testid="onboarding-add-project" onClick={() => void workspaceBootstrap.addProjectFoldersForOnboarding()} type="button">
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
                    <button className="toolbar-button" data-testid="onboarding-choose-terminal" onClick={() => void workspaceBootstrap.selectDefaultTerminalForOnboarding()} type="button">
                      Select
                    </button>
                  </div>
                  <PathList
                    emptyLabel={onboardingState.notesFolder ? "Defaults to the parent of your notes folder." : "Defaults after you choose notes."}
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
                  onClick={() => void workspaceBootstrap.completeOnboarding()}
                  type="button"
                >
                  {onboardingState.status === "saving" ? "Opening…" : "Open workspace"}
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
      onOpenAgentConfigEditor={() => void openAgentContextManager()}
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
          const leafActiveTerminalId = resolveTerminalPaneActiveId(terminalLeafSessions, leaf.content.activeTerminalId, activeTerminalId);
          return (
            <TerminalDock
              placement="right"
              paneId={leaf.id}
              compact={compactEditorChrome}
              empty={terminalLeafSessions.length === 0}
              focused={isFocused && zoomSurface === "terminal"}
              sessions={terminalLeafSessions}
              activeTerminalId={leafActiveTerminalId}
              hydrationSnapshots={terminalHydrationSnapshots}
              hydrationVersions={terminalHydrationVersions}
              hydrationReasons={terminalHydrationReasons}
              theme={resolvedTheme}
              fontSize={terminalFontSize}
              scrollbackLines={terminalRuntimeScrollbackLines}
              onFocus={() => {
                setZoomSurface("terminal");
                editorActions.focusLeaf(leaf.id);
              }}
              onHydrate={(id, options) => void terminalState.hydrateTerminal(id, options)}
              onSetActiveTerminal={(id) => {
                setZoomSurface("terminal");
                editorActions.updateLeafContent(leaf.id, (content) =>
                  content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
                );
                void terminalState.activateTerminal(id);
              }}
              onWrite={(id, data) => void window.exo.terminals.write(id, data)}
              onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
              onKill={(id) => void terminalPaneController.closeTerminal(id)}
              onReconnect={(id) => void terminalState.reconnectTerminal(id)}
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
              knowledgeByPath={knowledgeByPath}
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
              onPreviewTarget={(target) => previewKnowledgeTarget(target)}
              onCreateBranch={() => void createBranchFromActiveDocument()}
              theme={resolvedTheme}
              fontSize={editorFontSize}
              onZoomEditor={(direction) => updateFocusedSurfaceZoom(direction, "editor")}
              compact={compactEditorChrome}
              revealLineRequest={editorRevealLineRequest}
              scrollRestoreRequest={editorScrollRestoreRequest}
              isNoteDocument={(filePath) => workspaceModel ? workspaceModel.noteRoots.some((root) => isPathWithin(root.path, filePath)) : true}
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
      renderTerminalLeaf={(leaf, isFocused) => {
        const terminalLeafSessions = terminalSessions.filter((s) => leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(s.id));
        const leafActiveTerminalId = leaf.content.kind === "terminal"
          ? resolveTerminalPaneActiveId(terminalLeafSessions, leaf.content.activeTerminalId, activeTerminalId)
          : null;
        return (
          <TerminalDock
            placement="right"
            paneId={leaf.id}
            compact={false}
            empty={terminalLeafSessions.length === 0}
            focused={isFocused && zoomSurface === "terminal"}
            sessions={terminalLeafSessions}
            activeTerminalId={leafActiveTerminalId}
            hydrationSnapshots={terminalHydrationSnapshots}
            hydrationVersions={terminalHydrationVersions}
            hydrationReasons={terminalHydrationReasons}
            theme={resolvedTheme}
            fontSize={terminalFontSize}
            scrollbackLines={terminalRuntimeScrollbackLines}
            onFocus={() => setZoomSurface("terminal")}
            onHydrate={(id, options) => void terminalState.hydrateTerminal(id, options)}
            onSetActiveTerminal={(id) => {
              setZoomSurface("terminal");
              void terminalPaneController.activateTerminal(leaf.id, id);
            }}
            onWrite={(id, data) => void window.exo.terminals.write(id, data)}
            onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
            onKill={(id) => void terminalPaneController.closeTerminal(id)}
            onReconnect={(id) => void terminalState.reconnectTerminal(id)}
            dragManager={dragManager}
            onTogglePlacement={() => {}}
            headerActions={null}
          />
        );
      }}
      onAppearanceModeChange={updateAppearanceMode}
      onOpenWorkspaceSettings={() => void workspaceSettingsController.openDialog()}
      onOpenPluginManager={() => setPluginManagerOpen(true)}
      onOpenIndexSettings={() => void workspaceSettingsController.openDialog("index")}
      onOpenProjectChanges={() => void openProjectChangesFromStatus()}
      onSearchQueryChange={(value) => {
        workspaceSearch.setQuery(value);
        workspaceSearch.setSubmittedQuery(value.trim());
      }}
      onSearchSubmit={() => void workspaceSearch.runIndexedSearch()}
      onOpenFile={(filePath, line) => void openFile(filePath, undefined, { line })}
      onOpenTerminalSession={(sessionId) => void terminalPaneController.focusTerminalSession(sessionId)}
      onOpenTag={(tag) => void openTag(tag)}
      onExpandDirectory={(directoryPath, rootKind) => void workspaceTrees.expandTreeDirectory(directoryPath, rootKind)}
      explorerScale={explorerScale}
      onFocusExplorer={() => setZoomSurface("explorer")}
      dragManager={dragManager}
      onCreateFile={(directoryPath) => workspaceMutations.createFileInDirectory(directoryPath)}
      onCreateDirectory={(directoryPath) => workspaceMutations.createDirectoryInDirectory(directoryPath)}
      onCreateTerminalInDirectory={(directoryPath) => void terminalPaneController.createTerminal("shell", directoryPath)}
      onRenamePath={(targetPath) => workspaceMutations.renameWorkspacePath(targetPath)}
      onDeletePath={(targetPath) => workspaceMutations.deleteWorkspacePath(targetPath)}
      onCreateTerminal={(kind) => void terminalPaneController.createTerminal(kind)}
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
                    void workspaceMutations.submitDialog();
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
                onClick={() => void workspaceMutations.submitDialog()}
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
          indexBusy={indexBusy}
          indexStatus={indexStatus}
          settings={workspaceSettingsDialog}
          setSettings={setWorkspaceSettingsDialog}
          structuralDraftKey={workspaceSettingsStructuralDraftKey}
          onChooseFolder={(target) => void workspaceSettingsController.chooseFolder(target)}
          onClose={workspaceSettingsController.closeDialog}
          onOpenWorkspaceSwitcher={() => {
            setWorkspaceSettingsDialog(null);
            void workspaceBootstrap.openWorkspaceSwitcher();
          }}
          onRunIndexUpdate={(kind) => void workspaceSettingsController.runIndexUpdate(kind)}
          onSave={(settingsDialog, options) => void workspaceSettingsController.saveDialog(settingsDialog, options)}
        />
      ) : null}
      {agentContextManagerOpen ? (
        <AgentConfigEditorDialog
          editor={agentInstructionEditor}
          onClose={() => setAgentContextManagerOpen(false)}
        />
      ) : null}
      {pluginManagerOpen ? (
        <PluginManagerDialog onClose={() => setPluginManagerOpen(false)} />
      ) : null}
    </>
  );
}

function resolveTerminalPaneActiveId(
  sessions: TerminalSessionInfo[],
  paneActiveTerminalId: string | null,
  globalActiveTerminalId: string | null,
): string | null {
  if (globalActiveTerminalId && sessions.some((session) => session.id === globalActiveTerminalId)) {
    return globalActiveTerminalId;
  }
  if (paneActiveTerminalId && sessions.some((session) => session.id === paneActiveTerminalId)) {
    return paneActiveTerminalId;
  }
  return sessions.at(-1)?.id ?? null;
}

function findPersistedActiveTerminalId(
  layout: WorkspaceSettings["layout"] | undefined,
  liveSessionIds: ReadonlySet<string>,
): string | null {
  if (!layout) {
    return null;
  }
  for (const tree of [layout.editorTree, layout.terminalTree]) {
    for (const id of collectActiveTerminalIds(tree as PaneNode)) {
      if (liveSessionIds.has(id)) {
        return id;
      }
    }
  }
  return null;
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
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
