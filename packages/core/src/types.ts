import type { AgentCommand } from "./agent-invocation";

export type DocumentKind = "markdown" | "text";
export type ColorThemeId = "exo-neutral" | "exo-solar";

/** A user-authorized mutable Markdown root. */
export interface NoteRoot {
  id: string;
  label: string;
  path: string;
}

export interface WorkspaceModel {
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: NoteRoot[];
  indexedRoots: IndexedRoot[];
  indexing: IndexingConfig;
}

export interface WorkspaceSettings {
  /** Forward-compatible persisted settings are retained unless explicitly retired. */
  [key: string]: unknown;
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string[];
  agentCommands?: AgentCommand[];
  indexedRoots: IndexedRoot[];
  indexing: IndexingConfig;
  appearanceMode: "system" | "light" | "dark";
  colorThemeId: ColorThemeId;
  editorFontSize: number;
  terminalFontSize: number;
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

export type WorkspaceSettingsRevision = string | null;

export interface WorkspaceSettingsSnapshot {
  settings: WorkspaceSettings;
  revision: WorkspaceSettingsRevision;
}

export interface WorkspaceSettingsSaveRequest {
  settings: WorkspaceSettings;
  expectedRevision: WorkspaceSettingsRevision;
}

export type WorkspaceLayoutSettings = LegacyWorkspaceLayoutSettings | WorkspaceCanvasLayoutSettings;

/** Legacy two-zone layout retained only so existing user settings still load. */
export interface LegacyWorkspaceLayoutSettings {
  editorTree: WorkspacePaneNode;
  terminalTree: WorkspacePaneNode;
  terminalCollapsed: boolean;
  terminalMonitorMode: boolean;
  sidePanesFlipped: boolean;
  zoneSplitRatio: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  inspectorCollapsed: boolean;
}

/** The single-canvas layout written by the current renderer. */
export interface WorkspaceCanvasLayoutSettings {
  version: 2;
  canvas: WorkspacePaneNode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  utilityWidth: number;
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

export interface SearchResult {
  filePath: string;
  title: string;
  snippet: string;
  kind: "note" | "tag";
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
export type IndexBackend = "filesystem" | "qmd";
export type IndexUpdateStrategy = "manual" | "on-save";
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
  tags: SearchResult[];
  semantic?: SemanticSearchResult[];
}
