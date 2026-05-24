import type {
  BranchCreateResult,
  BranchFamily,
  IndexSearchResponse,
  IndexSyncResult,
  IndexStatus,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
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

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface FileStatInfo {
  size: number;
  mtimeMs: number;
}

export interface WorkspaceGitStatus {
  rootPath: string;
  branch: string | null;
  dirty: boolean;
  changes: WorkspaceGitChange[];
}

export interface WorkspaceGitChange {
  path: string;
  absolutePath: string;
  status: string;
  firstChangedLine?: number | null;
}

export interface WorkspaceSetupState {
  complete: boolean;
  settingsPath: string;
}

export interface WorkspaceRegistryEntry {
  id: string;
  label: string;
  notesFolder: string;
  settings: WorkspaceSettings;
  updatedAt: string;
}

export interface AgentContextFile {
  id: string;
  scope: "global" | "notes" | "project";
  provider: "codex" | "claude";
  targetId: string;
  targetLabel: string;
  rootPath: string;
  label: string;
  path: string;
  exists: boolean;
  body: string;
}

export interface AgentContextTarget {
  id: string;
  scope: "global" | "notes" | "project";
  label: string;
  rootPath: string;
}

export interface AgentContextHistoryEntry {
  id: string;
  targetId: string;
  targetLabel: string;
  scope: "global" | "notes" | "project";
  rootPath: string;
  createdAt: string;
  previousBody: string;
  nextBody: string;
}

export interface AgentContextBundleResult {
  files: AgentContextFile[];
  history: AgentContextHistoryEntry[];
}

export interface IndexSyncStateEvent {
  state: "running" | "idle" | "error";
  reason: string;
  result?: IndexSyncResult;
  error?: string;
}

export interface DesktopApi {
  workspace: {
    getModel: () => Promise<WorkspaceModel>;
    getSettings: () => Promise<WorkspaceSettings>;
    getSetupState: () => Promise<WorkspaceSetupState>;
    listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
    activateWorkspace: (workspaceId: string) => Promise<WorkspaceSettings>;
    saveSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
    selectFolder: (options?: { title?: string; allowMultiple?: boolean; buttonLabel?: string }) => Promise<string[]>;
    getIndexStatus: () => Promise<IndexStatus>;
    syncIndex: () => Promise<IndexSyncResult>;
    updateIndex: () => Promise<IndexStatus>;
    embedIndex: () => Promise<IndexStatus>;
    listTree: (
      rootPath: string,
      options?: { markdownOnly?: boolean; maxDepth?: number; includeEmptyDirectories?: boolean },
    ) => Promise<TreeNode[]>;
    searchNotes: (query: string) => Promise<SearchResult[]>;
    searchWorkspace: (query: string) => Promise<WorkspaceSearchResults>;
    searchIndex: (query: string, options?: { limit?: number; forceMode?: "lexical" | "semantic" | "hybrid" }) => Promise<IndexSearchResponse>;
    searchTag: (tag: string) => Promise<SearchResult[]>;
    getGitStatus: (rootPath: string) => Promise<WorkspaceGitStatus | null>;
    listAgentContextFiles: () => Promise<AgentContextFile[]>;
    listAgentContextHistory: () => Promise<AgentContextHistoryEntry[]>;
    saveAgentContextFile: (filePath: string, body: string) => Promise<AgentContextFile>;
    saveAgentContextBundle: (input: {
      targetId: string;
      body: string;
    }) => Promise<AgentContextBundleResult>;
    restoreAgentContextHistory: (historyId: string) => Promise<AgentContextBundleResult>;
    createFile: (targetPath: string, content?: string) => Promise<string>;
    createDirectory: (targetPath: string) => Promise<string>;
    renamePath: (sourcePath: string, nextPath: string) => Promise<string>;
    deletePath: (targetPath: string) => Promise<void>;
    onDidChange: (callback: (event: { rootPath: string; eventType: string; filePath: string | null }) => void) => () => void;
    onIndexSyncState: (callback: (event: IndexSyncStateEvent) => void) => () => void;
    onCommandOpenFile: (callback: (filePath: string) => void) => () => void;
  };
  notes: {
    read: (filePath: string) => Promise<NoteDocument>;
    save: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<void>;
    stat: (filePath: string) => Promise<FileStatInfo | null>;
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
    read: (id: string) => Promise<string>;
    readTranscript: (id: string, tailChars?: number) => Promise<string>;
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    setStreaming: (ids: string[]) => Promise<void>;
    kill: (id: string) => Promise<void>;
    resolveDroppedFilePaths: (files: File[]) => string[];
    onCreated: (callback: (session: TerminalSessionInfo) => void) => () => void;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: { id: string; exitCode?: number }) => void) => () => void;
  };
  shell: {
    openExternal: (target: string) => Promise<void>;
  };
}
