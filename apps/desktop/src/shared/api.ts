import type {
  BranchCreateResult,
  BranchFamily,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  SemanticSearchResult,
  TreeNode,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSearchResults,
} from "@exo/core";

export type TerminalKind = "shell" | "claude" | "codex";

export interface TerminalSessionInfo {
  id: string;
  title: string;
  cwd: string;
  kind: TerminalKind;
  command: string;
  status: "running" | "exited";
  exitCode?: number;
}

export interface TerminalCreateOptions {
  kind: TerminalKind;
  cwd?: string;
}

export interface DesktopApi {
  workspace: {
    getModel: () => Promise<WorkspaceModel>;
    getSettings: () => Promise<WorkspaceSettings>;
    saveSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
    listTree: (rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number }) => Promise<TreeNode[]>;
    searchNotes: (query: string) => Promise<SearchResult[]>;
    searchWorkspace: (query: string) => Promise<WorkspaceSearchResults>;
    searchTag: (tag: string) => Promise<SearchResult[]>;
    searchSemantic: (query: string) => Promise<SemanticSearchResult[]>;
    createFile: (targetPath: string, content?: string) => Promise<string>;
    createDirectory: (targetPath: string) => Promise<string>;
    renamePath: (sourcePath: string, nextPath: string) => Promise<string>;
    deletePath: (targetPath: string) => Promise<void>;
    onDidChange: (callback: (event: { rootPath: string; eventType: string; filePath: string | null }) => void) => () => void;
    onCommandOpenFile: (callback: (filePath: string) => void) => () => void;
  };
  notes: {
    read: (filePath: string) => Promise<NoteDocument>;
    save: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<void>;
    getKnowledge: (filePath: string) => Promise<NoteKnowledge>;
    resolveTarget: (sourceFilePath: string, target: string) => Promise<string | null>;
    ensureTarget: (sourceFilePath: string, target: string) => Promise<string>;
    suggestTargets: (
      sourceFilePath: string,
      query: string,
    ) => Promise<Array<{ filePath: string; title: string; target: string; snippet: string }>>;
    getBranchFamily: (filePath: string) => Promise<BranchFamily>;
    createBranch: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<BranchCreateResult>;
  };
  terminals: {
    ensureDefault: () => Promise<TerminalSessionInfo>;
    list: () => Promise<TerminalSessionInfo[]>;
    create: (options: TerminalCreateOptions) => Promise<TerminalSessionInfo>;
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    kill: (id: string) => Promise<void>;
    onData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onExit: (callback: (event: { id: string; exitCode?: number }) => void) => () => void;
  };
  shell: {
    openExternal: (target: string) => Promise<void>;
  };
}
