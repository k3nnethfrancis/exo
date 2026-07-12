import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  AgentCommand,
  FolderIndexStatus,
  IndexStatus,
  InvocationRecord,
  SearchResult,
  WorkspaceModel,
  WorkspaceSettings,
} from "@exo/core";
import type { ParsedAgentMention } from "@exo/core/agent-mention-parser";

import type { TerminalSessionInfo } from "../../shared/api";

import type { AppearanceMode, ResolvedAppearance } from "./appearance";
import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { BrowserPane } from "./components/BrowserPane";
import { InspectorDock } from "./components/InspectorDock";
import { PathList } from "./components/PathList";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { WorkspaceSettingsDialog } from "./components/WorkspaceSettingsDialog";
import { useAppKeybindings } from "./hooks/useAppKeybindings";
import { useOpenDocuments } from "./hooks/useOpenDocuments";
import { usePaneDropOrchestration } from "./hooks/usePaneDropOrchestration";
import { useShellLayout } from "./hooks/useShellLayout";
import { useTerminalPaneController } from "./hooks/useTerminalPaneController";
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
import { collectLeaves, findEditorLeaf, findNode, mapLeaves, paneId, pruneEmptyLeaves, type PaneLeaf, type PaneNodeId } from "./hooks/usePaneTree";
import {
  collectActiveTerminalIds,
  collectOpenEditorPaths,
  findActiveEditorPath,
  pruneEmptyTerminalLeaves,
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
import { summarizeTerminalStatusLine } from "./terminalSessions";
import { hasInvocationDirtyConflict, invocationConflictKey } from "./invocationReviewState";
import { workspaceBreadcrumb, type WorkspaceBreadcrumbSegment } from "./workspaceBreadcrumb";
import { DEFAULT_UTILITY_SURFACE_STATE, isUtilityDestinationActive, reduceUtilitySurface } from "./utilitySurfaceModel";
import { addPreviewTab, closePreviewTab, EMPTY_PREVIEW_TABS, selectPreviewTab, updatePreviewTabUrl } from "./previewTabsModel";

type ZoomSurface = "editor" | "terminal" | "explorer";

const NOTE_TREE_MAX_DEPTH = 3;
const PROJECT_TREE_MAX_DEPTH = 3;
export function App() {
  const workspaceTrees = useWorkspaceTrees({ noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH, projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH });
  const { noteTrees } = workspaceTrees;
  const [exploreIndexSearchOnEnter, setExploreIndexSearchOnEnter] = useState(false);
  const workspaceSearch = useWorkspaceSearch({ indexedOnEnter: exploreIndexSearchOnEnter });
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [revealExplorerPathRequest, setRevealExplorerPathRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [editorRevealLineRequest, setEditorRevealLineRequest] = useState<{ filePath: string; line: number; nonce: number } | null>(null);
  const [invocationReview, setInvocationReview] = useState<{
    record: InvocationRecord;
  } | null>(null);
  const [keptInvocationConflicts, setKeptInvocationConflicts] = useState<Set<string>>(() => new Set());
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [folderIndexStatus, setFolderIndexStatus] = useState<FolderIndexStatus | null>(null);
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
  const shellLayout = useShellLayout();
  const { tree: canvasTree, focusedLeafId: focusedPaneId, actions: canvasActions } = shellLayout.canvasPaneTree;
  const [utilityState, dispatchUtility] = useReducer(reduceUtilitySurface, DEFAULT_UTILITY_SURFACE_STATE);
  const [previewTabs, setPreviewTabs] = useState(EMPTY_PREVIEW_TABS);
  const terminalState = useTerminalSessions({
    maxPendingDataChars: terminalRuntimeReadTailChars,
    onExternalSessions: (sessions) => {
      if (sessions.length > 0) dispatchUtility({ type: "select", destination: "terminal" });
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
    canvasTree,
    focusedPaneId,
    canvasActions,
    terminalState,
  });
  const workspaceBootstrap = useWorkspaceBootstrap({
    noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH,
    projectTreeMaxDepth: PROJECT_TREE_MAX_DEPTH,
    applyWorkspaceSettings,
    applyPersistedLayout,
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
    workspaceSettingsRevisionRef,
  } = workspaceBootstrap;
  const workspaceSettingsController = useWorkspaceSettingsController({
    workspaceSettingsRef,
    workspaceSettingsRevisionRef,
    applyWorkspaceSettings,
    refreshWorkspaceModel,
    setIndexStatus,
  });
  const {
    dialog: workspaceSettingsDialog,
    setDialog: setWorkspaceSettingsDialog,
    indexBusy,
  } = workspaceSettingsController;
  const openDocumentsState = useOpenDocuments({
    workspaceModel,
    getOpenEditorPaths: () => collectOpenEditorPaths(shellLayout.canvasPaneTree.tree),
    getEditorScrollTopForPath,
  });
  const {
    openDocuments,
    graphContextByPath,
    documentSaveStatuses,
    activeDocumentPath,
    activeDocument,
    activeGraphContext,
    scrollRestoreRequest: editorScrollRestoreRequest,
    setActiveDocumentPath,
    ensureDocumentLoaded,
    scheduleRefresh: scheduleOpenDocumentRefresh,
    reloadFromDisk: reloadOpenDocumentFromDisk,
    updateBody,
    updateFrontmatter,
    saveDocument,
  } = openDocumentsState;
  const workspaceMutations = useWorkspaceMutations({
    workspaceModel,
    activeDocumentPath,
    editorFocusedLeafId: focusedPaneId,
    reloadTrees,
    openFile,
    remapOpenPaths: remapOpenPathsInEditor,
    removeDeletedPaths: removeDeletedPathsFromEditor,
    setActiveDocumentPath,
    resolveActiveEditorPathAfterDelete,
    revealExplorerPath: (path) => setRevealExplorerPathRequest({ path, nonce: Date.now() }),
  });
  const { dialog: workspaceDialog, setDialog: setWorkspaceDialog } = workspaceMutations;
  const dragManager = usePaneDropOrchestration({
    canvasTree,
    canvasActions,
    setActiveTerminalId: terminalState.setActiveTerminalId,
    setActiveDocumentPath,
    ensureDocumentLoaded,
    moveWorkspacePathIntoDirectory: workspaceMutations.moveWorkspacePathIntoDirectory,
  });
  const compactEditorChrome = collectLeaves(canvasTree).length > 1;
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;
  const resolvedTheme = useMemo(() => resolveTheme(colorThemeId, resolvedAppearance), [colorThemeId, resolvedAppearance]);

  useEffect(() => {
    terminalRuntimeScrollbackLinesRef.current = terminalRuntimeScrollbackLines;
  }, [terminalRuntimeScrollbackLines]);

  useEffect(() => {
    const openPaths = collectOpenEditorPaths(canvasTree);
    openDocumentsState.pruneToOpenPaths(openPaths);
  }, [canvasTree]);

  useEffect(() => {
    if (!workspaceModel) {
      setFolderIndexStatus(null);
      return;
    }
    void refreshFolderIndexStatus();
  }, [workspaceModel]);

  useEffect(() => {
    return window.exo.workspace.onInvocationUpdated((record) => {
      if (record.taggedDocumentPath) {
        scheduleOpenDocumentRefresh(record.taggedDocumentPath);
      }
      setKeptInvocationConflicts(new Set());
      setInvocationReview((current) =>
        current?.record.id === record.id ? { record } : current,
      );
    });
  }, [scheduleOpenDocumentRefresh]);

  useEffect(() => {
    const activeTerminalIds = collectActiveTerminalIds(canvasTree);
    if (activeTerminalId) {
      activeTerminalIds.add(activeTerminalId);
    }
    terminalState.pruneHydration(activeTerminalIds);
  }, [activeTerminalId, canvasTree]);
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
    canvas: canvasTree,
    sidebarCollapsed: shellLayout.sidebarCollapsed,
    sidebarWidth: shellLayout.sidebarWidth,
    inspectorCollapsed: shellLayout.inspectorCollapsed,
    layoutPersistenceReady,
    onboardingActive: Boolean(onboardingState),
    workspaceModel,
    workspaceSettingsRef,
    workspaceSettingsRevisionRef,
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
  });

  useAppKeybindings({
    activeDocumentPath,
    zoomSurface,
    saveDocument,
    openOrCreateDailyNote,
    createShellTerminal: async () => {
      await createUtilityTerminal("shell");
    },
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

  function applyPersistedLayout(layout: WorkspaceSettings["layout"] | undefined) {
    shellLayout.applyPersistedLayout(layout);
  }

  async function restoreInitialDocuments(input: {
    settings: WorkspaceSettings;
    firstNotePath: string | null;
  }) {
    if (!input.firstNotePath) {
      return;
    }

    const restoredPaths = collectOpenEditorPaths(canvasTree);
    if (restoredPaths.size > 0) {
      await Promise.all(
        Array.from(restoredPaths).map((filePath) =>
          ensureDocumentLoaded(filePath).catch((error) => {
            console.warn("[exo] failed to restore open document", { filePath, error });
          }),
        ),
      );
      const restoredActivePath = findActiveEditorPath(canvasTree);
      setActiveDocumentPath(restoredActivePath ?? restoredPaths.values().next().value ?? input.firstNotePath);
      return;
    }

    await openFile(input.firstNotePath, focusedPaneId);
  }

  function restoreTerminals(input: {
    settings: WorkspaceSettings;
    sessions: TerminalSessionInfo[];
  }) {
    const restoredActiveTerminalId = input.sessions.at(-1)?.id ?? null;
    terminalState.initialize(input.sessions, restoredActiveTerminalId);
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
  async function reloadTrees() {
    if (!workspaceModel) {
      return;
    }

    await reloadTreesForModel(workspaceModel);
  }

  async function reloadTreesForModel(model: WorkspaceModel) {
    await workspaceTrees.reloadTreesForModel(model);
  }

  async function refreshFolderIndexStatus() {
    setFolderIndexStatus(await window.exo.workspace.getFolderIndexStatus());
  }

  async function createMissingFolderIndexes() {
    const missing = folderIndexStatus?.missingIndexPaths ?? [];
    for (const indexPath of missing) {
      const directoryPath = indexPath.replace(/[\\/]index\.md$/, "");
      await window.exo.workspace.ensureFolderIndex(directoryPath);
    }
    await Promise.all([reloadTrees(), refreshFolderIndexStatus()]);
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

  async function invokeAgentMention(mention: ParsedAgentMention) {
    const document = activeDocument;
    if (!document) {
      return;
    }
    const command = workspaceSettingsRef.current?.agentCommands?.find((entry) => entry.handle === mention.handle);
    const cwd = command?.cwdPolicy === "note_dir"
      ? dirname(document.filePath)
      : command?.cwdPolicy === "fixed"
        ? command.fixedCwd ?? workspaceSettingsRef.current?.workspaceRoot ?? ""
        : workspaceSettingsRef.current?.workspaceRoot ?? "";
    const fingerprint = command ? await agentCommandExecutableFingerprintForRenderer(command) : null;
    const confirmed = window.confirm([
      `Run ${command?.label ?? `@${mention.handle}`} on this document?`,
      "",
      `Document: ${document.filePath}`,
      `Shell: /bin/zsh -lc "${command?.command ?? `@${mention.handle}`}"`,
      `Cwd: ${cwd || "(workspace root)"}`,
      fingerprint ? `Fingerprint: ${fingerprint}` : "Fingerprint: unavailable until the command is configured",
      "",
      "This command runs as native code on your machine. Exo does not sandbox it.",
      "The agent can edit files directly. Exo will observe this document and highlight changes seen during the invocation.",
      "",
      mention.message,
    ].join("\n"));
    if (!confirmed) {
      return;
    }
    try {
      if (document.dirty) {
        await saveDocument(document.filePath);
      }
      const persistTrust = command
        ? window.confirm([
            `Trust ${command.label} for future Exo launches?`,
            "",
            `Shell: /bin/zsh -lc "${command.command}"`,
            `Cwd: ${cwd || "(workspace root)"}`,
            `Fingerprint: ${fingerprint}`,
            "",
            "Choose OK only if you want Exo to remember this command trust for this workspace. Choose Cancel to run it once without saving trust.",
          ].join("\n"))
        : false;
      const result = await window.exo.workspace.launchAgentInvocation({
        handle: mention.handle,
        documentPath: document.filePath,
        mentionText: mention.originalText,
        message: mention.message,
        allowUntrustedOneShot: !persistTrust,
        persistTrust,
      });
      terminalState.adoptExternalSessions([result.terminal], { activateLatest: true });
      setKeptInvocationConflicts(new Set());
      setInvocationReview({ record: result.invocation });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function endActiveInvocationObservation() {
    if (!invocationReview) {
      return;
    }
    const finalized = await window.exo.workspace.endAgentInvocation(invocationReview.record.id);
    if (!finalized) {
      return;
    }
    if (finalized.taggedDocumentPath) {
      scheduleOpenDocumentRefresh(finalized.taggedDocumentPath);
    }
    setKeptInvocationConflicts(new Set());
    setInvocationReview({ record: finalized });
  }

  function keepInvocationDirtyBuffer(invocationId: string, filePath: string) {
    setKeptInvocationConflicts((current) => {
      const next = new Set(current);
      next.add(invocationConflictKey(invocationId, filePath));
      return next;
    });
  }

  async function reloadInvocationDiskVersion(invocationId: string, filePath: string) {
    const confirmed = window.confirm("Reload the disk version and discard unsaved edits in this editor?");
    if (!confirmed) {
      return;
    }
    await reloadOpenDocumentFromDisk(filePath);
    keepInvocationDirtyBuffer(invocationId, filePath);
  }

  function focusEditorPane(leafId: PaneNodeId) {
    canvasActions.focusLeaf(leafId);
    const leaf = findNode(canvasTree, (n) => n.id === leafId) as PaneLeaf | undefined;
    const nextActivePath = leaf?.content.kind === "editor" ? leaf.content.activePath : null;
    setActiveDocumentPath(nextActivePath);
    setActiveTag(null);
    if (!nextActivePath) {
      setTagResults([]);
    }
  }

  function setPaneActivePath(leafId: PaneNodeId, filePath: string) {
    canvasActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "editor") return content;
      return {
        ...content,
        activePath: filePath,
        openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
      };
    });
    canvasActions.focusLeaf(leafId);
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
  }

  function closeDocumentInPane(leafId: PaneNodeId, filePath: string) {
    const nextTree = pruneEmptyLeaves(
      mapLeaves(canvasTree, (leaf) => {
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
    canvasActions.setTree(nextTree);

    const focused = findNode(nextTree, (n) => n.id === focusedPaneId) as PaneLeaf | undefined;
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
    const targetLeafId = leafId ?? focusedPaneId;
    await ensureDocumentLoaded(filePath);

    // File opens should never be trapped by a focused browser/terminal leaf.
    // Prefer the requested editor leaf, then any editor leaf, then recover by
    // converting the focused/first leaf back into an editor leaf.
    const targetLeaf = findNode(canvasTree, (n) => n.id === targetLeafId && n.kind === "leaf") as PaneLeaf | undefined;
    const targetEditorLeaf = targetLeaf?.content.kind === "editor" ? targetLeaf : undefined;
    const fallbackLeaf = targetLeaf ?? collectLeaves(canvasTree)[0];
    const editorLeafId = targetEditorLeaf?.id ?? findEditorLeaf(canvasTree)?.id ?? fallbackLeaf?.id;
    if (editorLeafId) {
      canvasActions.updateLeafContent(editorLeafId, (content) => {
        if (content.kind !== "editor") {
          return { kind: "editor", activePath: filePath, openPaths: [filePath] };
        }
        return {
          ...content,
          activePath: filePath,
          openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
        };
      });
      canvasActions.focusLeaf(editorLeafId);
    }
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
    if (options?.line && options.line > 0) {
      setEditorRevealLineRequest({ filePath, line: options.line, nonce: Date.now() });
    }
  }

  async function openTitleSegment(segment: WorkspaceBreadcrumbSegment) {
    if (segment.kind === "file") {
      await openFile(segment.path);
      return;
    }
    const index = await window.exo.workspace.ensureFolderIndex(segment.path);
    await reloadTrees();
    await openFile(index.indexPath);
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
    await openFile(ensured, focusedPaneId);
  }

  async function openTag(tag: string) {
    if (activeDocumentPath) {
      const resolved = await window.exo.notes.resolveTarget(activeDocumentPath, tag);
      if (resolved) {
        await openFile(resolved, focusedPaneId);
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
    const id = paneId();
    setPreviewTabs((current) => addPreviewTab(current, { id, url }));
    dispatchUtility({ type: "select", destination: "preview" });
  }

  async function createUtilityTerminal(kind: "shell", cwd?: string) {
    dispatchUtility({ type: "select", destination: "terminal" });
    const session = await terminalState.createTerminal(kind, cwd);
    await terminalState.activateTerminal(session.id);
  }

  async function showUtilityTerminal(sessionId: string) {
    dispatchUtility({ type: "select", destination: "terminal" });
    await terminalState.activateTerminal(sessionId);
  }

  function openUtilityTerminal() {
    dispatchUtility({ type: "select", destination: "terminal" });
  }

  function toggleUtilitySurface() {
    dispatchUtility({ type: "toggle" });
  }

  function toggleConnectionsSurface() {
    dispatchUtility({ type: "close" });
  }

  function openConnectionsSurface() {
    dispatchUtility({ type: "select", destination: "connections" });
  }

  function focusBrowserPane() {
    if (previewTabs.activeId) {
      dispatchUtility({ type: "select", destination: "preview" });
      return;
    }
    createBrowserPane();
  }

  function closeBrowserPane() {
    if (!previewTabs.activeId) return;
    closeBrowserTab(previewTabs.activeId);
  }

  function closeBrowserTab(id: string) {
    const next = closePreviewTab(previewTabs, id);
    setPreviewTabs(next);
    if (next.tabs.length === 0) dispatchUtility({ type: "select", destination: "terminal" });
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

    await openFile(dailyPath, focusedPaneId);
  }

  function remapOpenPathsInEditor(sourcePath: string, nextPath: string) {
    openDocumentsState.remapOpenPaths(sourcePath, nextPath);
    canvasActions.setTree(mapLeaves(canvasTree, (leaf) => {
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
    canvasActions.setTree(mapLeaves(canvasTree, (leaf) => {
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
    const focused = findNode(canvasTree, (n) => n.id === focusedPaneId) as PaneLeaf | undefined;
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
        <div className="onboarding-card" data-testid="onboarding-card">
          <div className="onboarding-card__eyebrow">
            {onboardingState.mode === "first-run" ? "First setup" : "Switch workspace"}
          </div>
          {onboardingState.step === "select" ? (
            <>
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">Select workspace</h1>
                <p className="onboarding-card__copy">
                  Workspaces are saved notes folders with terminal defaults, settings, and advanced search state.
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
                      search {selectedWorkspace.settings.indexing.mode}
                      {" | "}
                      terminal {pathLabel(selectedWorkspace.settings.defaultTerminalCwd)}
                    </div>
                  </div>
                ) : null}
              </div>
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
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">
                  {onboardingState.mode === "first-run" ? "Open notes folder" : "Choose notes folder"}
                </h1>
                <p className="onboarding-card__copy">
                  Select an existing Markdown folder or create one, then confirm where terminals should start.
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
                  {onboardingState.status === "saving" ? "Saving…" : "Open workspace"}
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
  const terminalStatusLine = summarizeTerminalStatusLine(
    terminalSessions,
    activeTerminalId,
    terminalState.hydratingTerminalIds,
  );
  const workspaceLabel = workspaceModel ? pathLabel(workspaceModel.workspaceRoot) : "Exo";
  const titleSegments = activeDocument
    ? workspaceBreadcrumb(activeDocument.filePath, workspaceModel?.noteRoots.map((root) => root.path) ?? [])
    : [{ kind: "folder" as const, label: workspaceLabel, path: workspaceModel?.workspaceRoot ?? "" }];
  const activePreview = previewTabs.tabs.find((tab) => tab.id === previewTabs.activeId) ?? null;
  const utilityContent = utilityState.destination === "preview" && activePreview ? (
    <BrowserPane
      paneId={activePreview.id}
      url={activePreview.url}
      compact={false}
      onFocus={() => undefined}
      onNavigate={async (target) => {
        const result = await window.exo.workspace.resolvePreviewTarget(target);
        setPreviewTabs((current) => updatePreviewTabUrl(current, activePreview.id, result.url));
        return result.url;
      }}
      onClosePane={closeBrowserPane}
      tabs={previewTabs.tabs}
      activeTabId={previewTabs.activeId}
      onSelectTab={(id) => setPreviewTabs((current) => selectPreviewTab(current, id))}
      onCreateTab={() => createBrowserPane()}
      onCloseTab={closeBrowserTab}
      dragManager={dragManager}
    />
  ) : utilityState.destination === "terminal" ? (
    <TerminalDock
      paneId="utility-terminal"
      compact={false}
      empty={terminalSessions.length === 0}
      focused={utilityState.open}
      sessions={terminalSessions}
      activeTerminalId={activeTerminalId}
      hydrationSnapshots={terminalHydrationSnapshots}
      hydrationVersions={terminalHydrationVersions}
      hydrationReasons={terminalHydrationReasons}
      hydratingTerminalIds={terminalState.hydratingTerminalIds}
      theme={resolvedTheme}
      fontSize={terminalFontSize}
      scrollbackLines={terminalRuntimeScrollbackLines}
      onFocus={() => setZoomSurface("terminal")}
      onHydrate={(id, options) => void terminalState.hydrateTerminal(id, options)}
      onHydrated={(id) => terminalState.markTerminalHydrated(id)}
      onSetActiveTerminal={(id) => void terminalState.activateTerminal(id)}
      onWrite={(id, data) => void window.exo.terminals.write(id, data)}
      onGeometryMeasured={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
      onKill={(id) => void terminalState.killTerminal(id)}
      onCreateTerminal={() => void createUtilityTerminal("shell")}
      dragManager={dragManager}
    />
  ) : null;

  return (
    <>
      <ShellLayout
      titleSegments={titleSegments}
      onOpenTitleSegment={(segment) => void openTitleSegment(segment)}
      workspaceLabel={workspaceLabel}
      missingFolderIndexCount={folderIndexStatus?.missingIndexPaths.length ?? 0}
      noteSections={noteSections}
      appearanceMode={appearanceMode}
      resolvedAppearance={resolvedAppearance}
      searchQuery={workspaceSearch.query}
      searchResults={workspaceSearch.results}
      searchResultMode={workspaceSearch.resultMode}
      searchResultQuery={workspaceSearch.resultQuery}
      searchMessage={workspaceSearch.message}
      attachedSections={[]}
      sidebarCollapsed={shellLayout.sidebarCollapsed}
      sidebarWidth={shellLayout.sidebarWidth}
      onToggleSidebar={() => shellLayout.setSidebarCollapsed((current) => !current)}
      onResizeSidebar={(event) => shellLayout.startSidebarResize(event)}
      canvas={canvasTree}
      focusedPaneId={focusedPaneId}
      canvasActions={canvasActions}
      utilitySurface={utilityState.destination}
      utilityContent={utilityContent}
      utilityOpen={utilityState.open}
      onToggleUtility={toggleUtilitySurface}
      onOpenUtilityBrowser={focusBrowserPane}
      onOpenUtilityTerminal={openUtilityTerminal}
      revealExplorerPathRequest={revealExplorerPathRequest}
      renderLeaf={(leaf, isFocused) => {
        if (leaf.content.kind === "browser") {
          return (
            <BrowserPane
              paneId={leaf.id}
              url={leaf.content.url}
              compact={compactEditorChrome}
              onFocus={() => {
                canvasActions.focusLeaf(leaf.id);
              }}
              onNavigate={async (target) => {
                const result = await window.exo.workspace.resolvePreviewTarget(target);
                canvasActions.updateLeafContent(leaf.id, (content) =>
                  content.kind === "browser" ? { ...content, url: result.url } : content,
                );
                return result.url;
              }}
              onClosePane={collectLeaves(canvasTree).length > 1 ? () => canvasActions.removeLeaf(leaf.id) : null}
              dragManager={dragManager}
            />
          );
        }
        if (leaf.content.kind === "terminal") {
          const terminalLeafSessions = terminalSessions.filter((s) => leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(s.id));
          const leafActiveTerminalId = resolveTerminalPaneActiveId(terminalLeafSessions, leaf.content.activeTerminalId, activeTerminalId);
          return (
            <TerminalDock
              paneId={leaf.id}
              compact={compactEditorChrome}
              empty={terminalLeafSessions.length === 0}
              focused={isFocused}
              sessions={terminalLeafSessions}
              activeTerminalId={leafActiveTerminalId}
              hydrationSnapshots={terminalHydrationSnapshots}
              hydrationVersions={terminalHydrationVersions}
              hydrationReasons={terminalHydrationReasons}
              hydratingTerminalIds={terminalState.hydratingTerminalIds}
              theme={resolvedTheme}
              fontSize={terminalFontSize}
              scrollbackLines={terminalRuntimeScrollbackLines}
              onFocus={() => {
                canvasActions.focusLeaf(leaf.id);
              }}
              onHydrate={(id, options) => void terminalState.hydrateTerminal(id, options)}
              onHydrated={(id) => terminalState.markTerminalHydrated(id)}
              onSetActiveTerminal={(id) => {
                canvasActions.updateLeafContent(leaf.id, (content) =>
                  content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
                );
                void terminalState.activateTerminal(id);
              }}
              onWrite={(id, data) => void window.exo.terminals.write(id, data)}
              onGeometryMeasured={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
              onKill={(id) => void terminalPaneController.closeTerminal(id)}
              onCreateTerminal={() => void createUtilityTerminal("shell")}
              dragManager={dragManager}
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
              graphContextByPath={graphContextByPath}
              saveStatuses={documentSaveStatuses}
              propertiesCollapsed={propertiesCollapsed}
              isFocused={isFocused}
              onFocusPane={() => {
                focusEditorPane(leaf.id);
              }}
              onActivateTab={(filePath) => setPaneActivePath(leaf.id, filePath)}
              onCloseTab={(filePath) => closeDocumentInPane(leaf.id, filePath)}
              onClosePane={collectLeaves(canvasTree).length > 1 ? () => canvasActions.removeLeaf(leaf.id) : null}
              dragManager={dragManager}
              onToggleProperties={() => setPropertiesCollapsed((current) => !current)}
              onUpdateFrontmatter={updateFrontmatter}
              onBodyChange={updateBody}
              onSave={() => void (leaf.content.kind === "editor" && leaf.content.activePath ? saveDocument(leaf.content.activePath) : Promise.resolve())}
              onOpenTag={(tag) => void openTag(tag)}
              onOpenTarget={(target) => void openKnowledgeTarget(target)}
              onSuggestTargets={(query) => suggestNoteTargets(query)}
              onPreviewTarget={(target) => previewKnowledgeTarget(target)}
              agentCommands={workspaceSettingsRef.current?.agentCommands ?? []}
              onInvokeAgentMention={(mention) => void invokeAgentMention(mention)}
              invocationReview={
                invocationReview?.record.taggedDocumentPath === pane.activePath
                  ? {
                      ...invocationReview,
                      hasDirtyConflict: hasInvocationDirtyConflict(
                        invocationReview.record,
                        pane.activePath,
                        pane.activePath ? openDocuments[pane.activePath] : undefined,
                        keptInvocationConflicts,
                      ),
                      onEndObservation: () => void endActiveInvocationObservation(),
                      onKeepDirtyBuffer: () => pane.activePath ? keepInvocationDirtyBuffer(invocationReview.record.id, pane.activePath) : undefined,
                      onReloadFromDisk: () => void (pane.activePath ? reloadInvocationDiskVersion(invocationReview.record.id, pane.activePath) : Promise.resolve()),
                    }
                  : null
              }
              theme={resolvedTheme}
              fontSize={editorFontSize}
              onZoomEditor={(direction) => updateFocusedSurfaceZoom(direction, "editor")}
              compact={compactEditorChrome}
              revealLineRequest={editorRevealLineRequest}
              scrollRestoreRequest={editorScrollRestoreRequest}
              isNoteDocument={(filePath) => workspaceModel ? workspaceModel.noteRoots.some((root) => isPathWithin(root.path, filePath)) : true}
            />
          </>
        );
      }}
      connections={<InspectorDock document={activeDocument} graphContext={activeGraphContext} open={isUtilityDestinationActive(utilityState, "connections")} activeTag={activeTag} tagResults={tagResults} onToggle={toggleConnectionsSurface} onOpenTarget={(target) => void openKnowledgeTarget(target)} onOpenExternal={(target) => void window.exo.shell.openExternal(target)} onOpenTag={(tag) => void openTag(tag)} />}
      onAppearanceModeChange={updateAppearanceMode}
      onOpenWorkspaceSettings={() => void workspaceSettingsController.openDialog()}
      onCreateMissingFolderIndexes={() => void createMissingFolderIndexes()}
      connectionsOpen={isUtilityDestinationActive(utilityState, "connections")}
      onOpenConnections={openConnectionsSurface}
      onSearchQueryChange={(value) => {
        if (value.trim()) shellLayout.setSidebarCollapsed(false);
        workspaceSearch.setQuery(value);
        workspaceSearch.setSubmittedQuery(value.trim());
      }}
      onSearchSubmit={() => void workspaceSearch.runIndexedSearch()}
      onSearchClear={() => {
        workspaceSearch.setQuery("");
        workspaceSearch.setSubmittedQuery("");
      }}
      onOpenFile={(filePath, line) => void openFile(filePath, undefined, { line })}
      onOpenTerminalSession={(sessionId) => void showUtilityTerminal(sessionId)}
      onOpenTag={(tag) => void openTag(tag)}
      onExpandDirectory={(directoryPath, rootKind) => void workspaceTrees.expandTreeDirectory(directoryPath, rootKind)}
      explorerScale={explorerScale}
      onFocusExplorer={() => setZoomSurface("explorer")}
      dragManager={dragManager}
      onCreateFile={(directoryPath) => workspaceMutations.createFileInDirectory(directoryPath)}
      onCreateDirectory={(directoryPath) => workspaceMutations.createDirectoryInDirectory(directoryPath)}
      onCreateTerminalInDirectory={(directoryPath) => void createUtilityTerminal("shell", directoryPath)}
      onRenamePath={(targetPath) => workspaceMutations.renameWorkspacePath(targetPath)}
      onDeletePath={(targetPath) => workspaceMutations.deleteWorkspacePath(targetPath)}
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
    return { label: "Updating search", tone: "info", title: "Updating the QMD advanced search provider.", busy: true };
  }
  if (busy === "syncing") {
    return { label: "Syncing search", tone: "info", title: "Refreshing documents and embeddings for the QMD advanced search provider.", busy: true };
  }
  if (busy === "embedding") {
    return { label: "Embedding", tone: "info", title: "Building semantic embeddings for QMD advanced search.", busy: true };
  }
  if (!status) {
    return { label: "Search unknown", tone: "muted", title: "Advanced search provider status has not loaded yet.", busy: false };
  }
  if (status.errors.length > 0) {
    return { label: "Search provider error", tone: "error", title: status.errors.join("\n"), busy: false };
  }
  if (!status.enabled || status.mode === "off" || status.indexedRoots.length === 0) {
    return { label: "QMD off", tone: "muted", title: "QMD advanced search is off. Core filename, path, and text search remains available.", busy: false };
  }
  if (status.documentCount === 0) {
    return { label: "Search provider empty", tone: "warn", title: "QMD advanced search is configured but has no documents yet.", busy: false };
  }
  if ((status.mode === "semantic" || status.mode === "hybrid") && (!status.hasVectorIndex || status.pendingEmbeddings > 0)) {
    return { label: "Embeddings needed", tone: "warn", title: formatIndexStatus(status), busy: false };
  }
  return { label: "QMD ready", tone: "ok", title: formatIndexStatus(status), busy: false };
}

function joinPath(parentPath: string, name: string): string {
  return `${parentPath.replace(/\/$/, "")}/${name.replace(/^\//, "")}`;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : ".";
}

async function agentCommandExecutableFingerprintForRenderer(command: AgentCommand): Promise<string> {
  const payload = {
    command: command.command,
    cwdPolicy: command.cwdPolicy,
    fixedCwd: command.fixedCwd ?? null,
    handle: command.handle,
    id: command.id,
    promptDelivery: command.promptDelivery,
    version: command.version,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
