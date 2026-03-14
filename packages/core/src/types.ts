export type RootKind = "notes" | "projects";

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
}

