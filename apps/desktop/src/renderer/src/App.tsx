import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  BranchFamily,
  IndexStatus,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  TreeNode,
  WorkspaceModel,
  WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo, WorkspaceGitStatus } from "../../shared/api";
import type { FileStatInfo } from "../../shared/api";

import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { InspectorDock } from "./components/InspectorDock";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { useOpenDocumentVersionPolling } from "./hooks/useOpenDocumentVersionPolling";
import { useShellLayout } from "./hooks/useShellLayout";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { collectLeaves, findEditorLeaf, findNode, findTerminalLeaf, findTerminalLeafBySessionId, mapLeaves, pruneEmptyLeaves, updateNode, type PaneLeaf, type PaneNode, type PaneNodeId, type EditorPaneContent, type TerminalPaneContent } from "./hooks/usePaneTree";
import { useDragManager, type DragPayload, type DropEdge } from "./hooks/useDragManager";

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
    };

interface WorkspaceSettingsDialogState {
  section: WorkspaceSettingsSection;
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string;
  projectRoots: string;
  indexedRoots: string;
  indexMode: WorkspaceSettings["indexing"]["mode"];
  indexStatusSummary: string;
  appearanceMode: AppearanceMode;
  editorFontSize: string;
  terminalFontSize: string;
  terminalScrollbackLines: string;
  terminalBufferChars: string;
  explorerScale: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  errorMessage: string | null;
  appliedWorkspaceKey: string;
  applyStatus: "idle" | "applying" | "applied" | "error";
  applyErrorMessage: string | null;
}

// DragState replaced by useDragManager — see DragPayload in hooks/useDragManager.ts

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";
type ZoomSurface = "editor" | "terminal" | "explorer";
type WorkspaceSettingsSection = "workspace" | "index" | "appearance" | "terminal";
type IndexBusyState = "updating" | "embedding" | null;

const DEFAULT_TERMINAL_SCROLLBACK_LINES = 5_000;
const DEFAULT_TERMINAL_BUFFER_CHARS = 80_000;
const MAX_PENDING_TERMINAL_CHUNK_LENGTH = 8_000;
const NOTE_TREE_MAX_DEPTH = 3;
const PROJECT_TREE_MAX_DEPTH = 3;
const DEFAULT_EDITOR_FONT_SIZE = 15;
const DEFAULT_TERMINAL_FONT_SIZE = 13;
const DEFAULT_EXPLORER_SCALE = 1;

export function App() {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [noteTrees, setNoteTrees] = useState<Record<string, TreeNode[]>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, TreeNode[]>>({});
  const workspaceSearch = useWorkspaceSearch();
  const [openDocuments, setOpenDocuments] = useState<Record<string, OpenEditorDocument>>({});
  const [knowledgeByPath, setKnowledgeByPath] = useState<Record<string, NoteKnowledge>>({});
  const [branchFamiliesByPath, setBranchFamiliesByPath] = useState<Record<string, BranchFamily>>({});
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [workspaceGitStatus, setWorkspaceGitStatus] = useState<WorkspaceGitStatus | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const handleDropRef = useRef<(leafId: string, edge: DropEdge, payload: DragPayload) => void>(() => {});
  const dragManager = useDragManager((leafId, edge, payload) => handleDropRef.current(leafId, edge, payload));
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const [, setAgentAnnotations] = useState<Record<string, { runLabel: string; parentId: string | null }>>({});
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState | null>(null);
  const [workspaceSettingsDialog, setWorkspaceSettingsDialog] = useState<WorkspaceSettingsDialogState | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexBusy, setIndexBusy] = useState<IndexBusyState>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("system");
  const [zoomSurface, setZoomSurface] = useState<ZoomSurface>("editor");
  const [editorFontSize, setEditorFontSize] = useState(DEFAULT_EDITOR_FONT_SIZE);
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE);
  const [terminalScrollbackLines, setTerminalScrollbackLines] = useState(DEFAULT_TERMINAL_SCROLLBACK_LINES);
  const [explorerScale, setExplorerScale] = useState(DEFAULT_EXPLORER_SCALE);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const pendingTerminalChunksRef = useRef<Record<string, string>>({});
  const terminalFlushFrameRef = useRef<number | null>(null);
  const bootstrapRunRef = useRef(0);
  const activeTerminalIdsRef = useRef<Set<string>>(new Set());
  const terminalSessionsRef = useRef<TerminalSessionInfo[]>([]);
  const terminalKindByIdRef = useRef<Record<string, TerminalSessionInfo["kind"]>>({});
  const openDocumentsRef = useRef(openDocuments);
  const activeDocumentPathRef = useRef(activeDocumentPath);
  const pendingDocumentRefreshesRef = useRef<Map<string, { timeoutId: number; diskVersion: FileStatInfo | null }>>(new Map());
  const loadedTreeDirectoriesRef = useRef<Set<string>>(new Set());
  const workspaceSettingsRef = useRef<WorkspaceSettings | null>(null);
  const shellLayout = useShellLayout();

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
    openDocumentsRef.current = openDocuments;
  }, [openDocuments]);

  useEffect(() => {
    activeDocumentPathRef.current = activeDocumentPath;
  }, [activeDocumentPath]);

  useEffect(() => {
    const projectRoot = workspaceModel?.projectRoots[0] ?? null;
    if (!projectRoot) {
      setWorkspaceGitStatus(null);
      return;
    }

    let cancelled = false;
    void window.exo.workspace.getGitStatus(projectRoot.path).then((status) => {
      if (!cancelled) {
        setWorkspaceGitStatus(status);
      }
    }).catch(() => {
      if (!cancelled) {
        setWorkspaceGitStatus(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceModel]);

  const scheduleOpenDocumentRefreshCallback = useCallback(
    (filePath: string, diskVersion: FileStatInfo) => scheduleOpenDocumentRefresh(filePath, diskVersion),
    [],
  );
  useOpenDocumentVersionPolling(openDocumentsRef, pendingDocumentRefreshesRef, scheduleOpenDocumentRefreshCallback);

  useEffect(() => {
    const activeIds = new Set<string>();
    for (const leaf of collectLeaves(terminalTree)) {
      if (leaf.content.kind === "terminal" && leaf.content.activeTerminalId) {
        activeIds.add(leaf.content.activeTerminalId);
      }
    }
    if (activeTerminalId) {
      activeIds.add(activeTerminalId);
    }
    activeTerminalIdsRef.current = activeIds;
    void window.exo.terminals.setStreaming(Array.from(activeIds));
  }, [activeTerminalId, terminalTree]);

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
    const activeTerminalIds = collectActiveTerminalIds(terminalTree);
    if (activeTerminalId) {
      activeTerminalIds.add(activeTerminalId);
    }
    setTerminalBuffers((current) => pruneRecordToKeys(current, activeTerminalIds));
  }, [activeTerminalId, terminalTree]);
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
      const [model, settings, status] = await Promise.all([
        window.exo.workspace.getModel(),
        window.exo.workspace.getSettings(),
        window.exo.workspace.getIndexStatus(),
      ]);
      workspaceSettingsRef.current = settings;
      setAppearanceMode(settings.appearanceMode);
      setEditorFontSize(settings.editorFontSize);
      setTerminalFontSize(settings.terminalFontSize);
      setTerminalScrollbackLines(settings.terminalScrollbackLines);
      setExplorerScale(settings.explorerScale);
      setIndexStatus(status);
      const [nextNoteTrees, nextProjectTrees] = await Promise.all([
        Promise.all(
          model.noteRoots.map(
            async (root) =>
              [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: NOTE_TREE_MAX_DEPTH, includeEmptyDirectories: true })] as const,
          ),
        ),
        Promise.all(
          model.projectRoots.map(
            async (root) => [root.path, await window.exo.workspace.listTree(root.path, { maxDepth: PROJECT_TREE_MAX_DEPTH })] as const,
          ),
        ),
      ]);

      if (cancelled) {
        return;
      }

      const firstNote = pickInitialNote(nextNoteTrees);
      const defaultTerminal = await window.exo.terminals.ensureDefault();
      const sessions = await window.exo.terminals.list();
      const defaultTerminalBuffer = await window.exo.terminals.read(defaultTerminal.id);

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
        await openFile(firstNote.path, editorFocusedLeafId);
      }

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      setNoteTrees(Object.fromEntries(nextNoteTrees));
      setProjectTrees(Object.fromEntries(nextProjectTrees));
      loadedTreeDirectoriesRef.current = new Set([
        ...model.noteRoots.map((root) => treeLoadKey("notes", root.path)),
        ...model.projectRoots.map((root) => treeLoadKey("projects", root.path)),
      ]);
      setTerminalSessions(sessions);
      setActiveTerminalId(defaultTerminal.id);
      setTerminalBuffers({ [defaultTerminal.id]: trimTerminalBuffer(defaultTerminalBuffer, settings.terminalBufferChars) });

      // Seed the default terminal into the terminal tree
      const termLeaf = findTerminalLeaf(terminalTree);
      if (termLeaf) {
        terminalActions.updateLeafContent(termLeaf.id, (content) => {
          if (content.kind !== "terminal") return content;
          return {
            ...content,
            terminalIds: sessions.map((s) => s.id),
            activeTerminalId: defaultTerminal.id,
          };
        });
      }
    }

    void bootstrap();

    function flushTerminalChunks() {
      terminalFlushFrameRef.current = null;
      const pending = pendingTerminalChunksRef.current;
      pendingTerminalChunksRef.current = {};
      const entries = Object.entries(pending);
      if (entries.length === 0) {
        return;
      }

      setTerminalBuffers((current) => {
        const next = { ...current };
        for (const [id, chunk] of entries) {
          next[id] = trimTerminalBuffer(`${next[id] ?? ""}${chunk}`, workspaceSettingsRef.current?.terminalBufferChars ?? DEFAULT_TERMINAL_BUFFER_CHARS);
        }
        return next;
      });
    }

    const removeDataListener = window.exo.terminals.onData(({ id, data }) => {
      if (!activeTerminalIdsRef.current.has(id)) {
        return;
      }

      pendingTerminalChunksRef.current[id] = `${pendingTerminalChunksRef.current[id] ?? ""}${data}`.slice(
        -MAX_PENDING_TERMINAL_CHUNK_LENGTH,
      );
      if (terminalFlushFrameRef.current !== null) {
        return;
      }

      terminalFlushFrameRef.current = window.requestAnimationFrame(flushTerminalChunks);
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
        setTerminalSessions(sessions);
        if (unseenSessions.length > 0) {
          adoptExternalTerminalSessions(unseenSessions, { activateLatest: true });
        }
      });
    }, 1500);

    return () => {
      cancelled = true;
      if (terminalFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalFlushFrameRef.current);
      }
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
      const buffer = await window.exo.terminals.read(activeTerminalId);
      if (cancelled) {
        return;
      }
      const nextBuffer = trimTerminalBuffer(buffer, workspaceSettingsRef.current?.terminalBufferChars ?? DEFAULT_TERMINAL_BUFFER_CHARS);
      setTerminalBuffers((current) =>
        current[activeTerminalId] === nextBuffer ? current : { ...current, [activeTerminalId]: nextBuffer },
      );
    }

    void refreshActiveAgentBuffer();

    return () => {
      cancelled = true;
    };
  }, [activeTerminalId, terminalSessions]);

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
        scheduleOpenDocumentRefresh(event.filePath);
      }
    });

    return () => {
      removeWorkspaceChangeListener();
    };
  }, [workspaceModel]);

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

  // Auto-save dirty documents every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const dirtyPaths = Object.entries(openDocuments)
        .filter(([, doc]) => doc.dirty)
        .map(([path]) => path);
      for (const filePath of dirtyPaths) {
        void saveDocument(filePath);
      }
    }, 5000);
    return () => clearInterval(timer);
  });

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

  async function reloadTrees() {
    if (!workspaceModel) {
      return;
    }

    await reloadTreesForModel(workspaceModel);
  }

  async function reloadTreesForModel(model: WorkspaceModel) {
    const [nextNoteTrees, nextProjectTrees] = await Promise.all([
      Promise.all(
        model.noteRoots.map(
          async (root) =>
            [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: NOTE_TREE_MAX_DEPTH, includeEmptyDirectories: true })] as const,
        ),
      ),
      Promise.all(
        model.projectRoots.map(
          async (root) => [root.path, await window.exo.workspace.listTree(root.path, { maxDepth: PROJECT_TREE_MAX_DEPTH })] as const,
        ),
      ),
    ]);

    setNoteTrees(Object.fromEntries(nextNoteTrees));
    setProjectTrees(Object.fromEntries(nextProjectTrees));
    loadedTreeDirectoriesRef.current = new Set([
      ...model.noteRoots.map((root) => treeLoadKey("notes", root.path)),
      ...model.projectRoots.map((root) => treeLoadKey("projects", root.path)),
    ]);
  }

  async function refreshWorkspaceModel() {
    const [model] = await Promise.all([
      window.exo.workspace.getModel(),
      refreshIndexStatus(),
    ]);
    setWorkspaceModel(model);
    await reloadTreesForModel(model);
  }

  async function expandTreeDirectory(directoryPath: string, rootKind: "notes" | "projects") {
    const loadKey = treeLoadKey(rootKind, directoryPath);
    if (loadedTreeDirectoriesRef.current.has(loadKey)) {
      return;
    }
    const currentTrees = rootKind === "notes" ? noteTrees : projectTrees;
    if (treeDirectoryHasChildrenInRoots(currentTrees, directoryPath)) {
      loadedTreeDirectoriesRef.current.add(loadKey);
      return;
    }
    loadedTreeDirectoriesRef.current.add(loadKey);

    const children = await window.exo.workspace.listTree(directoryPath, {
      markdownOnly: rootKind === "notes",
      maxDepth: 1,
      includeEmptyDirectories: rootKind === "notes",
    });

    if (rootKind === "notes") {
      setNoteTrees((current) => replaceTreeChildrenInRoots(current, directoryPath, children));
    } else {
      setProjectTrees((current) => replaceTreeChildrenInRoots(current, directoryPath, children));
    }
  }

  async function refreshIndexStatus() {
    const status = await window.exo.workspace.getIndexStatus();
    setIndexStatus(status);
    setWorkspaceSettingsDialog((current) =>
      current
        ? {
            ...current,
            indexStatusSummary: formatIndexStatus(status),
          }
        : current,
    );
    return status;
  }

  async function openWorkspaceSettingsDialog(section: WorkspaceSettingsSection = "workspace") {
    const settings = await window.exo.workspace.getSettings();
    const indexStatus = await window.exo.workspace.getIndexStatus();
    setIndexStatus(indexStatus);
    const appliedWorkspaceKey = workspaceSettingsStructuralKeyFromSettings(settings);
    setWorkspaceSettingsDialog({
      section,
      workspaceRoot: settings.workspaceRoot,
      defaultTerminalCwd: settings.defaultTerminalCwd,
      noteRoots: settings.noteRoots.join("\n"),
      projectRoots: settings.projectRoots.join("\n"),
      indexedRoots: settings.indexedRoots.map((root) => root.path).join("\n"),
      indexMode: settings.indexing.mode,
      indexStatusSummary: formatIndexStatus(indexStatus),
      appearanceMode: settings.appearanceMode,
      editorFontSize: String(settings.editorFontSize),
      terminalFontSize: String(settings.terminalFontSize),
      terminalScrollbackLines: String(settings.terminalScrollbackLines),
      terminalBufferChars: String(settings.terminalBufferChars),
      explorerScale: String(settings.explorerScale),
      saveStatus: "idle",
      errorMessage: null,
      appliedWorkspaceKey,
      applyStatus: "idle",
      applyErrorMessage: null,
    });
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
      const status = action === "embedding" ? await window.exo.workspace.embedIndex() : await window.exo.workspace.updateIndex();
      setIndexStatus(status);
      setWorkspaceSettingsDialog((current) =>
        current
          ? {
              ...current,
              indexStatusSummary: formatIndexStatus(status),
            }
          : current,
      );
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
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
      projectRoots: settingsDialog.projectRoots
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
      indexedRoots: settingsDialog.indexedRoots
        .split("\n")
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
      terminalScrollbackLines: clampNumber(Number(settingsDialog.terminalScrollbackLines), 500, 100_000),
      terminalBufferChars: clampNumber(Number(settingsDialog.terminalBufferChars), 12_000, 2_000_000),
      explorerScale: clampNumber(Number(settingsDialog.explorerScale), 0.82, 1.35),
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
      setTerminalScrollbackLines(saved.terminalScrollbackLines);
      setTerminalBuffers((current) => mapRecordValues(current, (buffer) => trimTerminalBuffer(buffer, saved.terminalBufferChars)));
      setExplorerScale(saved.explorerScale);
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
    editorActions.setTree((prev) => {
      const next = mapLeaves(prev, (leaf) => {
        if (leaf.id !== leafId || leaf.content.kind !== "editor") return leaf;
        const nextOpenPaths = leaf.content.openPaths.filter((p) => p !== filePath);
        const closedIndex = leaf.content.openPaths.indexOf(filePath);
        const nextActivePath = leaf.content.activePath === filePath
          ? (nextOpenPaths[Math.max(0, closedIndex - 1)] ?? nextOpenPaths[0] ?? null)
          : leaf.content.activePath;
        return { ...leaf, content: { ...leaf.content, openPaths: nextOpenPaths, activePath: nextActivePath } };
      });
      return pruneEmptyLeaves(next, (leaf) => leaf.content.kind === "editor" && leaf.content.openPaths.length === 0);
    });

    setTimeout(() => {
      const focused = findNode(editorTree, (n) => n.id === editorFocusedLeafId) as PaneLeaf | undefined;
      const nextPath = focused?.content.kind === "editor" ? focused.content.activePath : null;
      setActiveDocumentPath(nextPath);
      if (!nextPath) {
        setActiveTag(null);
        setTagResults([]);
        const editorLeavesNow = collectLeaves(editorTree).filter((l) => l.content.kind === "editor");
        const allEmpty = editorLeavesNow.every(
          (l) => l.content.kind === "editor" && l.content.openPaths.length === 0,
        );
        if (allEmpty) {
          void openOrCreateDailyNote();
        }
      }
    }, 0);
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

    const scrollTop = filePath === activeDocumentPathRef.current ? getActiveEditorScrollTop() : null;
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
      restoreActiveEditorScrollTop(scrollTop);
    }
  }

  async function openFile(filePath: string, leafId?: PaneNodeId) {
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
  }

  async function saveDocument(filePath: string) {
    const document = openDocuments[filePath];
    if (!document) {
      return;
    }

    await window.exo.notes.save(filePath, document.frontmatter, document.body);
    const diskVersion = await window.exo.notes.stat(filePath);
    const remainsOpen = collectOpenEditorPaths(editorTree).has(filePath);
    if (document.kind === "markdown" && remainsOpen) {
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
    void window.exo.terminals.read(latest.id).then((buffer) => {
      setTerminalBuffers((current) => ({
        ...current,
        [latest.id]: trimTerminalBuffer(buffer, workspaceSettingsRef.current?.terminalBufferChars ?? DEFAULT_TERMINAL_BUFFER_CHARS),
      }));
    });
  }

  async function activateTerminal(leafId: PaneNodeId, id: string) {
    terminalActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "terminal") return content;
      return { ...content, activeTerminalId: id };
    });
    setActiveTerminalId(id);
    const buffer = await window.exo.terminals.read(id);
    setTerminalBuffers((current) => ({
      ...current,
      [id]: trimTerminalBuffer(buffer, workspaceSettingsRef.current?.terminalBufferChars ?? DEFAULT_TERMINAL_BUFFER_CHARS),
    }));
  }

  async function closeTerminal(id: string) {
    await window.exo.terminals.kill(id);
    setTerminalSessions((current) => current.filter((session) => session.id !== id));
    setTerminalBuffers((current) => {
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

    // Remove the session from whichever leaf holds it, then prune any leaf left empty.
    terminalActions.setTree((prev) => {
      const next = mapLeaves(prev, (leaf) => {
        if (leaf.content.kind !== "terminal" || !leaf.content.terminalIds.includes(id)) return leaf;
        const nextIds = leaf.content.terminalIds.filter((tid) => tid !== id);
        return {
          ...leaf,
          content: {
            ...leaf.content,
            terminalIds: nextIds,
            activeTerminalId: leaf.content.activeTerminalId === id ? (nextIds.at(-1) ?? null) : leaf.content.activeTerminalId,
          },
        };
      });
      return pruneEmptyLeaves(next, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
    });

    if (activeTerminalId === id) {
      const fallback = terminalSessions.find((session) => session.id !== id);
      setActiveTerminalId(fallback?.id ?? null);
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
  handleDropRef.current = (leafId: string, edge: DropEdge, payload: DragPayload) => {
    if (payload.kind === "document") {
      handleDocumentDrop(leafId, edge, payload.filePath, payload.sourcePaneId);
    } else {
      handleTerminalDrop(leafId, edge, payload.sessionId);
    }
  };

  function handleDocumentDrop(leafId: PaneNodeId, edge: DropEdge, filePath: string, sourceLeafId?: string) {
    // Ensure the document content is loaded (may be a new file dragged from explorer)
    void ensureDocumentLoaded(filePath);

    // All operations are within the editor tree only.
    const isEmptyEditor = (leaf: PaneLeaf) =>
      leaf.content.kind === "editor" && leaf.content.openPaths.length === 0;

    if (edge === "center") {
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

      const direction: "horizontal" | "vertical" = (edge === "left" || edge === "right") ? "horizontal" : "vertical";
      const position: "before" | "after" = (edge === "left" || edge === "top") ? "before" : "after";
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
    // All operations are within the terminal tree only.
    // Single atomic update: move session, then prune any empty source leaf.
    if (edge === "center") {
      terminalActions.setTree((prev) => {
        const moved = mapLeaves(prev, (leaf) => {
          if (leaf.content.kind !== "terminal") return leaf;
          if (leaf.id === leafId) {
            return {
              ...leaf,
              content: {
                ...leaf.content,
                terminalIds: leaf.content.terminalIds.includes(sessionId) ? leaf.content.terminalIds : [...leaf.content.terminalIds, sessionId],
                activeTerminalId: sessionId,
              },
            };
          }
          if (leaf.content.terminalIds.includes(sessionId)) {
            return { ...leaf, content: { ...leaf.content, terminalIds: leaf.content.terminalIds.filter((id) => id !== sessionId) } };
          }
          return leaf;
        });
        return pruneEmptyLeaves(moved, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
      });
    } else {
      const sourceLeaf = findTerminalLeafBySessionId(terminalTree, sessionId);
      // Edge-drop within the source pane would orphan one half of the split — skip it.
      // (The tab is already in the pane; splitting would create an empty sibling, violating the no-empty-leaf invariant.)
      if (sourceLeaf?.id === leafId && sourceLeaf.content.kind === "terminal" && sourceLeaf.content.terminalIds.length <= 1) {
        setActiveTerminalId(sessionId);
        return;
      }
      const direction: "horizontal" | "vertical" = (edge === "left" || edge === "right") ? "horizontal" : "vertical";
      const position: "before" | "after" = (edge === "left" || edge === "top") ? "before" : "after";
      const newContent: TerminalPaneContent = { kind: "terminal", terminalIds: [sessionId], activeTerminalId: sessionId };

      // Remove from source first, split target, then prune any leaf left empty.
      terminalActions.setTree((prev) =>
        mapLeaves(prev, (leaf) => {
          if (leaf.content.kind !== "terminal" || !leaf.content.terminalIds.includes(sessionId)) return leaf;
          return { ...leaf, content: { ...leaf.content, terminalIds: leaf.content.terminalIds.filter((id) => id !== sessionId) } };
        }),
      );
      terminalActions.splitLeaf(leafId, direction, newContent, position);
      terminalActions.setTree((prev) =>
        pruneEmptyLeaves(prev, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0),
      );
    }
    setActiveTerminalId(sessionId);
  }

  if (!workspaceModel) {
    return <div className="shell shell--loading">Loading Exo…</div>;
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
      statusLine={{
        workspaceLabel: workspaceModel ? pathLabel(workspaceModel.workspaceRoot) : "workspace",
        projectLabel: workspaceModel?.projectRoots[0] ? pathLabel(workspaceModel.projectRoots[0].path) : null,
        gitBranch: workspaceGitStatus?.branch ?? null,
        gitDirty: workspaceGitStatus?.dirty ?? false,
        index: indexStatusLine,
      }}
      shellLayout={shellLayout}
      renderEditorLeaf={(leaf, isFocused) => {
        const pane: EditorPaneState = {
          id: leaf.id,
          openPaths: leaf.content.kind === "editor" ? leaf.content.openPaths : [],
          activePath: leaf.content.kind === "editor" ? leaf.content.activePath : null,
        };
        return (
          <>
            <EditorPane
              key={leaf.id}
              pane={pane}
              documents={openDocuments}
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
            compact={false}
            empty={terminalLeafSessions.length === 0}
            sessions={terminalLeafSessions}
            activeTerminalId={leafActiveTerminalId}
            buffers={terminalBuffers}
            appearance={resolvedAppearance}
            fontSize={terminalFontSize}
            scrollbackLines={terminalScrollbackLines}
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
      onSearchQueryChange={(value) => {
        workspaceSearch.setQuery(value);
        workspaceSearch.setSubmittedQuery(value.trim());
      }}
      onOpenFile={(filePath) => void openFile(filePath)}
      onOpenTag={(tag) => void openTag(tag)}
      onExpandDirectory={(directoryPath, rootKind) => void expandTreeDirectory(directoryPath, rootKind)}
      explorerScale={explorerScale}
      onFocusExplorer={() => setZoomSurface("explorer")}
      dragManager={dragManager}
      onCreateFile={(directoryPath) => createFileInDirectory(directoryPath)}
      onCreateDirectory={(directoryPath) => createDirectoryInDirectory(directoryPath)}
      onCreateTerminalInDirectory={(directoryPath) => void createTerminal("shell", directoryPath)}
      onRenamePath={(targetPath) => renameWorkspacePath(targetPath)}
      onDeletePath={(targetPath) => deleteWorkspacePath(targetPath)}
      onCreateTerminal={(kind) => void createTerminal(kind)}
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
        <div className="dialog-overlay" data-testid="workspace-settings-overlay">
          <div className="dialog-card dialog-card--settings" data-testid="workspace-settings-dialog">
            <div className="dialog-card__header">
              <div className="dialog-card__title">Workspace Settings</div>
              <button
                aria-label="Close workspace settings"
                className="dialog-card__close"
                data-testid="workspace-settings-close"
                onClick={closeWorkspaceSettingsDialog}
                title="Close"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="dialog-card__message">
              Configure Exo from one settings file. Appearance autosaves; workspace paths apply when you press Apply.
            </div>
            <div className="dialog-tabs" role="tablist" aria-label="Workspace settings sections">
              {(["workspace", "index", "appearance", "terminal"] as WorkspaceSettingsSection[]).map((section) => (
                <button
                  className={`dialog-tabs__button ${workspaceSettingsDialog.section === section ? "dialog-tabs__button--active" : ""}`}
                  data-testid={`workspace-settings-tab-${section}`}
                  key={section}
                  onClick={() =>
                    setWorkspaceSettingsDialog((current) =>
                      current
                        ? {
                            ...current,
                            section,
                          }
                        : current,
                    )
                  }
                  role="tab"
                  type="button"
                >
                  {section[0].toUpperCase() + section.slice(1)}
                </button>
              ))}
            </div>
            <div className="dialog-form">
              {workspaceSettingsDialog.section === "workspace" ? (
                <>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Workspace</span>
                    <input
                      className="dialog-card__input"
                      data-testid="workspace-settings-workspace-root"
                      value={workspaceSettingsDialog.workspaceRoot}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                workspaceRoot: event.target.value,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Default terminal</span>
                    <input
                      className="dialog-card__input"
                      data-testid="workspace-settings-terminal-cwd"
                      value={workspaceSettingsDialog.defaultTerminalCwd}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                defaultTerminalCwd: event.target.value,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Notes</span>
                    <textarea
                      className="dialog-card__input dialog-card__input--multiline"
                      data-testid="workspace-settings-note-roots"
                      rows={3}
                      value={workspaceSettingsDialog.noteRoots}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                noteRoots: event.target.value,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Imported projects</span>
                    <textarea
                      className="dialog-card__input dialog-card__input--multiline"
                      data-testid="workspace-settings-project-roots"
                      rows={3}
                      value={workspaceSettingsDialog.projectRoots}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                projectRoots: event.target.value,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                </>
              ) : null}
              {workspaceSettingsDialog.section === "index" ? (
                <>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Knowledge index</span>
                    <select
                      className="dialog-card__input"
                      data-testid="workspace-settings-index-mode"
                      value={workspaceSettingsDialog.indexMode}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                indexMode: event.target.value as WorkspaceSettings["indexing"]["mode"],
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="off">Off</option>
                      <option value="lexical">Lexical</option>
                      <option value="semantic">Semantic</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </label>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Indexed roots</span>
                    <textarea
                      className="dialog-card__input dialog-card__input--multiline"
                      data-testid="workspace-settings-indexed-roots"
                      rows={3}
                      value={workspaceSettingsDialog.indexedRoots}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                indexedRoots: event.target.value,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                  <div className="dialog-card__message">
                    QMD by Tobi Lutke powers the local Exo knowledge index. Index data is stored under .exo/qmd.{" "}
                    {workspaceSettingsDialog.indexStatusSummary}
                  </div>
                  <div className="dialog-card__actions dialog-card__actions--split">
                    <button
                      className="toolbar-button"
                      data-testid="workspace-settings-use-note-roots"
                      onClick={() =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                indexedRoots: current.noteRoots,
                                indexMode: current.indexMode === "off" ? "lexical" : current.indexMode,
                                applyStatus: "idle",
                                applyErrorMessage: null,
                              }
                            : current,
                        )
                      }
                      type="button"
                    >
                      Use note roots
                    </button>
                    <button
                      className="toolbar-button"
                      data-testid="workspace-settings-update-index"
                      disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.indexedRoots.length === 0}
                      onClick={() => void runIndexUpdate("updating")}
                      type="button"
                    >
                      {indexBusy === "updating" ? "Updating…" : "Update index"}
                    </button>
                    <button
                      className="toolbar-button"
                      data-testid="workspace-settings-embed-index"
                      disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.mode === "lexical" || indexStatus.indexedRoots.length === 0}
                      onClick={() => void runIndexUpdate("embedding")}
                      type="button"
                    >
                      {indexBusy === "embedding" ? "Embedding…" : "Build embeddings"}
                    </button>
                  </div>
                </>
              ) : null}
              {workspaceSettingsDialog.section === "appearance" ? (
                <>
                  <label className="dialog-field">
                    <span className="dialog-field__label">Appearance</span>
                    <select
                      className="dialog-card__input"
                      data-testid="workspace-settings-appearance"
                      value={workspaceSettingsDialog.appearanceMode}
                      onChange={(event) =>
                        setWorkspaceSettingsDialog((current) =>
                          current
                            ? {
                                ...current,
                                appearanceMode: event.target.value as AppearanceMode,
                                saveStatus: "idle",
                                errorMessage: null,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                </>
              ) : null}
              {workspaceSettingsDialog.section === "appearance" || workspaceSettingsDialog.section === "terminal" ? (
                <div className="dialog-form__grid">
                  {workspaceSettingsDialog.section === "appearance" ? (
                    <label className="dialog-field">
                      <span className="dialog-field__label">Editor font</span>
                      <input
                        className="dialog-card__input"
                        data-testid="workspace-settings-editor-font-size"
                        type="number"
                        min={11}
                        max={24}
                        value={workspaceSettingsDialog.editorFontSize}
                        onChange={(event) =>
                          setWorkspaceSettingsDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  editorFontSize: event.target.value,
                                  saveStatus: "idle",
                                  errorMessage: null,
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  ) : null}
                  {workspaceSettingsDialog.section === "terminal" ? (
                    <>
                      <label className="dialog-field">
                        <span className="dialog-field__label">Terminal font</span>
                        <input
                          className="dialog-card__input"
                          data-testid="workspace-settings-terminal-font-size"
                          type="number"
                          min={10}
                          max={22}
                          value={workspaceSettingsDialog.terminalFontSize}
                          onChange={(event) =>
                            setWorkspaceSettingsDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    terminalFontSize: event.target.value,
                                    saveStatus: "idle",
                                    errorMessage: null,
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="dialog-field">
                        <span className="dialog-field__label">Terminal lines</span>
                        <input
                          className="dialog-card__input"
                          data-testid="workspace-settings-terminal-scrollback-lines"
                          type="number"
                          min={500}
                          max={100000}
                          step={500}
                          value={workspaceSettingsDialog.terminalScrollbackLines}
                          onChange={(event) =>
                            setWorkspaceSettingsDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    terminalScrollbackLines: event.target.value,
                                    saveStatus: "idle",
                                    errorMessage: null,
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="dialog-field">
                        <span className="dialog-field__label">Terminal buffer</span>
                        <input
                          className="dialog-card__input"
                          data-testid="workspace-settings-terminal-buffer-chars"
                          type="number"
                          min={12000}
                          max={2000000}
                          step={12000}
                          value={workspaceSettingsDialog.terminalBufferChars}
                          onChange={(event) =>
                            setWorkspaceSettingsDialog((current) =>
                              current
                                ? {
                                    ...current,
                                    terminalBufferChars: event.target.value,
                                    saveStatus: "idle",
                                    errorMessage: null,
                                  }
                                : current,
                            )
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  {workspaceSettingsDialog.section === "appearance" ? (
                    <label className="dialog-field">
                      <span className="dialog-field__label">Explorer scale</span>
                      <input
                        className="dialog-card__input"
                        data-testid="workspace-settings-explorer-scale"
                        type="number"
                        min={0.82}
                        max={1.35}
                        step={0.01}
                        value={workspaceSettingsDialog.explorerScale}
                        onChange={(event) =>
                          setWorkspaceSettingsDialog((current) =>
                            current
                              ? {
                                  ...current,
                                  explorerScale: event.target.value,
                                  saveStatus: "idle",
                                  errorMessage: null,
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
            {workspaceSettingsStructuralDraftKey(workspaceSettingsDialog) !== workspaceSettingsDialog.appliedWorkspaceKey ? (
              <div className="dialog-card__apply-row">
                <div className="dialog-card__status">
                  Workspace paths and index settings apply immediately.
                </div>
                <button
                  className="toolbar-button"
                  data-testid="workspace-settings-apply"
                  disabled={workspaceSettingsDialog.applyStatus === "applying"}
                  onClick={() => void saveWorkspaceSettingsDialog(workspaceSettingsDialog, { includeStructural: true })}
                  type="button"
                >
                  {workspaceSettingsDialog.applyStatus === "applying" ? "Applying…" : "Apply"}
                </button>
              </div>
            ) : null}
            {workspaceSettingsDialog.applyStatus === "applied" ? (
              <div className="dialog-card__status" data-testid="workspace-settings-apply-status">
                Applied. Workspace paths are active.
              </div>
            ) : null}
            {workspaceSettingsDialog.applyStatus === "error" && workspaceSettingsDialog.applyErrorMessage ? (
              <div className="dialog-card__status dialog-card__status--error">{workspaceSettingsDialog.applyErrorMessage}</div>
            ) : null}
            {workspaceSettingsDialog.saveStatus === "saving" ? (
              <div className="dialog-card__status" data-testid="workspace-settings-status">
                Saving…
              </div>
            ) : null}
            {workspaceSettingsDialog.saveStatus === "saved" ? (
              <div className="dialog-card__status" data-testid="workspace-settings-status">
                Saved automatically.
              </div>
            ) : null}
            {workspaceSettingsDialog.saveStatus === "error" && workspaceSettingsDialog.errorMessage ? (
              <div className="dialog-card__status dialog-card__status--error">{workspaceSettingsDialog.errorMessage}</div>
            ) : null}
          </div>
        </div>
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

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [node];
    }

    return node.children ? flattenFiles(node.children) : [];
  });
}

function collectOpenEditorPaths(tree: PaneNode): Set<string> {
  const paths = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind !== "editor") {
      continue;
    }
    for (const filePath of leaf.content.openPaths) {
      paths.add(filePath);
    }
  }
  return paths;
}

function collectActiveTerminalIds(tree: PaneNode): Set<string> {
  const ids = new Set<string>();
  for (const leaf of collectLeaves(tree)) {
    if (leaf.content.kind === "terminal" && leaf.content.activeTerminalId) {
      ids.add(leaf.content.activeTerminalId);
    }
  }
  return ids;
}

function addTerminalSessionToFirstLeaf(tree: PaneNode, sessionId: string): PaneNode {
  const termLeaf = findTerminalLeaf(tree);
  if (!termLeaf) {
    return tree;
  }

  return updateNode(tree, termLeaf.id, (node) => {
    if (node.kind !== "leaf" || node.content.kind !== "terminal") {
      return node;
    }
    if (node.content.terminalIds.includes(sessionId)) {
      return {
        ...node,
        content: {
          ...node.content,
          activeTerminalId: sessionId,
        },
      };
    }
    return {
      ...node,
      content: {
        ...node.content,
        terminalIds: [...node.content.terminalIds, sessionId],
        activeTerminalId: sessionId,
      },
    };
  });
}

function pruneRecordToKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const entries = Object.entries(record).filter(([key]) => keys.has(key));
  return entries.length === Object.keys(record).length ? record : Object.fromEntries(entries);
}

function treeLoadKey(rootKind: "notes" | "projects", directoryPath: string): string {
  return `${rootKind}:${directoryPath}`;
}

function replaceTreeChildrenInRoots(
  roots: Record<string, TreeNode[]>,
  directoryPath: string,
  children: TreeNode[],
): Record<string, TreeNode[]> {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(roots).map(([rootPath, nodes]) => {
      const nextNodes = replaceTreeChildren(nodes, directoryPath, children);
      if (nextNodes !== nodes) {
        changed = true;
      }
      return [rootPath, nextNodes];
    }),
  );
  return changed ? next : roots;
}

function replaceTreeChildren(nodes: TreeNode[], directoryPath: string, children: TreeNode[]): TreeNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.kind !== "directory") {
      return node;
    }
    if (node.path === directoryPath) {
      changed = true;
      return { ...node, children: mergeTreeChildren(node.children ?? [], children) };
    }
    const nextChildren = node.children ? replaceTreeChildren(node.children, directoryPath, children) : node.children;
    if (nextChildren !== node.children) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });
  return changed ? nextNodes : nodes;
}

function mergeTreeChildren(existing: TreeNode[], incoming: TreeNode[]): TreeNode[] {
  if (existing.length === 0) {
    return incoming;
  }
  const existingByPath = new Map(existing.map((node) => [node.path, node]));
  return incoming.map((node) => {
    const previous = existingByPath.get(node.path);
    if (!previous || previous.kind !== "directory" || node.kind !== "directory") {
      return node;
    }
    if ((previous.children?.length ?? 0) > 0 && (node.children?.length ?? 0) === 0) {
      return previous;
    }
    return {
      ...node,
      children: mergeTreeChildren(previous.children ?? [], node.children ?? []),
    };
  });
}

function treeDirectoryHasChildrenInRoots(roots: Record<string, TreeNode[]>, directoryPath: string): boolean {
  return Object.values(roots).some((nodes) => treeDirectoryHasChildren(nodes, directoryPath));
}

function treeDirectoryHasChildren(nodes: TreeNode[], directoryPath: string): boolean {
  for (const node of nodes) {
    if (node.kind !== "directory") {
      continue;
    }
    if (node.path === directoryPath) {
      return (node.children?.length ?? 0) > 0;
    }
    if (node.children && treeDirectoryHasChildren(node.children, directoryPath)) {
      return true;
    }
  }
  return false;
}

function pickInitialNote(entries: Array<readonly [string, TreeNode[]]>): TreeNode | undefined {
  const files = entries.flatMap((entry) => flattenFiles(entry[1]));
  for (const [rootPath] of entries) {
    const rootTasks = files.find((file) => file.path === joinPath(rootPath, "tasks.md"));
    if (rootTasks) {
      return rootTasks;
    }
  }

  const exoTasks = files.find((file) => file.path.endsWith("/projects/exo/tasks.md"));
  if (exoTasks) {
    return exoTasks;
  }

  const preferred = ["tasks.md", "schedule.md", "goals.md", "CLAUDE.md"];
  for (const name of preferred) {
    const match = files.find((file) => file.path.endsWith(`/${name}`));
    if (match) {
      return match;
    }
  }

  return files.find((file) => !file.path.includes("-looms/")) ?? files[0];
}

function directoryOf(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(0, -1).join("/") || "/";
}

function pathLabel(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
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

function getActiveEditorScrollTop(): number | null {
  const scroller = document.querySelector<HTMLElement>(".editor-surface .cm-scroller");
  return scroller ? scroller.scrollTop : null;
}

function restoreActiveEditorScrollTop(scrollTop: number) {
  const restore = () => {
    const scroller = document.querySelector<HTMLElement>(".editor-surface .cm-scroller");
    if (scroller) {
      scroller.scrollTop = scrollTop;
    }
  };

  window.requestAnimationFrame(restore);
  const interval = window.setInterval(restore, 50);
  window.setTimeout(() => {
    restore();
    window.clearInterval(interval);
  }, 650);
}

function trimTerminalBuffer(buffer: string, maxChars: number): string {
  return buffer.length > maxChars ? buffer.slice(-maxChars) : buffer;
}

function mapRecordValues<T>(record: Record<string, T>, mapValue: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapValue(value)]));
}

function workspaceSettingsImmediateDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    appearanceMode: settings.appearanceMode,
    editorFontSize: settings.editorFontSize,
    terminalFontSize: settings.terminalFontSize,
    terminalScrollbackLines: settings.terminalScrollbackLines,
    terminalBufferChars: settings.terminalBufferChars,
    explorerScale: settings.explorerScale,
  });
}

function workspaceSettingsStructuralDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots,
    projectRoots: settings.projectRoots,
    indexedRoots: settings.indexedRoots,
    indexMode: settings.indexMode,
  });
}

function workspaceSettingsStructuralKeyFromSettings(settings: WorkspaceSettings): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots.join("\n"),
    projectRoots: settings.projectRoots.join("\n"),
    indexedRoots: settings.indexedRoots.map((root) => root.path).join("\n"),
    indexMode: settings.indexing.mode,
  });
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
