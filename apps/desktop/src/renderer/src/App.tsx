import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchFamily,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  TreeNode,
  WorkspaceModel,
  WorkspaceSearchResults,
  WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo } from "../../shared/api";

import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { ShellLayout } from "./components/ShellLayout";
import { type AgentAnnotation } from "./components/SubagentDock";
import { getRenderedTerminalContent } from "./components/TerminalView";
import { useShellLayout } from "./hooks/useShellLayout";

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

type DragState =
  | { kind: "terminal" }
  | { kind: "document"; filePath: string; sourcePaneId?: string };

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

const PRIMARY_EDITOR_PANE_ID = "editor-pane-1";
const SECONDARY_EDITOR_PANE_ID = "editor-pane-2";
const APPEARANCE_STORAGE_KEY = "exo-appearance-mode";

export function App() {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [noteTrees, setNoteTrees] = useState<Record<string, TreeNode[]>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, TreeNode[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceSearchResults, setWorkspaceSearchResults] = useState<WorkspaceSearchResults>({
    notes: [],
    projectFiles: [],
    tags: [],
  });
  const [openDocuments, setOpenDocuments] = useState<Record<string, OpenEditorDocument>>({});
  const [knowledgeByPath, setKnowledgeByPath] = useState<Record<string, NoteKnowledge>>({});
  const [branchFamiliesByPath, setBranchFamiliesByPath] = useState<Record<string, BranchFamily>>({});
  const [editorPanes, setEditorPanes] = useState<EditorPaneState[]>([
    {
      id: PRIMARY_EDITOR_PANE_ID,
      openPaths: [],
      activePath: null,
    },
  ]);
  const [focusedEditorPaneId, setFocusedEditorPaneId] = useState(PRIMARY_EDITOR_PANE_ID);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const [agentAnnotations, setAgentAnnotations] = useState<Record<string, AgentAnnotation>>({});
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
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;
  const activeKnowledge = activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null;
  const compactEditorChrome = editorPanes.length > 1;
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;
  const terminalOutputPreviewById = useMemo(
    () =>
      Object.fromEntries(
        terminalSessions.map((session) => [session.id, summarizeTerminalBuffer(terminalBuffers[session.id] ?? "")] as const),
      ),
    [terminalBuffers, terminalSessions],
  );

  // Poll rendered terminal content for agent detection (xterm renders the raw PTY stream)
  const [observedAgents, setObservedAgents] = useState<ObservedAgent[]>([]);
  useEffect(() => {
    if (!activeTerminalId) {
      setObservedAgents([]);
      return;
    }
    function poll() {
      const content = getRenderedTerminalContent(activeTerminalId!);
      if (content) {
        setObservedAgents(extractObservedAgents(content));
      }
    }
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [activeTerminalId, terminalBuffers]);

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
        await openFile(firstNote.path, PRIMARY_EDITOR_PANE_ID);
      }

      if (cancelled || bootstrapRun !== bootstrapRunRef.current) {
        return;
      }

      setWorkspaceModel(model);
      setNoteTrees(Object.fromEntries(nextNoteTrees));
      setProjectTrees(Object.fromEntries(nextProjectTrees));
      setTerminalSessions(sessions);
      setActiveTerminalId(defaultTerminal.id);
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

  function focusEditorPane(paneId: string) {
    setFocusedEditorPaneId(paneId);
    const nextActivePath = editorPanes.find((pane) => pane.id === paneId)?.activePath ?? null;
    setActiveDocumentPath(nextActivePath);
    setActiveTag(null);
    if (!nextActivePath) {
      setTagResults([]);
    }
  }

  function setPaneActivePath(paneId: string, filePath: string) {
    setEditorPanes((current) =>
      current.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              activePath: filePath,
              openPaths: pane.openPaths.includes(filePath) ? pane.openPaths : [...pane.openPaths, filePath],
            }
          : pane,
      ),
    );
    setFocusedEditorPaneId(paneId);
    setActiveDocumentPath(filePath);
    setActiveTag(null);
    setTagResults([]);
  }

  function closeDocumentInPane(paneId: string, filePath: string) {
    let nextPanes = sortEditorPanes(
      editorPanes.map((pane) => (pane.id === paneId ? closeDocumentInPaneState(pane, filePath) : pane)),
    );

    // If a secondary pane is now empty, remove it and clear the split
    const emptySecondary = nextPanes.find(
      (pane) => pane.id !== PRIMARY_EDITOR_PANE_ID && pane.openPaths.length === 0,
    );
    if (emptySecondary) {
      nextPanes = nextPanes.filter((pane) => pane.id === PRIMARY_EDITOR_PANE_ID);
      shellLayout.setEditorSplitOrientation(null);
    }

    const nextFocusedPaneId = paneId === focusedEditorPaneId ? paneId : focusedEditorPaneId;
    const nextFocusedPane = nextPanes.find((pane) => pane.id === nextFocusedPaneId) ?? nextPanes[0] ?? null;
    const nextActivePath = nextFocusedPane?.activePath ?? nextPanes.find((pane) => pane.activePath)?.activePath ?? null;

    setEditorPanes(nextPanes);
    setFocusedEditorPaneId(nextFocusedPane?.id ?? PRIMARY_EDITOR_PANE_ID);
    setActiveDocumentPath(nextActivePath);
    if (!nextActivePath) {
      setActiveTag(null);
      setTagResults([]);
    }
  }

  async function openFile(filePath: string, paneId = focusedEditorPaneId) {
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
    setEditorPanes((current) => {
      const next = ensureEditorPane(current, paneId);
      return next.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              activePath: filePath,
              openPaths: pane.openPaths.includes(filePath) ? pane.openPaths : [...pane.openPaths, filePath],
            }
          : pane,
      );
    });
    setFocusedEditorPaneId(paneId);
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
    await openFile(ensured, focusedEditorPaneId);
  }

  async function openTag(tag: string) {
    if (activeDocumentPath) {
      const resolved = await window.exo.notes.resolveTarget(activeDocumentPath, tag);
      if (resolved) {
        await openFile(resolved, focusedEditorPaneId);
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
    shellLayout.terminalDock.setCollapsed(false);
    setTerminalSessions((current) => [...current, session]);
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
    await openFile(result.branchFilePath, focusedEditorPaneId);
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
    await openFile(nextPath, focusedEditorPaneId);
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
      await openFile(nextPath, focusedEditorPaneId);
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
    setEditorPanes((current) =>
      current.map((pane) => {
        const nextOpenPaths = pane.openPaths.filter((filePath) => !isPathWithin(targetPath, filePath));
        return {
          ...pane,
          openPaths: nextOpenPaths,
          activePath: pane.activePath && !isPathWithin(targetPath, pane.activePath)
            ? pane.activePath
            : nextOpenPaths.at(-1) ?? null,
        };
      }),
    );
    if (activeDocumentPath && isPathWithin(targetPath, activeDocumentPath)) {
      const nextActivePath = editorPanes.find((pane) => pane.id === focusedEditorPaneId)?.openPaths.at(-1) ?? null;
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
    setEditorPanes((current) =>
      current.map((pane) => ({
        ...pane,
        openPaths: pane.openPaths.map((filePath) =>
          isPathWithin(sourcePath, filePath) ? filePath.replace(sourcePath, nextPath) : filePath,
        ),
        activePath:
          pane.activePath && isPathWithin(sourcePath, pane.activePath)
            ? pane.activePath.replace(sourcePath, nextPath)
            : pane.activePath,
      })),
    );
    if (activeDocumentPath && isPathWithin(sourcePath, activeDocumentPath)) {
      setActiveDocumentPath(activeDocumentPath.replace(sourcePath, nextPath));
    }
  }

  function startDocumentDrag(filePath: string, sourcePaneId?: string) {
    setDragState({ kind: "document", filePath, sourcePaneId });
  }

  function moveDocumentToSplit(orientation: "right" | "bottom") {
    if (!dragState || dragState.kind !== "document") {
      return;
    }

    const targetPaneId =
      dragState.sourcePaneId === SECONDARY_EDITOR_PANE_ID ? PRIMARY_EDITOR_PANE_ID : SECONDARY_EDITOR_PANE_ID;

    shellLayout.setEditorSplitOrientation(orientation);
    if (!openDocuments[dragState.filePath]) {
      void openFile(dragState.filePath, targetPaneId);
      setDragState(null);
      return;
    }

    setEditorPanes((current) => {
      const next = ensureEditorPane(current, targetPaneId).map((pane) => ({
        ...pane,
        openPaths: [...pane.openPaths],
      }));

      if (dragState.sourcePaneId) {
        const sourcePane = next.find((pane) => pane.id === dragState.sourcePaneId);
        if (sourcePane && sourcePane.id !== targetPaneId) {
          sourcePane.openPaths = sourcePane.openPaths.filter((filePath) => filePath !== dragState.filePath);
          if (sourcePane.activePath === dragState.filePath) {
            sourcePane.activePath = sourcePane.openPaths.at(-1) ?? null;
          }
        }
      }

      const targetPane = next.find((pane) => pane.id === targetPaneId)!;
      if (!targetPane.openPaths.includes(dragState.filePath)) {
        targetPane.openPaths.push(dragState.filePath);
      }
      targetPane.activePath = dragState.filePath;

      return sortEditorPanes(next);
    });

    setFocusedEditorPaneId(targetPaneId);
    setActiveDocumentPath(dragState.filePath);
    setDragState(null);
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
      searchResults={workspaceSearchResults}
      shellLayout={shellLayout}
      noteContent={sortEditorPanes(editorPanes).map((pane) => (
        <EditorPane
          key={pane.id}
          pane={pane}
          documents={openDocuments}
          branchFamiliesByPath={branchFamiliesByPath}
          propertiesCollapsed={propertiesCollapsed}
          isFocused={pane.id === focusedEditorPaneId}
          onFocusPane={() => focusEditorPane(pane.id)}
          onActivateTab={(filePath) => setPaneActivePath(pane.id, filePath)}
          onCloseTab={(filePath) => closeDocumentInPane(pane.id, filePath)}
          onStartDocumentDrag={(filePath, paneId) => startDocumentDrag(filePath, paneId)}
          onEndDocumentDrag={() => setDragState(null)}
          onToggleProperties={() => setPropertiesCollapsed((current) => !current)}
          onUpdateFrontmatter={updateFrontmatter}
          onBodyChange={updateBody}
          onSave={() => void (pane.activePath ? saveDocument(pane.activePath) : Promise.resolve())}
          onOpenTag={(tag) => void openTag(tag)}
          onOpenTarget={(target) => void openKnowledgeTarget(target)}
          onOpenBranch={(filePath) => void openFile(filePath, pane.id)}
          onSuggestTargets={(query) => suggestNoteTargets(query)}
          onCreateBranch={() => void createBranchFromActiveDocument()}
          appearance={resolvedAppearance}
          compact={compactEditorChrome}
        />
      ))}
      activeDocument={activeDocument}
      activeKnowledge={activeKnowledge}
      activeTag={activeTag}
      tagResults={tagResults}
      terminalSessions={terminalSessions}
      activeTerminalId={activeTerminalId}
      terminalBuffers={terminalBuffers}
      terminalOutputPreviewById={terminalOutputPreviewById}
      agentAnnotations={agentAnnotations}
      observedAgents={observedAgents}
      compactEditorChrome={compactEditorChrome}
      onAppearanceModeChange={setAppearanceMode}
      onOpenWorkspaceSettings={() => void openWorkspaceSettingsDialog()}
      onSearchQueryChange={setSearchQuery}
      onOpenFile={(filePath) => void openFile(filePath, focusedEditorPaneId)}
      onOpenTag={(tag) => void openTag(tag)}
      onStartDocumentDrag={(filePath) => startDocumentDrag(filePath)}
      onEndDocumentDrag={() => setDragState(null)}
      onCreateFile={(directoryPath) => createFileInDirectory(directoryPath)}
      onCreateDirectory={(directoryPath) => createDirectoryInDirectory(directoryPath)}
      onCreateTerminalInDirectory={(directoryPath) => void createTerminal("shell", directoryPath)}
      onRenamePath={(targetPath) => renameWorkspacePath(targetPath)}
      onDeletePath={(targetPath) => deleteWorkspacePath(targetPath)}
      onWriteTerminal={(id, data) => void window.exo.terminals.write(id, data)}
      onResizeTerminal={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
      onKillTerminal={(id) => void closeTerminal(id)}
      onCreateTerminal={(kind) => void createTerminal(kind)}
      onSetActiveTerminal={setActiveTerminalId}
      onOpenTarget={(target) => void openKnowledgeTarget(target)}
      onOpenExternal={(target) => void window.exo.shell.openExternal(target)}
      onFocusAgent={setActiveTerminalId}
      onMoveDocumentToSplit={moveDocumentToSplit}
      terminalDragActive={dragState?.kind === "terminal"}
      documentDragActive={dragState?.kind === "document"}
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

function summarizeTerminalBuffer(buffer: string): string {
  const lines = buffer
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1)?.slice(0, 160) ?? "No activity yet";
}

export interface ObservedAgent {
  name: string;
  description: string;
  status: "running" | "done";
}

const ANSI_STRIP = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

function extractObservedAgents(buffer: string): ObservedAgent[] {
  // Strip ANSI codes and normalize whitespace from line wrapping
  const clean = buffer.replace(ANSI_STRIP, "").replace(/\r/g, "");
  const agents: ObservedAgent[] = [];
  const seen = new Set<string>();

  // Match patterns like:
  //   ● Agent(Research Bun alternatives — performance)
  //   ● Explore(Research Bun alternatives: D
  //   Agent(description)  (without bullet)
  // The description may wrap across lines, so join all text between ( and )
  // Use a multi-pass approach: find "Agent(" or "Explore(" then grab until closing ")"
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const toolMatch = line.match(/(?:^|[●•]\s*)(Agent|Explore|Plan)\((.*)$/);
    if (!toolMatch) continue;

    const name = toolMatch[1];
    let desc = toolMatch[2];

    // If no closing paren on this line, gather continuation lines
    if (!desc.includes(")")) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        desc += " " + lines[j].trim();
        if (desc.includes(")")) break;
      }
    }

    // Extract content before closing paren
    const parenEnd = desc.indexOf(")");
    if (parenEnd >= 0) {
      desc = desc.slice(0, parenEnd);
    }
    desc = desc.replace(/\s+/g, " ").trim();

    // Skip if it looks like a code reference rather than a spawn
    if (desc.length < 2) continue;

    const key = `${name}:${desc.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Check if "Backgrounded agent" or "completed" appears after this line
    const remaining = lines.slice(i + 1).join("\n");
    const isDone = /completed|returned a result|agent.*finished/i.test(remaining);
    const isBackground = /[Bb]ackgrounded agent/i.test(lines[i + 1] ?? "") || /[Bb]ackgrounded agent/i.test(lines[i + 2] ?? "");

    agents.push({
      name,
      description: desc,
      status: isDone ? "done" : "running",
    });
  }

  return agents;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ensureEditorPane(panes: EditorPaneState[], paneId: string): EditorPaneState[] {
  if (panes.some((pane) => pane.id === paneId)) {
    return panes;
  }

  return sortEditorPanes([
    ...panes,
    {
      id: paneId,
      openPaths: [],
      activePath: null,
    },
  ]);
}

function sortEditorPanes(panes: EditorPaneState[]): EditorPaneState[] {
  return [...panes].sort((left, right) => {
    const rank = (paneId: string) => (paneId === PRIMARY_EDITOR_PANE_ID ? 0 : 1);
    return rank(left.id) - rank(right.id);
  });
}
