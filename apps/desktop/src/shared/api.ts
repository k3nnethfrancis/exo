import type {
  BranchCreateResult,
  BranchFamily,
  IndexSearchResponse,
  IndexSyncResult,
  IndexStatus,
  AgentHarnessDetection,
  ActiveProfileIdentity,
  ManagedAgentKind,
  NoteDocument,
  NoteKnowledge,
  PluginInventory,
  PluginSettingsSchema,
  PluginSettingValue,
  ProfilePlanPreview,
  PluginSource,
  ResolvedPluginSettings,
  SearchResult,
  TreeNode,
  ProfileStateStore,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSearchResults,
} from "@exo/core";

export type TerminalKind = ManagedAgentKind;
export type TerminalHealthState = "healthy" | "idle" | "unhealthy" | "exited";
export type WorkspaceSettingsSection = "workspace" | "profile" | "index" | "appearance" | "terminal";

export interface TerminalSessionInfo {
  id: string;
  title: string;
  cwd: string;
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
}

export interface TerminalCreateOptions {
  kind: TerminalKind;
  cwd?: string;
}

export interface TerminalDataEvent {
  id: string;
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

export interface TerminalDiagnostics {
  id: string;
  kind: TerminalKind;
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  health: TerminalHealthState;
  healthDetail: string;
  runtime: "tmux";
  tmuxSessionName: string;
  tmuxPaneId: string | null;
  safeAttachCommand: string;
  debugAttach: TerminalDebugAttachInfo;
  bridgeStatus: "attached" | "detached";
  paneStatus: "alive" | "dead" | "missing" | "unknown";
  cwd: string;
  title: string;
  command: string;
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath: string;
  lastInputAt: string | null;
  lastOutputAt: string | null;
  lastWriteId: number;
  lastWriteLatencyMs: number | null;
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
}

export interface AgentInstructionOverlay {
  id: string;
  scope: "global" | "notes" | "project";
  label: string;
  path: string;
  body: string;
}

export type AgentSkillHarnessId = "claude" | "codex";
export type AgentSkillScope = "global" | "workspace" | "exocortex";

export interface AgentSkillLocation {
  id: string;
  harness: AgentSkillHarnessId;
  scope: AgentSkillScope;
  label: string;
  path: string;
  enabled: boolean;
}

export interface AgentSkillFile {
  relativePath: string;
  path: string;
  kind: "file" | "directory";
  children?: AgentSkillFile[];
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  label: string;
  harness: AgentSkillHarnessId;
  scope: AgentSkillScope;
  enabled: boolean;
  rootPath: string;
  locationId: string;
  locationLabel: string;
  files: AgentSkillFile[];
  entryFilePath: string | null;
}

export interface AgentSkillSource {
  id: string;
  label: string;
  url: string;
  skillsPath: string;
  localPath: string;
  status: "idle" | "syncing" | "error";
  lastSyncedAt: string | null;
  lastErrorMessage?: string | null;
}

export interface AgentLibrarySkill {
  id: string;
  sourceId: string;
  sourceLabel: string;
  name: string;
  label: string;
  rootPath: string;
  files: AgentSkillFile[];
  entryFilePath: string | null;
}

export interface AgentSkillInventory {
  skills: AgentSkillSummary[];
  locations: AgentSkillLocation[];
  sources: AgentSkillSource[];
  librarySkills: AgentLibrarySkill[];
}

export interface AgentSkillFileContent {
  skillId: string;
  relativePath: string;
  path: string;
  body: string;
}

export interface WorkspacePluginActionInput {
  pluginId: string;
  capabilityId?: string;
  source?: PluginSource;
  manifestPath: string;
  rootDirectory: string;
}

export interface WorkspacePluginSettingsInput extends WorkspacePluginActionInput {
  values?: Record<string, PluginSettingValue>;
}

export interface WorkspacePluginSettingsResponse {
  pluginId: string;
  schema: PluginSettingsSchema;
  settings: ResolvedPluginSettings;
  inventory: PluginInventory;
}

export interface WorkspaceLocalPluginInput {
  sourceDirectory: string;
  target: "user" | "workspace";
}

export interface WorkspaceReplaceLocalPluginInput extends WorkspaceLocalPluginInput {
  existing: WorkspacePluginActionInput;
}

export interface WorkspaceProfileCopyResponse {
  identity: ActiveProfileIdentity;
  profileState: ProfileStateStore;
  inventory: PluginInventory;
  manifestPath: string;
  rootDirectory: string;
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
    getAgentInstructionConfig: () => Promise<AgentInstructionConfig>;
    listAgentHarnesses: () => Promise<AgentHarnessDetection[]>;
    listPluginInventory: () => Promise<PluginInventory>;
    getProfileState: () => Promise<ProfileStateStore>;
    setActiveProfile: (input: ActiveProfileIdentity) => Promise<ProfileStateStore>;
    clearActiveProfile: () => Promise<ProfileStateStore>;
    setProfileAutoUpdate: (input: { autoUpdate: boolean }) => Promise<ProfileStateStore>;
    markProfileReviewRequired: (input: { reviewRequired: boolean }) => Promise<ProfileStateStore>;
    previewProfile: (input: ActiveProfileIdentity) => Promise<ProfilePlanPreview>;
    copyProfile: (input: ActiveProfileIdentity) => Promise<WorkspaceProfileCopyResponse>;
    enablePlugin: (input: WorkspacePluginActionInput) => Promise<PluginInventory>;
    disablePlugin: (input: WorkspacePluginActionInput) => Promise<PluginInventory>;
    trustPlugin: (input: WorkspacePluginActionInput) => Promise<PluginInventory>;
    addLocalPlugin: (input: WorkspaceLocalPluginInput) => Promise<PluginInventory>;
    removeLocalPlugin: (input: WorkspacePluginActionInput) => Promise<PluginInventory>;
    replaceLocalPlugin: (input: WorkspaceReplaceLocalPluginInput) => Promise<PluginInventory>;
    readPluginSettings: (input: WorkspacePluginActionInput) => Promise<WorkspacePluginSettingsResponse>;
    updatePluginSettings: (input: WorkspacePluginSettingsInput) => Promise<WorkspacePluginSettingsResponse>;
    resetPluginSettings: (input: WorkspacePluginActionInput) => Promise<WorkspacePluginSettingsResponse>;
    saveAgentInstructionConfig: (input: {
      scopeId: AgentInstructionScopeId;
      body: string;
    }) => Promise<AgentInstructionConfig>;
    listAgentInstructionOverlays: () => Promise<AgentInstructionOverlay[]>;
    listAgentSkills: () => Promise<AgentSkillInventory>;
    addAgentSkillSource: (input: { url: string; skillsPath?: string; label?: string }) => Promise<AgentSkillInventory>;
    syncAgentSkillSource: (sourceId: string) => Promise<AgentSkillInventory>;
    installAgentLibrarySkill: (input: { librarySkillId: string; locationId: string; targetName?: string }) => Promise<AgentSkillInventory>;
    readAgentSkillFile: (skillId: string, relativePath: string) => Promise<AgentSkillFileContent>;
    saveAgentSkillFile: (skillId: string, relativePath: string, body: string) => Promise<AgentSkillFileContent>;
    setAgentSkillEnabled: (input: { skillId: string; enabled: boolean }) => Promise<AgentSkillInventory>;
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
    readTranscript: (id: string, tailChars?: number) => Promise<string>;
    write: (id: string, data: string) => Promise<TerminalWriteResult>;
    sendMessage: (id: string, message: string, submit?: boolean) => Promise<TerminalMessageResult>;
    reconnect: (id: string) => Promise<TerminalSessionInfo | null>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    kill: (id: string) => Promise<void>;
    resolveDroppedFilePaths: (files: File[]) => string[];
    onCreated: (callback: (session: TerminalSessionInfo) => void) => () => void;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: { id: string; exitCode?: number }) => void) => () => void;
  };
  shell: {
    openExternal: (target: string) => Promise<void>;
    focusWindow: () => Promise<void>;
  };
}
