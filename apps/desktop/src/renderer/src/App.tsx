import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchFamily,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  SemanticSearchResult,
  TreeNode,
  WorkspaceModel,
  WorkspaceSearchResults,
  WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo } from "../../shared/api";

import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { InspectorDock } from "./components/InspectorDock";
import { ShellLayout } from "./components/ShellLayout";
import { TerminalDock } from "./components/TerminalDock";
import { useShellLayout } from "./hooks/useShellLayout";
import { collectLeaves, findEditorLeaf, findEditorLeafByPath, findNode, findTerminalLeaf, findTerminalLeafBySessionId, countLeaves, mapLeaves, pruneEmptyLeaves, updateNode, removeNode, type PaneLeaf, type PaneNode, type PaneSplit, type PaneNodeId, type EditorPaneContent, type TerminalPaneContent } from "./hooks/usePaneTree";
import { useDragManager, type DragPayload, type DropEdge } from "./hooks/useDragManager";

interface OpenEditorDocument extends NoteDocument {
  dirty: boolean;
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
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string;
  projectRoots: string;
  saveStatus: "idle" | "saved" | "error";
  errorMessage: string | null;
}

// DragState replaced by useDragManager — see DragPayload in hooks/useDragManager.ts

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

const APPEARANCE_STORAGE_KEY = "exo-appearance-mode";

export function App() {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [noteTrees, setNoteTrees] = useState<Record<string, TreeNode[]>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, TreeNode[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmittedQuery, setSearchSubmittedQuery] = useState("");
  const [workspaceSearchResults, setWorkspaceSearchResults] = useState<WorkspaceSearchResults>({
    notes: [],
    projectFiles: [],
    tags: [],
  });
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [openDocuments, setOpenDocuments] = useState<Record<string, OpenEditorDocument>>({});
  const [knowledgeByPath, setKnowledgeByPath] = useState<Record<string, NoteKnowledge>>({});
  const [branchFamiliesByPath, setBranchFamiliesByPath] = useState<Record<string, BranchFamily>>({});
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const handleDropRef = useRef<(leafId: string, edge: DropEdge, payload: DragPayload) => void>(() => {});
  const dragManager = useDragManager((leafId, edge, payload) => handleDropRef.current(leafId, edge, payload));
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const [agentAnnotations, setAgentAnnotations] = useState<Record<string, { runLabel: string; parentId: string | null }>>({});
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState | null>(null);
  const [workspaceSettingsDialog, setWorkspaceSettingsDialog] = useState<WorkspaceSettingsDialogState | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => readStoredAppearanceMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const pendingTerminalChunksRef = useRef<Record<string, string>>({});
  const terminalFlushFrameRef = useRef<number | null>(null);
  const bootstrapRunRef = useRef(0);
  const shellLayout = useShellLayout();
  const deferredSearchQuery = useDeferredValue(searchSubmittedQuery);

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;
  const activeKnowledge = activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null;
  const { tree: editorTree, focusedLeafId: editorFocusedLeafId, actions: editorActions } = shellLayout.editorPaneTree;
  const { tree: terminalTree, focusedLeafId: terminalFocusedLeafId, actions: terminalActions } = shellLayout.terminalPaneTree;
  const compactEditorChrome = collectLeaves(editorTree).length > 1;
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;
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
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearanceMode);
  }, [appearanceMode, resolvedAppearance]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const bootstrapRun = ++bootstrapRunRef.current;
      const model = await window.exo.workspace.getModel();
      const [nextNoteTrees, nextProjectTrees] = await Promise.all([
        Promise.all(
          model.noteRoots.map(
            async (root) => [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: 3 })] as const,
          ),
        ),
        Promise.all(
          model.projectRoots.map(
            async (root) => [root.path, await window.exo.workspace.listTree(root.path, { maxDepth: 2 })] as const,
          ),
        ),
      ]);

      if (cancelled) {
        return;
      }

      const firstNote = pickInitialNote(nextNoteTrees);
      const defaultTerminal = await window.exo.terminals.ensureDefault();
      const sessions = await window.exo.terminals.list();

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
      setTerminalSessions(sessions);
      setActiveTerminalId(defaultTerminal.id);

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
          next[id] = `${next[id] ?? ""}${chunk}`;
        }
        return next;
      });
    }

    const removeDataListener = window.exo.terminals.onData(({ id, data }) => {
      pendingTerminalChunksRef.current[id] = `${pendingTerminalChunksRef.current[id] ?? ""}${data}`;
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

    return () => {
      cancelled = true;
      if (terminalFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalFlushFrameRef.current);
      }
      removeDataListener();
      removeExitListener();
    };
  }, []);

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

  useEffect(() => {
    if (!deferredSearchQuery.trim()) {
      setWorkspaceSearchResults({
        notes: [],
        projectFiles: [],
        tags: [],
      });
      return;
    }

    const timeout = window.setTimeout(async () => {
      const results = await window.exo.workspace.searchWorkspace(deferredSearchQuery);
      startTransition(() => {
        setWorkspaceSearchResults(results);
      });
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [deferredSearchQuery]);

  // Semantic search — longer debounce, runs QMD BM25
  useEffect(() => {
    if (!deferredSearchQuery.trim()) {
      setSemanticResults([]);
      return;
    }

    const timeout = window.setTimeout(async () => {
      const results = await window.exo.workspace.searchSemantic(deferredSearchQuery);
      startTransition(() => {
        setSemanticResults(results);
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [deferredSearchQuery]);

  // Command listener — agents can tell the app to open files via the command server
  useEffect(() => {
    return window.exo.workspace.onCommandOpenFile((filePath: string) => {
      void openFile(filePath);
    });
  }, []);

  useEffect(() => {
    const removeWorkspaceChangeListener = window.exo.workspace.onDidChange(() => {
      void reloadTrees();
    });

    return () => {
      removeWorkspaceChangeListener();
    };
  }, [workspaceModel]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeDocument) {
        event.preventDefault();
        void saveDocument(activeDocument.filePath);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDocument]);

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

    const [nextNoteTrees, nextProjectTrees] = await Promise.all([
      Promise.all(
        workspaceModel.noteRoots.map(
          async (root) => [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: 5 })] as const,
        ),
      ),
      Promise.all(
        workspaceModel.projectRoots.map(
          async (root) => [root.path, await window.exo.workspace.listTree(root.path, { maxDepth: 4 })] as const,
        ),
      ),
    ]);

    setNoteTrees(Object.fromEntries(nextNoteTrees));
    setProjectTrees(Object.fromEntries(nextProjectTrees));
  }

  async function openWorkspaceSettingsDialog() {
    const settings = await window.exo.workspace.getSettings();
    setWorkspaceSettingsDialog({
      workspaceRoot: settings.workspaceRoot,
      defaultTerminalCwd: settings.defaultTerminalCwd,
      noteRoots: settings.noteRoots.join("\n"),
      projectRoots: settings.projectRoots.join("\n"),
      saveStatus: "idle",
      errorMessage: null,
    });
  }

  async function saveWorkspaceSettingsDialog() {
    if (!workspaceSettingsDialog) {
      return;
    }

    const nextSettings: WorkspaceSettings = {
      workspaceRoot: workspaceSettingsDialog.workspaceRoot.trim(),
      defaultTerminalCwd: workspaceSettingsDialog.defaultTerminalCwd.trim(),
      noteRoots: workspaceSettingsDialog.noteRoots
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
      projectRoots: workspaceSettingsDialog.projectRoots
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
    };

    try {
      await window.exo.workspace.saveSettings(nextSettings);
      setWorkspaceSettingsDialog((current) =>
        current
          ? {
              ...current,
              saveStatus: "saved",
              errorMessage: null,
            }
          : current,
      );
    } catch (error) {
      setWorkspaceSettingsDialog((current) =>
        current
          ? {
              ...current,
              saveStatus: "error",
              errorMessage: error instanceof Error ? error.message : "Unable to save workspace settings.",
            }
          : current,
      );
    }
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
      }
    }, 0);
  }

  /** Load a document's content into state without touching the pane tree. */
  async function ensureDocumentLoaded(filePath: string) {
    const document = await window.exo.notes.read(filePath);
    const [knowledge, branchFamily] =
      document.kind === "markdown"
        ? await Promise.all([window.exo.notes.getKnowledge(filePath), window.exo.notes.getBranchFamily(filePath)])
        : [null, null];

    setOpenDocuments((current) => ({
      ...current,
      [filePath]: {
        ...document,
        dirty: current[filePath]?.dirty ?? false,
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
    if (document.kind === "markdown") {
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
    setOpenDocuments((current) => ({
      ...current,
      [filePath]: {
        ...current[filePath],
        dirty: false,
      },
    }));
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
    setTerminalSessions((current) => [...current, session]);

    // Add to the focused terminal leaf, or find any terminal leaf
    const focusedLeaf = findNode(terminalTree, (n) => n.id === terminalFocusedLeafId) as PaneLeaf | undefined;
    const termLeaf = (focusedLeaf?.content.kind === "terminal" ? focusedLeaf : null) ?? findTerminalLeaf(terminalTree);
    if (termLeaf) {
      terminalActions.updateLeafContent(termLeaf.id, (content) => {
        if (content.kind !== "terminal") return content;
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

  return (
    <>
      <ShellLayout
      noteSections={noteSections}
      projectSections={projectSections}
      appearanceMode={appearanceMode}
      resolvedAppearance={resolvedAppearance}
      searchQuery={searchQuery}
      searchSubmittedQuery={searchSubmittedQuery}
      searchResults={workspaceSearchResults}
      semanticResults={semanticResults}
      onSearchSubmit={() => setSearchSubmittedQuery(searchQuery.trim())}
      onSearchClear={() => {
        setSearchQuery("");
        setSearchSubmittedQuery("");
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
              onFocusPane={() => focusEditorPane(leaf.id)}
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
      renderTerminalLeaf={(leaf, isFocused) => {
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
            onSetActiveTerminal={(id) => {
              terminalActions.updateLeafContent(leaf.id, (content) => {
                if (content.kind !== "terminal") return content;
                return { ...content, activeTerminalId: id };
              });
              setActiveTerminalId(id);
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
      onAppearanceModeChange={setAppearanceMode}
      onOpenWorkspaceSettings={() => void openWorkspaceSettingsDialog()}
      onSearchQueryChange={setSearchQuery}
      onOpenFile={(filePath) => void openFile(filePath)}
      onOpenTag={(tag) => void openTag(tag)}
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
            <div className="dialog-card__title">Workspace Settings</div>
            <div className="dialog-card__message">
              Configure the workspace and attached roots. Changes are saved for the next Exo launch.
            </div>
            <div className="dialog-form">
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
                            saveStatus: "idle",
                            errorMessage: null,
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
                            saveStatus: "idle",
                            errorMessage: null,
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
                            saveStatus: "idle",
                            errorMessage: null,
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label className="dialog-field">
                <span className="dialog-field__label">Projects</span>
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
                            saveStatus: "idle",
                            errorMessage: null,
                          }
                        : current,
                    )
                  }
                />
              </label>
            </div>
            {workspaceSettingsDialog.saveStatus === "saved" ? (
              <div className="dialog-card__status" data-testid="workspace-settings-status">
                Saved. Restart Exo to apply the new paths.
              </div>
            ) : null}
            {workspaceSettingsDialog.saveStatus === "error" && workspaceSettingsDialog.errorMessage ? (
              <div className="dialog-card__status dialog-card__status--error">{workspaceSettingsDialog.errorMessage}</div>
            ) : null}
            <div className="dialog-card__actions">
              <button className="toolbar-button" onClick={() => setWorkspaceSettingsDialog(null)} type="button">
                Close
              </button>
              <button
                className="toolbar-button"
                data-testid="workspace-settings-save"
                onClick={() => void saveWorkspaceSettingsDialog()}
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function readStoredAppearanceMode(): AppearanceMode {
  const value = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [node];
    }

    return node.children ? flattenFiles(node.children) : [];
  });
}

function pickInitialNote(entries: Array<readonly [string, TreeNode[]]>): TreeNode | undefined {
  const files = entries.flatMap((entry) => flattenFiles(entry[1]));
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

function joinPath(parentPath: string, name: string): string {
  return `${parentPath.replace(/\/$/, "")}/${name.replace(/^\//, "")}`;
}

function closeDocumentInPaneState(pane: EditorPaneState, filePath: string): EditorPaneState {
  const nextOpenPaths = pane.openPaths.filter((openPath) => openPath !== filePath);
  if (pane.activePath !== filePath) {
    return {
      ...pane,
      openPaths: nextOpenPaths,
    };
  }

  const closedIndex = pane.openPaths.indexOf(filePath);
  const nextActivePath = nextOpenPaths[Math.max(0, closedIndex - 1)] ?? nextOpenPaths[0] ?? null;
  return {
    ...pane,
    openPaths: nextOpenPaths,
    activePath: nextActivePath,
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

