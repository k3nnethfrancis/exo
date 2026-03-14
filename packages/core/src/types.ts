export type RootKind = "notes" | "projects";
export type DocumentKind = "markdown" | "text";
export type ManagedAgentKind = "shell" | "claude" | "codex";

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
  attachedWorkcells: string[];
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

export interface WorkspaceSearchResults {
  notes: SearchResult[];
  projectFiles: SearchResult[];
  tags: SearchResult[];
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

export interface RuntimeConfig {
  workspace: WorkspaceModel;
  runtimeRoot: string;
  instructions: RuntimeInstructionPaths;
  retrieval: RetrievalBackendConfig;
  communication: AgentCommunicationConfig;
  launchers: Record<ManagedAgentKind, AgentLauncherConfig>;
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
