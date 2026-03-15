import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BranchFamily, NoteDocument, NoteKnowledge, SearchResult, TreeNode, WorkspaceModel, WorkspaceSearchResults } from "@exo/core";

import type { TerminalSessionInfo } from "../../shared/api";

import { EditorPane, type EditorPaneState } from "./components/EditorPane";
import { FileTree } from "./components/FileTree";
import { InspectorDock } from "./components/InspectorDock";
import { SubagentDock, type AgentAnnotation } from "./components/SubagentDock";
import { TerminalDock } from "./components/TerminalDock";

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

type DragState =
  | { kind: "terminal" }
  | { kind: "document"; filePath: string; sourcePaneId?: string };

type ResizeState =
  | { axis: "vertical"; startSize: number; origin: number }
  | { axis: "horizontal"; startSize: number; origin: number };

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
  const [editorSplitOrientation, setEditorSplitOrientation] = useState<"right" | "bottom" | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [terminalPlacement, setTerminalPlacement] = useState<"right" | "bottom">("right");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const [agentAnnotations, setAgentAnnotations] = useState<Record<string, AgentAnnotation>>({});
  const [terminalRightWidth, setTerminalRightWidth] = useState(372);
  const [terminalBottomHeight, setTerminalBottomHeight] = useState(236);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogState | null>(null);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => readStoredAppearanceMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const pendingTerminalChunksRef = useRef<Record<string, string>>({});
  const terminalFlushFrameRef = useRef<number | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;
  const activeKnowledge = activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null;
  const compactEditorChrome = editorPanes.length > 1;
  const terminalCollapsed = terminalSessions.length === 0;
  const effectiveTerminalPlacement = terminalCollapsed ? "bottom" : terminalPlacement;
  const compactTerminalChrome = terminalCollapsed || effectiveTerminalPlacement === "right";
  const resolvedAppearance: ResolvedAppearance = appearanceMode === "system" ? (systemPrefersDark ? "dark" : "light") : appearanceMode;
  const terminalOutputPreviewById = useMemo(
    () =>
      Object.fromEntries(
        terminalSessions.map((session) => [session.id, summarizeTerminalBuffer(terminalBuffers[session.id] ?? "")] as const),
      ),
    [terminalBuffers, terminalSessions],
  );

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
    document.documentElement.dataset.theme = resolvedAppearance;
    document.documentElement.style.colorScheme = resolvedAppearance;
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearanceMode);
  }, [appearanceMode, resolvedAppearance]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
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

      setWorkspaceModel(model);
      setNoteTrees(Object.fromEntries(nextNoteTrees));
      setProjectTrees(Object.fromEntries(nextProjectTrees));

      const firstNote = pickInitialNote(nextNoteTrees);
      if (firstNote) {
        await openFile(firstNote.path, PRIMARY_EDITOR_PANE_ID);
      }

      const defaultTerminal = await window.exo.terminals.ensureDefault();
      const sessions = await window.exo.terminals.list();
      if (cancelled) {
        return;
      }

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
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeDocument) {
        event.preventDefault();
        void saveDocument(activeDocument.filePath);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDocument]);

  useEffect(() => {
    if (!resizeState) {
      return;
    }
    const currentResize = resizeState;

    function onMouseMove(event: MouseEvent) {
      const rect = workspaceBodyRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      if (currentResize.axis === "vertical") {
        const delta = currentResize.origin - event.clientX;
        setTerminalRightWidth(clamp(currentResize.startSize + delta, 280, Math.max(320, rect.width - 320)));
      } else {
        const delta = currentResize.origin - event.clientY;
        setTerminalBottomHeight(clamp(currentResize.startSize + delta, 180, Math.max(220, rect.height - 240)));
      }
    }

    function onMouseUp() {
      setResizeState(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizeState]);

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
    const nextPanes = sortEditorPanes(
      editorPanes.map((pane) => (pane.id === paneId ? closeDocumentInPaneState(pane, filePath) : pane)),
    );
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

    if (resolved) {
      await openFile(resolved, focusedEditorPaneId);
    }
  }

  async function openTag(tag: string) {
    setActiveTag(tag);
    const results = await window.exo.workspace.searchTag(tag);
    setTagResults(results);
  }

  async function createTerminal(kind: "shell" | "claude" | "codex", cwd?: string, activate = true) {
    const session = await window.exo.terminals.create({ kind, cwd });
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

  function updateAgentAnnotation(id: string, patch: Partial<AgentAnnotation>) {
    const defaults: AgentAnnotation = {
      runLabel: "",
      parentId: null,
    };
    setAgentAnnotations((current) => ({
      ...current,
      [id]: {
        ...defaults,
        ...current[id],
        ...patch,
      },
    }));
  }

  function getSelectedAgent() {
    return terminalSessions.find((session) => session.id === activeTerminalId) ?? terminalSessions[0] ?? null;
  }

  function nextRunLabel() {
    const runNumbers = Object.values(agentAnnotations)
      .map((annotation) => annotation.runLabel.trim())
      .filter((label) => /^run-\d+$/.test(label))
      .map((label) => Number(label.split("-")[1]))
      .filter((value) => Number.isFinite(value));
    const next = (runNumbers.length ? Math.max(...runNumbers) : 0) + 1;
    return `run-${next}`;
  }

  function kickOffRun() {
    const selected = getSelectedAgent();
    if (!selected) {
      return;
    }

    const current = agentAnnotations[selected.id];
    updateAgentAnnotation(selected.id, {
      runLabel: current?.runLabel.trim() ? current.runLabel : nextRunLabel(),
    });
    setActiveTerminalId(selected.id);
  }

  async function spawnAgent(kind: "claude" | "codex") {
    const selected = getSelectedAgent();
    if (!selected || !workspaceModel) {
      return;
    }

    const parentAnnotation = agentAnnotations[selected.id];
    const runLabel = parentAnnotation?.runLabel.trim() ? parentAnnotation.runLabel : nextRunLabel();
    if (!parentAnnotation?.runLabel.trim()) {
      updateAgentAnnotation(selected.id, {
        runLabel,
      });
    }

    const session = await createTerminal(kind, selected.cwd || workspaceModel.defaultTerminalCwd, false);
    updateAgentAnnotation(session.id, {
      runLabel,
      parentId: selected.id,
    });
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

    setEditorSplitOrientation(orientation);
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
    <div className="shell">
      <FileTree
        workspaceRoot={workspaceModel.workspaceRoot}
        noteRoots={noteSections}
        projectRoots={projectSections}
        appearanceMode={appearanceMode}
        resolvedAppearance={resolvedAppearance}
        searchQuery={searchQuery}
        searchResults={workspaceSearchResults}
        onAppearanceModeChange={setAppearanceMode}
        onSearchQueryChange={setSearchQuery}
        onOpenFile={(filePath) => void openFile(filePath, focusedEditorPaneId)}
        onOpenTag={(tag) => void openTag(tag)}
        onStartDocumentDrag={(filePath) => startDocumentDrag(filePath)}
        onEndDocumentDrag={() => setDragState(null)}
        onCreateFile={(directoryPath) => createFileInDirectory(directoryPath)}
        onCreateDirectory={(directoryPath) => createDirectoryInDirectory(directoryPath)}
        onRenamePath={(targetPath) => renameWorkspacePath(targetPath)}
        onDeletePath={(targetPath) => deleteWorkspacePath(targetPath)}
      />

      <div className="workspace">
        <div
          ref={workspaceBodyRef}
          className={`workspace__body workspace__body--terminal-${effectiveTerminalPlacement}`}
          style={
            effectiveTerminalPlacement === "right"
              ? { gridTemplateColumns: `minmax(0, 1fr) 8px ${terminalRightWidth}px` }
              : {
                  gridTemplateRows: `minmax(0, 1fr) ${terminalCollapsed ? "0px" : "8px"} ${terminalCollapsed ? "36px" : `${terminalBottomHeight}px`}`,
                }
          }
        >
          <div
            className={`editor-area ${editorSplitOrientation === "right" ? "editor-area--split-right" : ""} ${editorSplitOrientation === "bottom" ? "editor-area--split-bottom" : ""}`}
          >
            {sortEditorPanes(editorPanes).map((pane) => (
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
                onBodyChange={updateBody}
                onSave={() => void (pane.activePath ? saveDocument(pane.activePath) : Promise.resolve())}
                onOpenTag={(tag) => void openTag(tag)}
                onOpenBranch={(filePath) => void openFile(filePath, pane.id)}
                onCreateBranch={() => void createBranchFromActiveDocument()}
                appearance={resolvedAppearance}
                compact={compactEditorChrome}
              />
            ))}

            {dragState?.kind === "document" ? (
              <div className="dock-drop-zones dock-drop-zones--document">
                <button
                  className={`dock-drop-zone dock-drop-zone--right ${editorSplitOrientation === "right" ? "dock-drop-zone--active" : ""}`}
                  data-testid="editor-drop-right"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveDocumentToSplit("right")}
                  type="button"
                >
                  Split Right
                </button>
                <button
                  className={`dock-drop-zone dock-drop-zone--bottom ${editorSplitOrientation === "bottom" ? "dock-drop-zone--active" : ""}`}
                  data-testid="editor-drop-bottom"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveDocumentToSplit("bottom")}
                  type="button"
                >
                  Split Bottom
                </button>
              </div>
            ) : null}
          </div>

          {terminalCollapsed ? null : (
            <div
              className={`pane-resizer ${effectiveTerminalPlacement === "right" ? "pane-resizer--vertical" : "pane-resizer--horizontal"}`}
              onMouseDown={(event) =>
                setResizeState({
                  axis: effectiveTerminalPlacement === "right" ? "vertical" : "horizontal",
                  startSize: effectiveTerminalPlacement === "right" ? terminalRightWidth : terminalBottomHeight,
                  origin: effectiveTerminalPlacement === "right" ? event.clientX : event.clientY,
                })
              }
            />
          )}

          <TerminalDock
            placement={effectiveTerminalPlacement}
            compact={compactTerminalChrome}
            collapsed={terminalCollapsed}
            sessions={terminalSessions}
            activeTerminalId={activeTerminalId}
            buffers={terminalBuffers}
            appearance={resolvedAppearance}
            onCreateTerminal={(kind, cwd) => void createTerminal(kind, cwd)}
            onSetActiveTerminal={setActiveTerminalId}
            onWrite={(id, data) => void window.exo.terminals.write(id, data)}
            onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
            onKill={(id) => void closeTerminal(id)}
            onStartDockDrag={() => setDragState({ kind: "terminal" })}
            onEndDockDrag={() => setDragState(null)}
            onTogglePlacement={() => setTerminalPlacement((current) => (current === "right" ? "bottom" : "right"))}
          />

          {dragState?.kind === "terminal" ? (
            <div className="dock-drop-zones dock-drop-zones--terminal">
              <button
                className={`dock-drop-zone dock-drop-zone--right ${terminalPlacement === "right" ? "dock-drop-zone--active" : ""}`}
                data-testid="dock-drop-right"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  setTerminalPlacement("right");
                  setDragState(null);
                }}
                type="button"
              >
                Dock Right
              </button>
              <button
                className={`dock-drop-zone dock-drop-zone--bottom ${terminalPlacement === "bottom" ? "dock-drop-zone--active" : ""}`}
                data-testid="dock-drop-bottom"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  setTerminalPlacement("bottom");
                  setDragState(null);
                }}
                type="button"
              >
                Dock Bottom
              </button>
            </div>
          ) : null}
        </div>

        <div
          className="workspace-footer"
          style={{ gridTemplateColumns: `minmax(0, 1fr) ${Math.max(312, terminalRightWidth)}px` }}
        >
          <InspectorDock
            document={activeDocument}
            knowledge={activeKnowledge}
            collapsed={inspectorCollapsed}
            activeTag={activeTag}
            tagResults={tagResults}
            onToggleCollapsed={() => setInspectorCollapsed((current) => !current)}
            onOpenTarget={(target) => void openKnowledgeTarget(target)}
            onOpenExternal={(target) => void window.exo.shell.openExternal(target)}
            onOpenTag={(tag) => void openTag(tag)}
          />

          <SubagentDock
            collapsed={subagentsCollapsed}
            terminalSessions={terminalSessions}
            activeTerminalId={activeTerminalId}
            terminalOutputPreviewById={terminalOutputPreviewById}
            agentAnnotations={agentAnnotations}
            onToggleCollapsed={() => setSubagentsCollapsed((current) => !current)}
            onFocusAgent={setActiveTerminalId}
            onKickOffRun={kickOffRun}
            onSpawnAgent={(kind) => void spawnAgent(kind)}
          />
        </div>
      </div>

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
    </div>
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
