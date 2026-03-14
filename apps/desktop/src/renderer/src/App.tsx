import { useEffect, useMemo, useState } from "react";
import type { BranchFamily, NoteDocument, NoteKnowledge, SearchResult, TreeNode, WorkspaceModel, WorkspaceSearchResults } from "@exo/core";

import type { TerminalSessionInfo } from "../../shared/api";

import { FileTree } from "./components/FileTree";
import { NoteEditor } from "./components/NoteEditor";
import { TerminalDock } from "./components/TerminalDock";

interface OpenEditorDocument extends NoteDocument {
  dirty: boolean;
}

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
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const [tagResults, setTagResults] = useState<SearchResult[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [terminalPlacement, setTerminalPlacement] = useState<"right" | "bottom">("right");
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;

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

      const firstNote = nextNoteTrees.flatMap((entry) => flattenFiles(entry[1])).at(0);
      if (firstNote) {
        await openFile(firstNote.path);
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

    const removeDataListener = window.exo.terminals.onData(({ id, data }) => {
      setTerminalBuffers((current) => ({
        ...current,
        [id]: `${current[id] ?? ""}${data}`,
      }));
    });

    const removeExitListener = window.exo.terminals.onExit(({ id, exitCode }) => {
      setTerminalSessions((current) =>
        current.map((session) => (session.id === id ? { ...session, status: "exited", exitCode } : session)),
      );
    });

    return () => {
      cancelled = true;
      removeDataListener();
      removeExitListener();
    };
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setWorkspaceSearchResults({
        notes: [],
        projectFiles: [],
        tags: [],
      });
      return;
    }

    const timeout = window.setTimeout(async () => {
      const results = await window.exo.workspace.searchWorkspace(searchQuery);
      setWorkspaceSearchResults(results);
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

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

  async function reloadNoteTrees() {
    if (!workspaceModel) {
      return;
    }

    const nextNoteTrees = await Promise.all(
      workspaceModel.noteRoots.map(
        async (root) => [root.path, await window.exo.workspace.listTree(root.path, { markdownOnly: true, maxDepth: 3 })] as const,
      ),
    );
    setNoteTrees(Object.fromEntries(nextNoteTrees));
  }

  async function openFile(filePath: string) {
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
      await openFile(resolved);
    }
  }

  async function openTag(tag: string) {
    setActiveTag(tag);
    const results = await window.exo.workspace.searchTag(tag);
    setTagResults(results);
  }

  async function createTerminal(kind: "shell" | "claude" | "codex", cwd?: string) {
    const session = await window.exo.terminals.create({ kind, cwd });
    setTerminalSessions((current) => [...current, session]);
    setActiveTerminalId(session.id);
  }

  async function closeTerminal(id: string) {
    await window.exo.terminals.kill(id);
    setTerminalSessions((current) => current.filter((session) => session.id !== id));
    setTerminalBuffers((current) => {
      const next = { ...current };
      delete next[id];
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
    await reloadNoteTrees();
    await openFile(result.branchFilePath);
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
        searchQuery={searchQuery}
        searchResults={workspaceSearchResults}
        onSearchQueryChange={setSearchQuery}
        onOpenFile={(filePath) => void openFile(filePath)}
        onOpenTag={(tag) => void openTag(tag)}
      />

      <div className={`workspace ${terminalPlacement === "right" ? "workspace--terminal-right" : "workspace--terminal-bottom"}`}>
        <div className="editor-shell">
          <div className="tab-strip" data-testid="editor-tabs">
            {Object.values(openDocuments).map((document) => (
              <button
                key={document.filePath}
                className={`tab-strip__tab ${document.filePath === activeDocumentPath ? "tab-strip__tab--active" : ""}`}
                onClick={() => setActiveDocumentPath(document.filePath)}
                type="button"
              >
                <span className={document.dirty ? "status-dot status-dot--dirty" : "status-dot"} />
                {document.title}
              </button>
            ))}
          </div>

          <NoteEditor
            document={activeDocument}
            knowledge={activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null}
            branchFamily={activeDocumentPath ? branchFamiliesByPath[activeDocumentPath] ?? null : null}
            propertiesCollapsed={propertiesCollapsed}
            tagResults={tagResults}
            activeTag={activeTag}
            onToggleProperties={() => setPropertiesCollapsed((current) => !current)}
            onBodyChange={updateBody}
            onSave={() => void (activeDocumentPath ? saveDocument(activeDocumentPath) : Promise.resolve())}
            onOpenTarget={(target) => void openKnowledgeTarget(target)}
            onOpenExternal={(target) => void window.exo.shell.openExternal(target)}
            onOpenTag={(tag) => void openTag(tag)}
            onOpenShellHere={() => void createTerminal("shell", activeDocumentPath ? directoryOf(activeDocumentPath) : workspaceModel.defaultTerminalCwd)}
            onCreateBranch={() => void createBranchFromActiveDocument()}
          />
        </div>

        <TerminalDock
          placement={terminalPlacement}
          sessions={terminalSessions}
          activeTerminalId={activeTerminalId}
          buffers={terminalBuffers}
          onSetPlacement={setTerminalPlacement}
          onCreateTerminal={(kind, cwd) => void createTerminal(kind, cwd)}
          onSetActiveTerminal={setActiveTerminalId}
          onWrite={(id, data) => void window.exo.terminals.write(id, data)}
          onResize={(id, cols, rows) => void window.exo.terminals.resize(id, cols, rows)}
          onKill={(id) => void closeTerminal(id)}
        />
      </div>
    </div>
  );
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [node];
    }

    return node.children ? flattenFiles(node.children) : [];
  });
}

function directoryOf(filePath: string): string {
  const parts = filePath.split("/");
  return parts.slice(0, -1).join("/") || "/";
}
