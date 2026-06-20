export type RootKind = "notes" | "projects";
export type DocumentKind = "markdown" | "text";
export type ManagedAgentKind = "shell" | "claude" | "codex" | "pi" | "hermes";
export type AgentHarnessAdapterId = "shell" | "claude-code" | "codex" | "pi" | "hermes";
export type AgentHarnessStatus = "available" | "configured" | "not-found" | "disabled" | "broken";
export type ColorThemeId = "exo-neutral" | "exo-solar";

export interface AttachedRoot {
  id: string;
  label: string;
  path: string;
  kind: RootKind;
}

export interface WorkspaceModel {
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: AttachedRoot[];
  projectRoots: AttachedRoot[];
  indexedRoots: IndexedRoot[];
  indexing: IndexingConfig;
  attachedWorkcells: string[];
}

export interface WorkspaceSettings {
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string[];
  projectRoots: string[];
  indexedRoots: IndexedRoot[];
  indexing: IndexingConfig;
  appearanceMode: "system" | "light" | "dark";
  colorThemeId: ColorThemeId;
  editorFontSize: number;
  terminalFontSize: number;
  terminalHistoryMode: TerminalHistoryMode;
  terminalHistoryLines: number;
  terminalTranscriptRetention: TerminalTranscriptRetention;
  terminalTranscriptRetentionDays: number;
  terminalInputCoalesceMs?: number;
  terminalAgentStartupGraceMs?: number;
  terminalAgentSubmitDelayMs?: number;
  terminalInitialColumns?: number;
  terminalInitialRows?: number;
  terminalMinimumColumns?: number;
  terminalMinimumRows?: number;
  terminalReadTailChars?: number;
  terminalMaxReadTailChars?: number;
  terminalUnresponsiveThresholdMs?: number;
  terminalIdleThresholdMs?: number;
  explorerScale: number;
  exploreIndexSearchOnEnter: boolean;
  indexUpdateStrategy: IndexUpdateStrategy;
  layout?: WorkspaceLayoutSettings;
}

export interface WorkspaceLayoutSettings {
  editorTree: WorkspacePaneNode;
  terminalTree: WorkspacePaneNode;
  terminalCollapsed: boolean;
  sidePanesFlipped: boolean;
  zoneSplitRatio: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  inspectorCollapsed: boolean;
}

export type WorkspacePaneNode = WorkspacePaneLeaf | WorkspacePaneSplit;

export interface WorkspacePaneLeaf {
  kind: "leaf";
  id: string;
  content: WorkspacePaneContent;
}

export interface WorkspacePaneSplit {
  kind: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [WorkspacePaneNode, WorkspacePaneNode];
}

export type WorkspacePaneContent = WorkspaceEditorPaneContent | WorkspaceTerminalPaneContent | WorkspaceBrowserPaneContent;

export interface WorkspaceEditorPaneContent {
  kind: "editor";
  openPaths: string[];
  activePath: string | null;
}

export interface WorkspaceTerminalPaneContent {
  kind: "terminal";
  terminalIds: string[];
  activeTerminalId: string | null;
}

export interface WorkspaceBrowserPaneContent {
  kind: "browser";
  url: string;
}

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeNode[];
}

export interface NoteDocument {
  filePath: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  kind: DocumentKind;
}

export interface WikilinkReference {
  label: string;
  target: string;
}

export interface MarkdownLinkReference {
  label: string;
  target: string;
}

export interface TagReference {
  tag: string;
}

export interface BacklinkReference {
  filePath: string;
  title: string;
}

export interface NoteKnowledge {
  wikilinks: WikilinkReference[];
  markdownLinks: MarkdownLinkReference[];
  tags: TagReference[];
  backlinks: BacklinkReference[];
}

export interface SearchResult {
  filePath: string;
  title: string;
  snippet: string;
  kind: "note" | "project-file" | "tag";
}

export interface SemanticSearchResult {
  filePath: string;
  title: string;
  snippet: string;
  score: number;
  docid: string;
}

export type IndexedRootKind = "notes" | "docs" | "code" | "mixed";
export type IndexMode = "off" | "lexical" | "semantic" | "hybrid";
export type IndexBackend = "qmd";
export type IndexUpdateStrategy = "manual" | "on-save";
export type TerminalHistoryMode = "full" | "custom";
export type TerminalTranscriptRetention = "forever" | "days";

export interface IndexedRoot {
  id: string;
  label: string;
  path: string;
  kind: IndexedRootKind;
  pattern: string;
  ignore: string[];
  backend: IndexBackend;
}

export interface IndexingConfig {
  enabled: boolean;
  mode: IndexMode;
  backend: IndexBackend;
}

export interface IndexStatus {
  enabled: boolean;
  mode: IndexMode;
  backend: IndexBackend;
  dbPath: string;
  runtimePath: string;
  indexedRoots: IndexedRoot[];
  documentCount: number;
  pendingEmbeddings: number;
  hasVectorIndex: boolean;
  lastUpdated: string | null;
  warnings: string[];
  errors: string[];
  recentJobs?: IndexJobMetric[];
}

export interface IndexJobMetric {
  id: string;
  kind: "sync" | "update" | "embed";
  reason: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  documentCount?: number;
  pendingEmbeddings?: number;
  warnings?: string[];
  error?: string;
}

export interface IndexSyncPhase {
  name: "update" | "embed";
  status: "completed" | "skipped" | "failed";
  message: string;
}

export interface IndexSyncResult {
  status: IndexStatus;
  phases: IndexSyncPhase[];
  warnings: string[];
}

export interface IndexSearchResult {
  filePath: string;
  title: string;
  snippet: string;
  score: number;
  docid?: string;
  source: "qmd" | "filesystem";
  content?: string;
}

export interface IndexSearchResponse {
  query: string;
  mode: IndexMode;
  source: "qmd" | "filesystem";
  warnings: string[];
  results: IndexSearchResult[];
}

export interface IndexReadResponse {
  target: string;
  filePath: string;
  title: string;
  body: string;
  fromLine?: number;
  maxLines?: number;
  source: "qmd" | "filesystem";
}

export interface WorkspaceSearchResults {
  notes: SearchResult[];
  projectFiles: SearchResult[];
  tags: SearchResult[];
  semantic?: SemanticSearchResult[];
}

export interface BranchEntry {
  filePath: string;
  relativePath: string;
  title: string;
  path: number[];
  isRoot: boolean;
}

export interface BranchFamily {
  baseName: string;
  rootFilePath: string;
  currentFilePath: string;
  currentPath: number[];
  members: BranchEntry[];
  tree: string;
}

export interface BranchCreateResult {
  branchFilePath: string;
  family: BranchFamily;
}

export interface RuntimeInstructionPaths {
  primary: string;
  claude: string;
}

export interface RetrievalBackendConfig {
  kind: "qmd";
  enabled: boolean;
  command: string;
}

export interface AgentCommunicationConfig {
  kind: "file-sqlite";
  messagesDirectory: string;
  sqlitePath: string;
}

export interface AgentLauncherConfig {
  kind: ManagedAgentKind;
  title: string;
  command: string;
  args: string[];
}

export interface AgentHarnessInstallMetadata {
  url?: string;
  label?: string;
}

export interface AgentHarnessDetection {
  id: ManagedAgentKind;
  adapterId: AgentHarnessAdapterId;
  family: AgentHarnessAdapterId;
  label: string;
  productName: string;
  enabled: boolean;
  configured: boolean;
  detected: boolean;
  launchable: boolean;
  status: AgentHarnessStatus;
  statusLabel: string;
  executablePath?: string;
  repoPath?: string;
  channel?: string;
  build?: string;
  install?: AgentHarnessInstallMetadata;
  detail?: string;
  launcher?: AgentLauncherConfig;
}

export interface RuntimeConfig {
  workspace: WorkspaceModel;
  runtimeRoot: string;
  instructions: RuntimeInstructionPaths;
  retrieval: RetrievalBackendConfig;
  communication: AgentCommunicationConfig;
  launchers: Record<ManagedAgentKind, AgentLauncherConfig>;
  harnesses: AgentHarnessDetection[];
}

export interface AgentLaunchPlan {
  kind: ManagedAgentKind;
  title: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  primaryInstructionsPath: string;
  secondaryInstructionsPath?: string;
}
