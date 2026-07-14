import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, Database, Search, ShieldCheck, SquareTerminal } from "lucide-react";
import type {
  AgentCommand,
  FolderIndexStatus,
  IndexStatus,
  InvocationRecord,
  SearchResult,
  WorkspaceModel,
  WorkspaceSettings,
} from "@exo/core";

import type { InvocationReviewPayload, ProviderMcpSetupResult, TerminalSessionInfo } from "../../shared/api";
import { createDefaultClaudeAgentCommand } from "@exo/core/default-agent-command";

import type { AppearanceMode, ResolvedAppearance } from "./appearance";
import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { BrowserPane } from "./components/BrowserPane";
import { InspectorDock } from "./components/InspectorDock";
import { InvocationAuthorizationDialog } from "./components/InvocationAuthorizationDialog";
import type { InlineAgentDraft } from "./components/inlineAgentComposer";
import { PathList } from "./components/PathList";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { WorkspaceSettingsDialog } from "./components/WorkspaceSettingsDialog";
import { AgentInvocationPromptEditor } from "./components/AgentInvocationPromptEditor";
import { AgentIcon } from "./components/AgentIcon";
import { useAppKeybindings } from "./hooks/useAppKeybindings";
import { useOpenDocuments, type OpenEditorDocument } from "./hooks/useOpenDocuments";
import { usePaneDropOrchestration } from "./hooks/usePaneDropOrchestration";
import { useShellLayout } from "./hooks/useShellLayout";
import { useTerminalSessions } from "./hooks/useTerminalSessions";
import { useWorkspaceBootstrap } from "./hooks/useWorkspaceBootstrap";
import { useWorkspaceCommandHandlers } from "./hooks/useWorkspaceCommandHandlers";
import { decodePersistedWorkspaceCanvas, useWorkspaceLayoutPersistence } from "./hooks/useWorkspaceLayoutPersistence";
import { useWorkspaceMutations } from "./hooks/useWorkspaceMutations";
import { useWorkspaceSettingsController } from "./hooks/useWorkspaceSettingsController";
import { useWorkspaceTrees } from "./hooks/useWorkspaceTrees";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { applyTheme } from "./theme/applyTheme";
import { DEFAULT_COLOR_THEME_ID, resolveTheme } from "./theme/registry";
import type { ColorThemeId } from "./theme/types";
import { collectLeaves, findEditorLeaf, findNode, mapLeaves, paneId, pruneEmptyLeaves, removeNode, type PaneLeaf, type PaneNodeId } from "./hooks/usePaneTree";
import { collectOpenEditorPaths, findActiveEditorPath } from "./paneTreeSelectors";
import {
  clampNumber,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_RUNTIME_SCROLLBACK_LINES,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS,
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

interface PendingInvocationAuthorization {
  command: AgentCommand;
  cwd: string;
  document: OpenEditorDocument;
  draft: InlineAgentDraft;
  fingerprint: string | null;
}

const NOTE_TREE_MAX_DEPTH = 3;
export function App() {
  const workspaceTrees = useWorkspaceTrees({ noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH });
  const { noteTrees } = workspaceTrees;
  const [exploreIndexSearchOnEnter, setExploreIndexSearchOnEnter] = useState(false);
  const workspaceSearch = useWorkspaceSearch({ indexedOnEnter: exploreIndexSearchOnEnter });
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [onboardingMcp, setOnboardingMcp] = useState({
    providers: ["claude", "codex"] as Array<"claude" | "codex">,
    status: "idle" as "idle" | "saving" | "done" | "error",
    results: [] as ProviderMcpSetupResult[],
    errorMessage: null as string | null,
  });
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [revealExplorerPathRequest, setRevealExplorerPathRequest] = useState<{ path: string; nonce: number } | null>(null);
  const [editorRevealLineRequest, setEditorRevealLineRequest] = useState<{ filePath: string; line: number; nonce: number } | null>(null);
  const [invocationReview, setInvocationReview] = useState<{
    record: InvocationRecord;
    payload?: InvocationReviewPayload | null;
  } | null>(null);
  const [pendingInvocationAuthorization, setPendingInvocationAuthorization] = useState<PendingInvocationAuthorization | null>(null);
  const [keptInvocationConflicts, setKeptInvocationConflicts] = useState<Set<string>>(() => new Set());
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [folderIndexStatus, setFolderIndexStatus] = useState<FolderIndexStatus | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system");
  const [colorThemeId, setColorThemeId] = useState<ColorThemeId>(DEFAULT_COLOR_THEME_ID);
  const [zoomSurface, setZoomSurface] = useState<ZoomSurface>("editor");
  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [terminalRuntimeScrollbackLines, setTerminalRuntimeScrollbackLines] = useState(DEFAULT_TERMINAL_RUNTIME_SCROLLBACK_LINES);
  const [terminalRuntimeReadTailChars, setTerminalRuntimeReadTailChars] = useState(DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS);
  const [explorerScale, setExplorerScale] = useState(DEFAULT_EXPLORER_SCALE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const terminalRuntimeScrollbackLinesRef = useRef(DEFAULT_TERMINAL_RUNTIME_SCROLLBACK_LINES);
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
  const workspaceBootstrap = useWorkspaceBootstrap({
    noteTreeMaxDepth: NOTE_TREE_MAX_DEPTH,
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
    setActiveDocumentPath,
    ensureDocumentLoaded,
    moveWorkspacePathIntoDirectory: workspaceMutations.moveWorkspacePathIntoDirectory,
    returnSurfaceToUtility,
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
      if (record.workspaceRoot && record.workspaceRoot !== workspaceModel?.workspaceRoot) {
        return;
      }
      if (record.taggedDocumentPath) {
        scheduleOpenDocumentRefresh(record.taggedDocumentPath);
      }
      setKeptInvocationConflicts(new Set());
      setInvocationReview((current) => current?.record.id === record.id ? { record } : current);
      void loadInvocationReview(record);
    });
  }, [scheduleOpenDocumentRefresh, workspaceModel?.workspaceRoot]);

  useEffect(() => {
    terminalState.pruneHydration(activeTerminalId ? new Set([activeTerminalId]) : new Set());
  }, [activeTerminalId]);
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
    utilityWidth: shellLayout.utilityWidth,
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

  async function restoreInitialDocuments(settings: WorkspaceSettings) {
    const restoredTree = decodePersistedWorkspaceCanvas(settings.layout)?.canvas ?? canvasTree;
    const restoredPaths = collectOpenEditorPaths(restoredTree);
    if (restoredPaths.size > 0) {
      await Promise.all(
        Array.from(restoredPaths).map((filePath) =>
          ensureDocumentLoaded(filePath).catch((error) => {
            console.warn("[exo] failed to restore open document", { filePath, error });
          }),
        ),
      );
      const restoredActivePath = findActiveEditorPath(restoredTree);
      setActiveDocumentPath(restoredActivePath ?? restoredPaths.values().next().value ?? null);
    }
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

  async function invokeInlineAgent(draft: InlineAgentDraft) {
    const document = activeDocument;
    if (!document) {
      return;
    }
    // CodeMirror owns the authoritative post-envelope body. Its ordinary
    // React propagation is deliberately deprioritized for typing latency, so
    // publish this exact snapshot to the synchronous document ref before any
    // trust/fingerprint await can race the invocation save.
    flushSync(() => updateBody(draft.documentBody));
    const command = workspaceSettingsRef.current?.agentCommands?.find((entry) => entry.handle === draft.handle)
      ?? (draft.handle === "claude" ? createDefaultClaudeAgentCommand() : undefined);
    if (!command) {
      window.alert(`No AgentCommand is configured for @${draft.handle}.`);
      return;
    }
    const cwd = command?.cwdPolicy === "note_dir"
      ? dirname(document.filePath)
      : command?.cwdPolicy === "fixed"
        ? command.fixedCwd ?? workspaceSettingsRef.current?.workspaceRoot ?? ""
        : workspaceSettingsRef.current?.workspaceRoot ?? "";
    const fingerprint = await agentCommandExecutableFingerprintForRenderer(command);
    let trusted: boolean;
    try {
      trusted = (await window.exo.workspace.getAgentCommandTrust(draft.handle)).trusted;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      return;
    }
    const pending = { command, cwd, document, draft, fingerprint };
    if (!trusted) {
      setPendingInvocationAuthorization(pending);
      return;
    }
    await startInlineAgentInvocation(pending, false);
  }

  async function startInlineAgentInvocation(pending: PendingInvocationAuthorization, persistTrust: boolean) {
    // Authorization is a decision surface, not invocation status. Close it as
    // soon as the decision is made; failures belong to the document status UI.
    setPendingInvocationAuthorization(null);
    try {
      await saveDocument(pending.document.filePath);
      const persisted = await window.exo.notes.read(pending.document.filePath);
      const expectedBody = pending.document.kind === "markdown"
        ? markdownBodyAsSaved(pending.draft.documentBody)
        : pending.draft.documentBody;
      if (persisted.body !== expectedBody) {
        throw new Error("The document changed after this invocation was composed. Review the note and send it again.");
      }
      const result = await window.exo.workspace.launchAgentInvocation({
        handle: pending.draft.handle,
        protocolInvocationId: pending.draft.protocolInvocationId,
        documentPath: pending.document.filePath,
        mentionText: `@${pending.draft.handle}`,
        message: pending.draft.message,
        documentFrontmatter: persisted.frontmatter,
        documentBody: persisted.body,
        allowUntrustedOneShot: !persistTrust,
        persistTrust,
      });
      setKeptInvocationConflicts(new Set());
      setInvocationReview({ record: result.invocation });
      void loadInvocationReview(result.invocation);
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
    void loadInvocationReview(finalized);
  }

  async function loadInvocationReview(record: InvocationRecord) {
    if (record.diffRefs.length === 0) return;
    const payload = await window.exo.workspace.getInvocationReview(record.id).catch(() => null);
    setInvocationReview((current) => current?.record.id === record.id ? { record, payload } : current);
  }

  async function keepInvocationReview() {
    if (!invocationReview) return;
    const record = await window.exo.workspace.keepInvocationReview(invocationReview.record.id);
    if (record) { setInvocationReview({ record }); await loadInvocationReview(record); }
  }

  async function rejectInvocationReview() {
    if (!invocationReview?.payload) return;
    const taggedDocumentPath = invocationReview.record.taggedDocumentPath;
    if (taggedDocumentPath && openDocuments[taggedDocumentPath]?.dirty) {
      window.alert("Save or keep your unsaved editor changes before rejecting this invocation.");
      return;
    }
    if (!window.confirm("Reject this invocation’s document change and restore the version from before it ran?")) return;
    try {
      const record = await window.exo.workspace.rejectInvocationReview({
        invocationId: invocationReview.record.id,
        expectedAfterSha256: invocationReview.payload.invocation.review?.afterSha256 ?? null,
      });
      if (record.taggedDocumentPath) await reloadOpenDocumentFromDisk(record.taggedDocumentPath);
      setInvocationReview({ record });
      await loadInvocationReview(record);
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  }

  async function resumeInvocationInTerminal() {
    if (!invocationReview) return;
    try {
      await window.exo.workspace.resumeInvocationInTerminal(invocationReview.record.id);
      setInvocationReview(null);
      dispatchUtility({ type: "select", destination: "terminal" });
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
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
        activeFolderPath: null,
        openPaths: content.openPaths.includes(filePath) ? content.openPaths : [...content.openPaths, filePath],
      };
    });
    canvasActions.focusLeaf(leafId);
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
  }

  function openFolderOverview(directoryPath: string, leafId = focusedPaneId) {
    canvasActions.updateLeafContent(leafId, (content) => content.kind !== "editor" ? content : {
      ...content,
      activePath: null,
      activeFolderPath: directoryPath,
      openFolderPaths: (content.openFolderPaths ?? []).includes(directoryPath) ? content.openFolderPaths : [...(content.openFolderPaths ?? []), directoryPath],
    });
    canvasActions.focusLeaf(leafId);
    setActiveDocumentPath(null);
    setActiveTag(null);
    setTagResults([]);
  }

  function closeFolderOverview(leafId: PaneNodeId, directoryPath: string) {
    canvasActions.updateLeafContent(leafId, (content) => content.kind !== "editor" ? content : {
      ...content,
      openFolderPaths: (content.openFolderPaths ?? []).filter((path) => path !== directoryPath),
      activeFolderPath: content.activeFolderPath === directoryPath ? null : content.activeFolderPath,
      activePath: content.activeFolderPath === directoryPath ? content.openPaths.at(-1) ?? null : content.activePath,
    });
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
          return { kind: "editor", activePath: filePath, openPaths: [filePath], openFolderPaths: [], activeFolderPath: null };
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
    openFolderOverview(segment.path);
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
    flushSync(() => {
      setPreviewTabs((current) => addPreviewTab(current, { id, url }));
      dispatchUtility({ type: "select", destination: "preview" });
    });
  }

  async function createUtilityTerminal(kind: "shell", cwd?: string) {
    selectUtilitySurface("terminal");
    const session = await terminalState.createTerminal(kind, cwd);
    await terminalState.activateTerminal(session.id);
  }

  async function showUtilityTerminal(sessionId: string) {
    selectUtilitySurface("terminal");
    await terminalState.activateTerminal(sessionId);
  }

  function openUtilityTerminal() {
    selectUtilitySurface("terminal");
  }

  function toggleUtilitySurface() {
    dispatchUtility({ type: "toggle" });
  }

  function toggleConnectionsSurface() {
    dispatchUtility({ type: "close" });
  }

  function openConnectionsSurface() {
    selectUtilitySurface("connections");
  }

  function focusBrowserPane() {
    selectUtilitySurface("preview");
  }

  function selectUtilitySurface(destination: "terminal" | "preview" | "connections") {
    flushSync(() => dispatchUtility({ type: "select", destination }));
  }

  function closeBrowserPane() {
    if (!previewTabs.activeId) return;
    closeBrowserTab(previewTabs.activeId);
  }

  function closeBrowserTab(id: string) {
    const next = closePreviewTab(previewTabs, id);
    setPreviewTabs(next);
  }

  /**
   * Surface ids have one visual owner: either a canvas leaf or their matching
   * utility surface. Moving back removes only the matching canvas leaf; the
   * direct PTY itself remains owned by TerminalManager and is never restarted.
   */
  function returnSurfaceToUtility(surface: "terminal" | "preview", id: string, sourcePaneId?: string) {
    if (!sourcePaneId) {
      return;
    }
    const source = findNode(canvasTree, (node) => node.kind === "leaf" && node.id === sourcePaneId) as PaneLeaf | undefined;
    const matchesSource = source?.content.kind === "terminal"
      ? surface === "terminal" && source.content.terminalId === id
      : source?.content.kind === "browser"
        ? surface === "preview" && source.content.previewId === id
        : false;
    if (!matchesSource) {
      return;
    }

    canvasActions.setTree((previous) => {
      const current = findNode(previous, (node) => node.kind === "leaf" && node.id === sourcePaneId) as PaneLeaf | undefined;
      const matchesCurrent = current?.content.kind === "terminal"
        ? surface === "terminal" && current.content.terminalId === id
        : current?.content.kind === "browser"
          ? surface === "preview" && current.content.previewId === id
          : false;
      return matchesCurrent ? (removeNode(previous, sourcePaneId) ?? previous) : previous;
    });
    if (surface === "terminal") {
      dispatchUtility({ type: "select", destination: "terminal" });
      void terminalState.activateTerminal(id);
    } else {
      setPreviewTabs((current) => selectPreviewTab(current, id));
      dispatchUtility({ type: "select", destination: "preview" });
    }
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
      await window.exo.workspace.createFile(dailyPath);
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
          openFolderPaths: (leaf.content.openFolderPaths ?? []).map((folderPath) =>
            isPathWithin(sourcePath, folderPath) ? folderPath.replace(sourcePath, nextPath) : folderPath,
          ),
          activePath: leaf.content.activePath && isPathWithin(sourcePath, leaf.content.activePath)
            ? leaf.content.activePath.replace(sourcePath, nextPath)
            : leaf.content.activePath,
          activeFolderPath: leaf.content.activeFolderPath && isPathWithin(sourcePath, leaf.content.activeFolderPath)
            ? leaf.content.activeFolderPath.replace(sourcePath, nextPath)
            : leaf.content.activeFolderPath,
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
      const nextOpenFolderPaths = (leaf.content.openFolderPaths ?? []).filter((folderPath) => !isPathWithin(targetPath, folderPath));
      return {
        ...leaf,
        content: {
          ...leaf.content,
          openPaths: nextOpenPaths,
          openFolderPaths: nextOpenFolderPaths,
          activePath: leaf.content.activePath && !isPathWithin(targetPath, leaf.content.activePath)
            ? leaf.content.activePath
            : nextOpenPaths.at(-1) ?? null,
          activeFolderPath: leaf.content.activeFolderPath && !isPathWithin(targetPath, leaf.content.activeFolderPath)
            ? leaf.content.activeFolderPath
            : null,
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
            {onboardingState.mode === "first-run" ? "Set up Exo" : "Switch workspace"}
          </div>
          {onboardingState.step === "select" ? (
            <>
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">Choose a wiki</h1>
                <p className="onboarding-card__copy">
                  Each workspace begins with one main Markdown wiki. It keeps its own search, appearance, and agent settings.
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
                  New main wiki
                </button>
                <button
                  className="toolbar-button toolbar-button--primary"
                  data-testid="workspace-picker-open"
                  disabled={!onboardingState.selectedWorkspaceId || onboardingState.status === "saving"}
                  onClick={() => void workspaceBootstrap.activateSelectedWorkspace()}
                  type="button"
                >
                  {onboardingState.status === "saving" ? "Opening…" : "Open wiki"}
                </button>
              </div>
            </>
          ) : onboardingState.step === "configure" ? (
            <>
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">
                  {onboardingState.mode === "first-run" ? "Choose your main wiki" : "Choose a main wiki"}
                </h1>
                <p className="onboarding-card__copy">
                  Pick the Markdown folder Exo should treat as this workspace. You can make another Workspace for a separate wiki later.
                </p>
                <div className="onboarding-grid">
                  <div className="onboarding-section onboarding-section--primary">
                    <div className="onboarding-section__header">
                      <div>
                        <div className="dialog-field__label">Main wiki</div>
                        <div className="onboarding-section__hint">Required. Exo indexes Markdown inside this one folder.</div>
                      </div>
                      <button className="toolbar-button" data-testid="onboarding-choose-notes" onClick={() => void workspaceBootstrap.selectNotesFolderForOnboarding()} type="button">
                        Select
                      </button>
                    </div>
                    <PathList
                      emptyLabel="No main wiki selected."
                      paths={onboardingState.notesFolder ? [onboardingState.notesFolder] : []}
                      testId="onboarding-notes-folder"
                      onRemove={() =>
                        setOnboardingState((current) =>
                          current ? { ...current, notesFolder: "", status: "idle", errorMessage: null } : current,
                        )
                      }
                    />
                  </div>
                  <details className="onboarding-section onboarding-section--advanced">
                    <summary>Advanced</summary>
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
                  </details>
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
                  onClick={() => setOnboardingState((current) => current ? { ...current, step: "mcp", status: "idle", errorMessage: null } : current)}
                  type="button"
                >
                  Continue to MCP
                </button>
              </div>
            </>
          ) : onboardingState.step === "agents" ? (
            <>
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">Set up agents</h1>
                <p className="onboarding-card__copy">
                  Exo invokes agents through their installed local CLIs. These commands stay on this computer and can be edited later in Settings.
                </p>
                <div className="onboarding-agent-list">
                  {onboardingState.agentCommands.map((command) => (
                    <div className="onboarding-agent" key={command.id}>
                      <label className="onboarding-agent__enabled">
                        <input
                        checked={command.enabled}
                        type="checkbox"
                        onChange={(event) => setOnboardingState((current) => current ? {
                          ...current,
                          agentCommands: current.agentCommands.map((entry) => entry.id === command.id ? { ...entry, enabled: event.target.checked } : entry),
                        } : current)}
                        />
                        <span className="sr-only">Enable {command.label}</span>
                      </label>
                      <span className="onboarding-agent__copy">
                        <strong>{command.label} <em>Recommended</em></strong>
                        <span>@{command.handle}</span>
                        <input
                          aria-label={`${command.label} command`}
                          className="onboarding-agent__command"
                          spellCheck={false}
                          type="text"
                          value={command.command}
                          onChange={(event) => setOnboardingState((current) => current ? {
                            ...current,
                            agentCommands: current.agentCommands.map((entry) => entry.id === command.id ? { ...entry, command: event.target.value } : entry),
                          } : current)}
                        />
                        {command.adapter === "claude-code" ? (
                          <label className="dialog-check dialog-check--inline">
                            <input
                              checked={command.continuityPolicy === "continuous"}
                              type="checkbox"
                              onChange={(event) => setOnboardingState((current) => current ? {
                                ...current,
                                agentCommands: current.agentCommands.map((entry) => entry.id === command.id
                                  ? { ...entry, continuityPolicy: event.target.checked ? "continuous" : "fresh" }
                                  : entry),
                              } : current)}
                            />
                            <span>Keep context</span>
                          </label>
                        ) : (
                          <span className="onboarding-agent__continuity-unavailable">Context unavailable</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="onboarding-section onboarding-section--summary">
                  <div className="dialog-field__label">How invocations run</div>
                  <div className="onboarding-section__hint">Messages are sent headlessly from the main wiki. Exo shows any document changes for review; it never grants a provider broader file access itself.</div>
                </div>
                <details className="agent-invocation-prompt-disclosure">
                  <summary>Advanced</summary>
                  <AgentInvocationPromptEditor
                    onSave={(agentInvocationPrompt) => setOnboardingState((current) => current ? { ...current, agentInvocationPrompt, status: "idle", errorMessage: null } : current)}
                    testId="onboarding-invocation-prompt"
                    value={onboardingState.agentInvocationPrompt}
                  />
                </details>
              </div>
              <div className="onboarding-card__actions">
                <button className="toolbar-button" onClick={() => setOnboardingState((current) => current ? { ...current, step: "mcp", errorMessage: null } : current)} type="button">Back</button>
                <button className="toolbar-button toolbar-button--primary" disabled={onboardingState.status === "saving"} onClick={() => void workspaceBootstrap.completeOnboarding()} type="button">{onboardingState.status === "saving" ? "Opening…" : "Open Exo"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="onboarding-card__body" data-testid="onboarding-card-body">
                <h1 className="onboarding-card__title">Agent access</h1>
                <p className="onboarding-card__copy">
                  MCP for tools. CLI for shells.
                </p>
                <div className="onboarding-section onboarding-section--primary">
                  <section className="onboarding-access" aria-labelledby="onboarding-mcp-title">
                    <div className="onboarding-access__header">
                      <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.8} />
                      <div><strong id="onboarding-mcp-title">MCP</strong><span>Read-only context · 2 tools</span></div>
                    </div>
                    <div className="onboarding-provider-menu" aria-label="Install Exo MCP in">
                      <div className="onboarding-provider-menu__title">Install in</div>
                      {(["claude", "codex"] as const).map((provider) => (
                        <button
                          aria-pressed={onboardingMcp.providers.includes(provider)}
                          className={`onboarding-provider-menu__item ${onboardingMcp.providers.includes(provider) ? "onboarding-provider-menu__item--active" : ""}`}
                          key={provider}
                          onClick={() => setOnboardingMcp((current) => ({
                            ...current,
                            providers: current.providers.includes(provider) ? current.providers.filter((entry) => entry !== provider) : [...current.providers, provider],
                            status: "idle", errorMessage: null, results: [],
                          }))}
                          type="button"
                        >
                          <AgentIcon kind={provider} size={16} />
                          <span className="onboarding-provider-menu__copy">
                            <span>{provider === "claude" ? "Claude" : "Codex"}</span>
                            <small>{provider === "claude" ? "claude mcp add" : "codex mcp add"}</small>
                          </span>
                          {onboardingMcp.providers.includes(provider) ? <Check aria-label="Selected" size={15} strokeWidth={2.2} /> : null}
                        </button>
                      ))}
                    </div>
                    <ul className="onboarding-mcp-tools" aria-label="Exo MCP tools">
                      <li>
                        <Database aria-hidden="true" size={16} strokeWidth={1.8} />
                        <span className="onboarding-mcp-tools__copy"><code>workspace_status</code><span>Wiki and search health</span></span>
                        <span className="onboarding-mcp-tools__access">Read</span>
                      </li>
                      <li>
                        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
                        <span className="onboarding-mcp-tools__copy"><code>search_notes</code><span>Paths, titles, and snippets</span></span>
                        <span className="onboarding-mcp-tools__access">Read</span>
                      </li>
                    </ul>
                    <div className="onboarding-card__actions onboarding-card__actions--inline">
                      <button className="toolbar-button" disabled={onboardingMcp.providers.length === 0 || onboardingMcp.status === "saving"} onClick={() => void (async () => {
                        setOnboardingMcp((current) => ({ ...current, status: "saving", errorMessage: null, results: [] }));
                        try {
                          const results = await window.exo.workspace.configureProviderMcp({ providers: onboardingMcp.providers });
                          setOnboardingMcp((current) => ({ ...current, status: results.every((result) => result.ok) ? "done" : "error", results, errorMessage: results.some((result) => !result.ok) ? "MCP setup needs attention." : null }));
                        } catch (error) {
                          setOnboardingMcp((current) => ({ ...current, status: "error", errorMessage: error instanceof Error ? error.message : String(error), results: [] }));
                        }
                      })()} type="button">{onboardingMcp.status === "saving" ? "Installing…" : "Install MCP"}</button>
                    </div>
                    {onboardingMcp.errorMessage ? <div className="dialog-card__status dialog-card__status--error">{onboardingMcp.errorMessage}</div> : null}
                    {onboardingMcp.results.map((result) => <div className={`dialog-card__status${result.ok ? "" : " dialog-card__status--error"}`} key={result.provider}>{result.detail}</div>)}
                  </section>
                  <section className="onboarding-access onboarding-access--cli" aria-labelledby="onboarding-cli-title">
                    <div className="onboarding-access__header">
                      <SquareTerminal aria-hidden="true" size={16} strokeWidth={1.8} />
                      <div><strong id="onboarding-cli-title">CLI</strong><span>For shell-capable clients</span></div>
                    </div>
                    <div className="onboarding-cli-context"><code>exo search</code><code>exo open</code><code>exo invoke</code></div>
                    <p className="onboarding-section__hint">Search returns paths. Agents use their own filesystem tools to inspect them.</p>
                    <p className="onboarding-section__hint">Install or update the local command with <code>./scripts/install-local</code>. MCP setup never changes it.</p>
                  </section>
                </div>
              </div>
              <div className="onboarding-card__actions">
                <button className="toolbar-button" onClick={() => setOnboardingState((current) => current ? { ...current, step: "configure", errorMessage: null } : current)} type="button">Back</button>
                <button className="toolbar-button toolbar-button--primary" onClick={() => setOnboardingState((current) => current ? { ...current, step: "agents", errorMessage: null } : current)} type="button">Set up CLI agents</button>
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
  const canvasLeaves = collectLeaves(canvasTree);
  const canvasTerminalIds = new Set(canvasLeaves.flatMap((leaf) => leaf.content.kind === "terminal" ? [leaf.content.terminalId] : []));
  const canvasPreviewIds = new Set(canvasLeaves.flatMap((leaf) => leaf.content.kind === "browser" ? [leaf.content.previewId] : []));
  const utilityTerminalSessions = terminalSessions.filter((session) => !canvasTerminalIds.has(session.id));
  const utilityPreviewTabs = previewTabs.tabs.filter((tab) => !canvasPreviewIds.has(tab.id));
  const activePreview = utilityPreviewTabs.find((tab) => tab.id === previewTabs.activeId) ?? utilityPreviewTabs[0] ?? null;
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
      tabs={utilityPreviewTabs}
      activeTabId={activePreview.id}
      onSelectTab={(id) => setPreviewTabs((current) => selectPreviewTab(current, id))}
      onCreateTab={() => createBrowserPane()}
      onCloseTab={closeBrowserTab}
      dragManager={dragManager}
    />
  ) : utilityState.destination === "preview" ? (
    <section className="utility-preview-empty" data-testid="preview-empty-state">
      <div>
        <strong>Preview</strong>
        <p>Open a local file or localhost URL when you want to inspect it.</p>
      </div>
      <button className="utility-preview-empty__action" onClick={() => createBrowserPane()} type="button">New preview</button>
    </section>
  ) : utilityState.destination === "terminal" ? (
    <TerminalDock
      paneId="utility-terminal"
      compact={false}
      empty={utilityTerminalSessions.length === 0}
      focused={utilityState.open}
      sessions={utilityTerminalSessions}
      activeTerminalId={utilityTerminalSessions.some((session) => session.id === activeTerminalId) ? activeTerminalId : utilityTerminalSessions[0]?.id ?? null}
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
      onOpenFolder={(directoryPath) => openFolderOverview(directoryPath)}
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
      sidebarCollapsed={shellLayout.sidebarCollapsed}
      sidebarWidth={shellLayout.sidebarWidth}
      utilityWidth={shellLayout.utilityWidth}
      onToggleSidebar={() => shellLayout.setSidebarCollapsed((current) => !current)}
      onResizeSidebar={(event) => shellLayout.startSidebarResize(event)}
      onResizeUtility={shellLayout.startUtilityResize}
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
        if (leaf.content.kind === "terminal") {
          const terminalId = leaf.content.terminalId;
          const session = terminalSessions.find((entry) => entry.id === terminalId);
          if (!session) {
            return <section className="utility-preview-empty"><div><strong>Terminal closed</strong><p>This shell is no longer running.</p></div></section>;
          }
          return (
            <TerminalDock
              paneId={leaf.id}
              compact={false}
              empty={false}
              focused={isFocused}
              sessions={[session]}
              activeTerminalId={session.id}
              hydrationSnapshots={terminalHydrationSnapshots}
              hydrationVersions={terminalHydrationVersions}
              hydrationReasons={terminalHydrationReasons}
              hydratingTerminalIds={terminalState.hydratingTerminalIds}
              theme={resolvedTheme}
              fontSize={terminalFontSize}
              scrollbackLines={terminalRuntimeScrollbackLines}
              onFocus={() => canvasActions.focusLeaf(leaf.id)}
              onHydrate={(id, options) => void terminalState.hydrateTerminal(id, options)}
              onHydrated={(id) => terminalState.markTerminalHydrated(id)}
              onSetActiveTerminal={(id) => void terminalState.activateTerminal(id)}
              onWrite={(id, data) => void window.exo.terminals.write(id, data)}
              onGeometryMeasured={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
              onKill={(id) => void terminalState.killTerminal(id)}
              onCreateTerminal={() => void createUtilityTerminal("shell")}
              onClosePane={() => canvasActions.removeLeaf(leaf.id)}
              dragManager={dragManager}
            />
          );
        }
        if (leaf.content.kind === "browser") {
          const previewId = leaf.content.previewId;
          const tab = previewTabs.tabs.find((entry) => entry.id === previewId);
          if (!tab) {
            return <section className="utility-preview-empty"><div><strong>Preview closed</strong><p>This preview is no longer open.</p></div></section>;
          }
          return (
            <BrowserPane
              paneId={leaf.id}
              url={tab.url}
              compact={false}
              onFocus={() => canvasActions.focusLeaf(leaf.id)}
              onNavigate={async (target) => {
                const result = await window.exo.workspace.resolvePreviewTarget(target);
                setPreviewTabs((current) => updatePreviewTabUrl(current, tab.id, result.url));
                return result.url;
              }}
              onClosePane={() => canvasActions.removeLeaf(leaf.id)}
              tabs={[tab]}
              activeTabId={tab.id}
              dragManager={dragManager}
            />
          );
        }
        const pane: EditorPaneState = {
          id: leaf.id,
          openPaths: leaf.content.openPaths,
          activePath: leaf.content.activePath,
          openFolderPaths: leaf.content.openFolderPaths,
          activeFolderPath: leaf.content.activeFolderPath,
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
              onActivateFolder={(directoryPath) => openFolderOverview(directoryPath, leaf.id)}
              onCloseFolder={(directoryPath) => closeFolderOverview(leaf.id, directoryPath)}
              onOpenFolder={(directoryPath) => openFolderOverview(directoryPath, leaf.id)}
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
              onInvokeAgent={(draft) => void invokeInlineAgent(draft)}
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
                      reviewPayload: invocationReview.payload ?? null,
                      onKeepReview: () => void keepInvocationReview(),
                      onRejectReview: () => void rejectInvocationReview(),
                      onResumeInTerminal: invocationReview.record.providerSessionId ? () => void resumeInvocationInTerminal() : undefined,
                      onDismiss: () => setInvocationReview(null),
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
      onExpandDirectory={(directoryPath) => void workspaceTrees.expandTreeDirectory(directoryPath)}
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

      {pendingInvocationAuthorization ? (
        <InvocationAuthorizationDialog
          command={pendingInvocationAuthorization.command.command}
          commandLabel={pendingInvocationAuthorization.command.label}
          cwd={pendingInvocationAuthorization.cwd || "Workspace root"}
          documentPath={pendingInvocationAuthorization.document.filePath}
          fingerprint={pendingInvocationAuthorization.fingerprint}
          message={pendingInvocationAuthorization.draft.message}
          onCancel={() => setPendingInvocationAuthorization(null)}
          onRun={(persistTrust) => void startInlineAgentInvocation(pendingInvocationAuthorization, persistTrust)}
        />
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

function markdownBodyAsSaved(body: string): string {
  return body.endsWith("\n") ? body : `${body}\n`;
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
