import type { EditorState } from "@codemirror/state";
import type { GraphEdge, GraphNode, GraphSnapshot, NoteDocument, NoteKnowledge, TreeNode, WorkspaceModel } from "@exo/core";

import type { MarkdownGraphReferences } from "./components/markdownLivePreview";

export const WIKILINK_COMPLETION_LIMIT = 3;

export interface WikilinkSuggestion {
  label: string;
  target: string;
  detail?: string;
}

export interface WikilinkCompletionContext {
  from: number;
  to: number;
  query: string;
}

export interface RendererGraphLink {
  label: string;
  target: string;
  kind: GraphEdge["kind"];
  resolution: GraphEdge["resolution"];
  nodeKind: GraphNode["kind"];
}

export interface RendererGraphBacklink {
  label: string;
  target: string;
}

export interface RendererGraphNeighborhood {
  nodes: Array<{ id: string; label: string; kind: GraphNode["kind"]; target: string }>;
  edges: Array<{ id: string; label: string; source: string; target: string; kind: GraphEdge["kind"] }>;
}

export interface RendererNoteGraphContext {
  snapshot: GraphSnapshot;
  note: GraphNode;
  outgoingLinks: RendererGraphLink[];
  backlinks: RendererGraphBacklink[];
  tags: string[];
  properties: Record<string, unknown>;
  unresolvedLinks: RendererGraphLink[];
  externalLinks: RendererGraphLink[];
  neighborhood: RendererGraphNeighborhood;
}

export function getWikilinkCompletionContext(state: EditorState, pos: number): WikilinkCompletionContext | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const open = line.text.lastIndexOf("[[", Math.max(0, offset - 1));
  if (open < 0) {
    return null;
  }
  if (offset < open + 2) {
    return null;
  }

  const close = line.text.indexOf("]]", open + 2);
  if (close !== -1 && offset > close) {
    return null;
  }

  const queryEnd = close === -1 ? offset : close;
  const query = line.text.slice(open + 2, queryEnd);
  if (!query.trim() || /[\[\]\n]/.test(query)) {
    return null;
  }

  return {
    from: line.from + open,
    to: line.from + (close === -1 ? offset : close + 2),
    query,
  };
}

export function wikilinkSuggestionEdit(
  active: WikilinkCompletionContext,
  suggestion: WikilinkSuggestion,
): { insert: string; selection: number } {
  const insert = `[[${suggestion.target}]]`;
  return {
    insert,
    selection: active.from + insert.length,
  };
}

export function buildNoteGraphContext(
  document: Pick<NoteDocument, "filePath" | "title" | "frontmatter" | "kind"> | null,
  knowledge: NoteKnowledge | null,
): RendererNoteGraphContext | null {
  if (!document || document.kind !== "markdown" || !knowledge) {
    return null;
  }

  const note = noteNode(document.filePath, document.title, document.frontmatter, knowledge.tags.map((item) => item.tag));
  const nodesById = new Map<string, GraphNode>([[note.id, note]]);
  const edges: GraphEdge[] = [];

  knowledge.wikilinks.forEach((item, index) => {
    const target = unresolvedNode(item.label, `wikilink:${item.target}`);
    nodesById.set(target.id, target);
    edges.push(graphEdge("wikilink", note.id, target.id, "unresolved", index, { targetText: item.target }));
  });

  knowledge.markdownLinks.forEach((item, index) => {
    const isExternal = item.target.startsWith("http");
    const target = isExternal ? externalNode(item.target) : unresolvedNode(item.label, `markdown:${item.target}`);
    nodesById.set(target.id, target);
    edges.push(graphEdge("markdownLink", note.id, target.id, isExternal ? "external" : "unresolved", index, {
      label: item.label,
      targetText: item.target,
    }));
  });

  knowledge.tags.forEach((item, index) => {
    const target = tagNode(item.tag);
    nodesById.set(target.id, target);
    edges.push(graphEdge("hasTag", note.id, target.id, "resolved", index, { targetText: item.tag }));
  });

  knowledge.backlinks.forEach((item, index) => {
    const source = noteNode(item.filePath, item.title, {}, []);
    nodesById.set(source.id, source);
    edges.push(graphEdge("wikilink", source.id, note.id, "resolved", index, { targetText: document.title, sourceFilePath: item.filePath }));
  });

  const snapshot: GraphSnapshot = {
    version: "0.1",
    snapshotId: `renderer-note:${note.id}`,
    generatedAt: "",
    schema: {
      version: "0.1",
      nodeKinds: ["note", "tag", "external", "unresolved"],
      edgeKinds: ["wikilink", "markdownLink", "hasTag"],
      canonicalEdgeDirection: "outgoing",
      backlinks: "derived",
    },
    scope: {
      noteRootIds: [],
      projectRootIds: [],
      paths: [document.filePath],
    },
    nodes: Array.from(nodesById.values()).sort(compareById),
    edges: edges.sort(compareById),
    warnings: [],
  };

  const outgoingLinks = snapshot.edges
    .filter((edge) => edge.source === note.id && (edge.kind === "wikilink" || edge.kind === "markdownLink"))
    .map((edge) => linkFromEdge(edge, nodesById))
    .filter((item): item is RendererGraphLink => Boolean(item));
  const backlinks = snapshot.edges
    .filter((edge) => edge.target === note.id && (edge.kind === "wikilink" || edge.kind === "markdownLink"))
    .map((edge) => backlinkFromEdge(edge, nodesById))
    .filter((item): item is RendererGraphBacklink => Boolean(item));

  return {
    snapshot,
    note,
    outgoingLinks,
    backlinks,
    tags: [...knowledge.tags.map((item) => item.tag)].sort(),
    properties: document.frontmatter,
    unresolvedLinks: outgoingLinks.filter((item) => item.resolution === "unresolved"),
    externalLinks: outgoingLinks.filter((item) => item.resolution === "external"),
    neighborhood: {
      nodes: snapshot.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        target: node.filePath ?? node.metadata.title ?? node.label,
      })),
      edges: snapshot.edges.map((edge) => ({
        id: edge.id,
        label: edge.metadata.label ?? edge.metadata.targetText ?? edge.kind,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
      })),
    },
  };
}

export function buildGraphReferences(graphContext: RendererNoteGraphContext | null): MarkdownGraphReferences | null {
  if (!graphContext) {
    return null;
  }
  return {
    backlinks: graphContext.backlinks.map((item) => ({ label: item.label, target: item.target })),
    references: graphContext.outgoingLinks
      .filter((item) => item.resolution !== "external")
      .map((item) => ({ label: item.label, target: item.target })),
  };
}

export function graphReferencesForMarkdownMode(
  useMarkdownEditing: boolean,
  rawMarkdownMode: boolean,
  graphContext: RendererNoteGraphContext | null,
): MarkdownGraphReferences | null {
  if (!useMarkdownEditing || rawMarkdownMode) {
    return null;
  }
  return buildGraphReferences(graphContext);
}

export function suggestWikilinkTargetsFromTrees(
  model: WorkspaceModel | null,
  noteTrees: Record<string, TreeNode[]>,
  query: string,
  limit = WIKILINK_COMPLETION_LIMIT,
): WikilinkSuggestion[] {
  const trimmedQuery = query.trim().toLowerCase();
  if (!model || !trimmedQuery) {
    return [];
  }

  const candidates = model.noteRoots.flatMap((root) =>
    flattenMarkdownNodes(noteTrees[root.path] ?? []).map((node) => {
      const relativePath = relativePathWithin(root.path, node.path);
      const target = relativePath.replace(/\.md$/i, "");
      const label = basenameWithoutExtension(node.name || node.path);
      return {
        label,
        target,
        detail: target,
      };
    }),
  );

  return candidates
    .filter((candidate) => `${candidate.label}\n${candidate.target}`.toLowerCase().includes(trimmedQuery))
    .sort((left, right) => compareWikilinkSuggestions(left, right, trimmedQuery))
    .slice(0, limit);
}

export function getPreviewTitle(filePath: string): string {
  const basename = filePath.split("/").pop() ?? filePath;
  return basename.replace(/\.[^.]+$/, "");
}

export function markdownPreviewExcerpt(markdownBody: string): string {
  const excerpt = markdownBody
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, "$2")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[>\-*+\d.)\s]+/gmu, "")
    .replace(/[*_~>#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return excerpt.length > 180 ? `${excerpt.slice(0, 177).trimEnd()}...` : excerpt || "Empty note";
}

function flattenMarkdownNodes(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file" && /\.md(?:own)?$/i.test(node.path)) {
      out.push(node);
    }
    if (node.kind === "directory" && node.children) {
      out.push(...flattenMarkdownNodes(node.children));
    }
  }
  return out;
}

function compareWikilinkSuggestions(left: WikilinkSuggestion, right: WikilinkSuggestion, query: string): number {
  const leftTarget = left.target.toLowerCase();
  const rightTarget = right.target.toLowerCase();
  const leftLabel = left.label.toLowerCase();
  const rightLabel = right.label.toLowerCase();
  const leftExact = leftLabel === query || leftTarget === query;
  const rightExact = rightLabel === query || rightTarget === query;
  if (leftExact !== rightExact) {
    return leftExact ? -1 : 1;
  }
  const leftPrefix = leftLabel.startsWith(query) || leftTarget.startsWith(query);
  const rightPrefix = rightLabel.startsWith(query) || rightTarget.startsWith(query);
  if (leftPrefix !== rightPrefix) {
    return leftPrefix ? -1 : 1;
  }
  return left.target.localeCompare(right.target);
}

function relativePathWithin(rootPath: string, filePath: string): string {
  const normalizedRoot = rootPath.replace(/\/$/, "");
  return filePath === normalizedRoot ? "" : filePath.slice(normalizedRoot.length + 1);
}

function basenameWithoutExtension(filePath: string): string {
  const basename = filePath.split("/").pop() ?? filePath;
  return basename.replace(/\.[^.]+$/, "");
}

function noteNode(filePath: string, title: string, frontmatter: Record<string, unknown>, tags: string[]): GraphNode {
  return {
    id: noteId(filePath),
    kind: "note",
    label: title,
    filePath,
    metadata: {
      title,
      tags,
      frontmatter,
    },
  };
}

function tagNode(tag: string): GraphNode {
  return {
    id: `tag:${tag}`,
    kind: "tag",
    label: `#${tag}`,
    metadata: { title: tag },
  };
}

function externalNode(target: string): GraphNode {
  return {
    id: `external:${target}`,
    kind: "external",
    label: target,
    metadata: { title: target },
  };
}

function unresolvedNode(label: string, stableTarget: string): GraphNode {
  return {
    id: `unresolved:${encodeURIComponent(stableTarget)}`,
    kind: "unresolved",
    label,
    metadata: { title: label },
  };
}

function graphEdge(
  kind: GraphEdge["kind"],
  source: string,
  target: string,
  resolution: GraphEdge["resolution"],
  index: number,
  metadata: GraphEdge["metadata"],
): GraphEdge {
  return {
    id: `${source}->${target}#${kind}:${index}`,
    kind,
    source,
    target,
    directed: true,
    resolution,
    metadata,
  };
}

function linkFromEdge(edge: GraphEdge, nodesById: Map<string, GraphNode>): RendererGraphLink | null {
  const node = nodesById.get(edge.target);
  if (!node) {
    return null;
  }
  return {
    label: edge.metadata.label ?? node.label,
    target: node.filePath ?? edge.metadata.targetText ?? node.label,
    kind: edge.kind,
    resolution: edge.resolution,
    nodeKind: node.kind,
  };
}

function backlinkFromEdge(edge: GraphEdge, nodesById: Map<string, GraphNode>): RendererGraphBacklink | null {
  const node = nodesById.get(edge.source);
  return node ? { label: node.label, target: node.filePath ?? node.label } : null;
}

function noteId(filePath: string): string {
  return `note:${filePath}`;
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
