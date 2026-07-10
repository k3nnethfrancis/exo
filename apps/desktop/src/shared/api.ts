import type {
  BranchCreateResult,
  BranchFamily,
  IndexSearchResponse,
  IndexSyncResult,
  IndexStatus,
  AgentHarnessId,
  CapabilitySurface,
  ManagedAgentKind,
  NoteDocument,
  NoteKnowledge,
  SearchResult,
  TreeNode,
  OnboardingStateStore,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSettingsSaveRequest,
  WorkspaceSettingsSnapshot,
  WorkspaceSearchResults,
  TerminalSubstrateKind,
  InvocationRecord,
} from "@exo/core";

export type TerminalKind = ManagedAgentKind;
export type TerminalLaunchKind = TerminalSubstrateKind;
export type TerminalHealthState = "healthy" | "idle" | "unhealthy" | "exited";
export type WorkspaceSettingsSection = "workspace" | "index" | "appearance" | "terminal";

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
  terminalKind: TerminalSubstrateKind;
  harnessId: AgentHarnessId | null;
  kind: TerminalKind;
  command: string;
  instructionOverlayPath?: string | null;
  transcriptPath?: string;
  status: "running" | "exited";
  exitCode?: number;
  readiness?: "ready" | "starting" | "blocked";
  readinessDetail?: string;
  queuedInputCount?: number;
  health?: TerminalHealthState;
  healthDetail?: string;
  geometry?: TerminalGeometryRecord;
  attachGeneration: number;
}

export interface TerminalCreateOptions {
  terminalKind?: TerminalLaunchKind;
  harnessId?: AgentHarnessId;
  callerSurface?: CapabilitySurface;
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
  queuedInputCount?: number;
  readiness?: TerminalSessionInfo["readiness"];
  readinessDetail?: string;
}

export interface TerminalMessageResult extends TerminalWriteResult {}

export interface TerminalDebugAttachInfo {
  tmuxSessionName: string;
  tmuxPaneId: string | null;
  safeAttachCommand: string;
}

export interface TerminalDiagnosticsGeometry {
  renderer: TerminalGeometryRecord | null;
  tmuxPane: { width: number; height: number } | null;
  tmuxClient: { width: number; height: number } | null;
  divergent: boolean;
  divergentSinceMs: number | null;
  attachGeneration: number;
}

export interface TerminalDiagnostics {
  id: string;
  terminalKind: TerminalSubstrateKind;
  harnessId: AgentHarnessId | null;
  kind: TerminalKind;
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  health: TerminalHealthState;
  healthDetail: string;
  runtime: "pty" | "tmux";
  tmuxSessionName?: string;
  tmuxPaneId: string | null;
  safeAttachCommand: string;
  debugAttach: TerminalDebugAttachInfo;
  bridgeStatus: "attached" | "detached";
  paneStatus: "alive" | "dead" | "missing" | "unknown";
  geometry: TerminalDiagnosticsGeometry;
  cwd: string;
  title: string;
  command: string;
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath?: string;
  lastInputAt: string | null;
  lastOutputAt: string | null;
  lastWriteId: number;
  lastWriteLatencyMs: number | null;
}

export interface FileStatInfo {
  size: number;
  mtimeMs: number;
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

export type AgentInstructionScopeId = "global" | "exocortex";
export type AgentInstructionProviderId = "agents" | "claude";
export type AgentInstructionStatus = "aligned" | "different" | "missing-agents" | "missing-claude" | "missing-both" | "error";

export interface AgentInstructionProviderFile {
  id: AgentInstructionProviderId;
  label: string;
  path: string;
  exists: boolean;
  body: string;
  errorMessage?: string | null;
}

export interface AgentInstructionScope {
  id: AgentInstructionScopeId;
  label: string;
  description: string;
  rootPath: string;
  files: {
    agents: AgentInstructionProviderFile;
    claude: AgentInstructionProviderFile;
  };
  status: AgentInstructionStatus;
  body: string;
  source: AgentInstructionProviderId | "empty" | "unresolved";
  errorMessages: string[];
}

export interface AgentInstructionConfig {
  scopes: AgentInstructionScope[];
  starterTemplate: string;
  exographContextTemplate: string;
}

export interface AgentInstructionOverlay {
  id: string;
  scope: "global" | "notes";
  label: string;
  path: string;
  body: string;
}

export interface IndexSyncStateEvent {
  state: "running" | "idle" | "error";
  reason: string;
  result?: IndexSyncResult;
  error?: string;
}

export interface LaunchAgentInvocationInput {
  handle: string;
  documentPath: string;
  mentionText: string;
  message: string;
  allowUntrustedOneShot?: boolean;
  persistTrust?: boolean;
}

export interface LaunchAgentInvocationResponse {
  ok: true;
  invocation: InvocationRecord;
  terminal: TerminalSessionInfo;
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
    endAgentInvocation: (invocationId: string) => Promise<InvocationRecord | null>;
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
    getAgentInstructionConfig: () => Promise<AgentInstructionConfig>;
    saveAgentInstructionConfig: (input: {
      scopeId: AgentInstructionScopeId;
      body: string;
    }) => Promise<AgentInstructionConfig>;
    syncAgentInstructionFilesFromProvider: (input: {
      scopeId: AgentInstructionScopeId;
      sourceProviderId: AgentInstructionProviderId;
    }) => Promise<AgentInstructionConfig>;
    applyGlobalExographContext: (input: {
      body: string;
    }) => Promise<AgentInstructionConfig>;
    listAgentInstructionOverlays: () => Promise<AgentInstructionOverlay[]>;
    createFile: (targetPath: string, content?: string) => Promise<string>;
    createDirectory: (targetPath: string) => Promise<string>;
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
    diagnostics: () => Promise<TerminalDiagnostics[]>;
    create: (options: TerminalCreateOptions) => Promise<TerminalSessionInfo>;
    read: (id: string, options?: { maxLines?: number }) => Promise<string>;
    restoreSnapshot: (id: string) => Promise<string>;
    readTranscript: (id: string, tailChars?: number) => Promise<string>;
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
