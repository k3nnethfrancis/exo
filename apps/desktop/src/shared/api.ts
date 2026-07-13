import type {
  IndexSearchResponse,
  IndexSyncResult,
  IndexStatus,
  FolderIndexResult,
  FolderIndexStatus,
  FolderOverview,
  NoteDocument,
  WorkspaceGraphContext,
  SearchResult,
  TreeNode,
  OnboardingStateStore,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSettingsSaveRequest,
  WorkspaceSettingsSnapshot,
  WorkspaceSearchResults,
  InvocationRecord,
  AgentCommandTrustStatus,
} from "@exo/core";

export type TerminalKind = "shell";
export type TerminalLaunchKind = "shell";
export type TerminalHealthState = "healthy" | "idle" | "unhealthy" | "exited";
export type WorkspaceSettingsSection = "workspace" | "index" | "appearance" | "terminal" | "agents";

export interface TerminalGeometryRecord {
  cols: number;
  rows: number;
  reportedAt: string;
  source: "renderer-fit" | "initial-default";
}

export interface TerminalSessionInfo {
  id: string;
  title: string;
  cwd: string;
  kind: TerminalKind;
  command: string;
  status: "running" | "exited";
  exitCode?: number;
  health?: TerminalHealthState;
  healthDetail?: string;
  geometry?: TerminalGeometryRecord;
  attachGeneration: number;
}

export interface TerminalCreateOptions {
  terminalKind?: TerminalLaunchKind;
  cwd?: string;
}

export interface TerminalDataEvent {
  id: string;
  generation: number;
  data: string;
}

export interface TerminalWriteResult {
  ok: boolean;
  delivery: "sent" | "queued" | "not-found";
  writeId?: number;
}

export interface TerminalMessageResult extends TerminalWriteResult {}

export interface FileStatInfo {
  size: number;
  mtimeMs: number;
}

export interface ResolvedMarkdownImage {
  url: string;
}

export interface WorkspaceSetupState {
  complete: boolean;
  onboardingComplete: boolean;
  onboarding: OnboardingStateStore;
  settingsPath: string;
}

export interface WorkspaceRegistryEntry {
  id: string;
  label: string;
  notesFolder: string;
  settings: WorkspaceSettings;
  updatedAt: string;
}

export type WorkspaceSettingsRuntimeApplyOutcome =
  | { status: "applied" }
  | { status: "failed"; errorMessage: string };

export interface WorkspaceSettingsSaveOutcome extends WorkspaceSettingsSnapshot {
  runtimeApply: WorkspaceSettingsRuntimeApplyOutcome;
}

export interface IndexSyncStateEvent {
  state: "running" | "idle" | "error";
  reason: string;
  result?: IndexSyncResult;
  error?: string;
}

export interface LaunchAgentInvocationInput {
  handle: string;
  /** UUID stored in the inert <exo-invocation> document envelope. */
  protocolInvocationId: string;
  documentPath: string;
  mentionText: string;
  message: string;
  documentFrontmatter?: Record<string, unknown>;
  documentBody?: string;
  allowUntrustedOneShot?: boolean;
  persistTrust?: boolean;
}

export interface LaunchAgentInvocationResponse {
  ok: true;
  invocation: InvocationRecord;
  /** Present only for the explicit, visible command test flow. */
  terminal?: TerminalSessionInfo;
}

export interface InvocationReviewPayload {
  invocation: InvocationRecord;
  patch: string | null;
  before: string | null;
  after: string | null;
  canReject: boolean;
}

export interface AgentCommandLaunchFacts {
  commandId: string;
  handle: string;
  label: string;
  fingerprint: string;
  cwd: string | null;
  cwdReady: boolean;
  executable: string;
  executablePath: string | null;
  executableReady: boolean;
  launchable: boolean;
  block?: "disabled" | "unsupported-prompt-delivery" | "invalid-cwd-policy" | "document-required" | "cwd-missing" | "executable-missing";
  detail: string;
}

export interface TestAgentCommandInput {
  commandId: string;
  expectedFingerprint: string;
}

/** A one-time request to write an MCP entry through a provider's own CLI. */
export interface ProviderMcpSetupInput {
  providers: Array<"claude" | "codex">;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

export interface ProviderMcpSetupResult {
  provider: "claude" | "codex";
  ok: boolean;
  detail: string;
}

export interface DesktopApi {
  workspace: {
    getModel: () => Promise<WorkspaceModel>;
    getSettings: () => Promise<WorkspaceSettingsSnapshot>;
    getSetupState: () => Promise<WorkspaceSetupState>;
    markOnboardingComplete: () => Promise<OnboardingStateStore>;
    listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
    activateWorkspace: (input: { workspaceId: string; expectedRevision: WorkspaceSettingsSaveRequest["expectedRevision"] }) => Promise<WorkspaceSettingsSaveOutcome>;
    saveSettings: (request: WorkspaceSettingsSaveRequest) => Promise<WorkspaceSettingsSaveOutcome>;
    selectFolder: (options?: { title?: string; allowMultiple?: boolean; buttonLabel?: string }) => Promise<string[]>;
    getIndexStatus: () => Promise<IndexStatus>;
    resolvePreviewTarget: (target: string) => Promise<{ url: string; source: "url" | "file" }>;
    launchAgentInvocation: (input: LaunchAgentInvocationInput) => Promise<LaunchAgentInvocationResponse>;
    getAgentCommandTrust: (handle: string) => Promise<AgentCommandTrustStatus>;
    getAgentCommandLaunchFacts: (commandId: string) => Promise<AgentCommandLaunchFacts>;
    testAgentCommand: (input: TestAgentCommandInput) => Promise<LaunchAgentInvocationResponse>;
    configureProviderMcp: (input: ProviderMcpSetupInput) => Promise<ProviderMcpSetupResult[]>;
    endAgentInvocation: (invocationId: string) => Promise<InvocationRecord | null>;
    getInvocationReview: (invocationId: string) => Promise<InvocationReviewPayload | null>;
    keepInvocationReview: (invocationId: string) => Promise<InvocationRecord | null>;
    rejectInvocationReview: (input: { invocationId: string; expectedAfterSha256: string | null }) => Promise<InvocationRecord>;
    resumeInvocationInTerminal: (invocationId: string) => Promise<TerminalSessionInfo>;
    onInvocationUpdated: (callback: (record: InvocationRecord) => void) => () => void;
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
    getFolderIndexStatus: () => Promise<FolderIndexStatus>;
    getFolderOverview: (directoryPath: string) => Promise<FolderOverview>;
    ensureFolderIndex: (directoryPath: string) => Promise<FolderIndexResult>;
    createFile: (targetPath: string, content?: string) => Promise<string>;
    createFolder: (targetPath: string) => Promise<FolderIndexResult>;
    renamePath: (sourcePath: string, nextPath: string) => Promise<string>;
    deletePath: (targetPath: string) => Promise<void>;
    onDidChange: (callback: (event: { rootPath: string; eventType: string; filePath: string | null }) => void) => () => void;
    onIndexSyncState: (callback: (event: IndexSyncStateEvent) => void) => () => void;
    onCommandOpenFile: (callback: (filePath: string) => void) => () => void;
    onCommandOpenPreview: (callback: (event: { url: string }) => void) => () => void;
    onCommandFocusPreview: (callback: () => void) => () => void;
    onCommandClosePreview: (callback: () => void) => () => void;
    onCommandOpenSettings: (callback: (event: { section: WorkspaceSettingsSection }) => void) => () => void;
  };
  notes: {
    read: (filePath: string) => Promise<NoteDocument>;
    save: (filePath: string, frontmatter: Record<string, unknown>, body: string) => Promise<void>;
    stat: (filePath: string) => Promise<FileStatInfo | null>;
    getGraphContext: (filePath: string) => Promise<WorkspaceGraphContext | null>;
    resolveTarget: (sourceFilePath: string, target: string) => Promise<string | null>;
    resolveMarkdownImage: (sourceFilePath: string, target: string) => Promise<ResolvedMarkdownImage>;
    ensureTarget: (sourceFilePath: string, target: string) => Promise<string>;
    suggestTargets: (
      sourceFilePath: string,
      query: string,
    ) => Promise<Array<{ filePath: string; title: string; target: string; snippet: string }>>;
  };
  terminals: {
    ensureDefault: () => Promise<TerminalSessionInfo>;
    list: () => Promise<TerminalSessionInfo[]>;
    create: (options: TerminalCreateOptions) => Promise<TerminalSessionInfo>;
    read: (id: string, options?: { maxLines?: number }) => Promise<string>;
    write: (id: string, data: string) => Promise<TerminalWriteResult>;
    sendMessage: (id: string, message: string, submit?: boolean) => Promise<TerminalMessageResult>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    kill: (id: string) => Promise<void>;
    resolveDroppedFilePaths: (files: File[]) => string[];
    onCreated: (callback: (session: TerminalSessionInfo) => void) => () => void;
    onUpdated: (callback: (session: TerminalSessionInfo) => void) => () => void;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: { id: string; exitCode?: number }) => void) => () => void;
  };
  shell: {
    openExternal: (target: string) => Promise<void>;
    focusWindow: () => Promise<void>;
  };
}
