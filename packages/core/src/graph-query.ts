import path from "node:path";

import type { GraphEdge, GraphNode, GraphSnapshot } from "./graph";

export interface GraphNoteReference {
  id?: string;
  filePath?: string;
}

export interface GraphLinkContext {
  edge: GraphEdge;
  node: GraphNode;
}

export interface GraphBacklinkContext {
  edge: GraphEdge;
  sourceNode: GraphNode;
}

export interface NoteGraphContext {
  note: GraphNode;
  outgoingLinks: readonly GraphLinkContext[];
  backlinks: readonly GraphBacklinkContext[];
  tags: readonly string[];
  properties: Record<string, unknown>;
  frontmatter: Record<string, unknown>;
  unresolvedLinks: readonly GraphLinkContext[];
  externalLinks: readonly GraphLinkContext[];
}

export interface GraphNeighborhoodOptions {
  depth?: number;
  includeTags?: boolean;
  includeUnresolved?: boolean;
  includeExternal?: boolean;
}

export interface GraphNeighborhood {
  center: GraphNode;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

const NOTE_LINK_EDGE_KINDS = new Set<GraphEdge["kind"]>(["wikilink", "markdownLink"]);

export function findGraphNote(snapshot: GraphSnapshot, reference: string | GraphNoteReference): GraphNode | null {
  const normalized = normalizeReference(reference);
  if (!normalized) {
    return null;
  }
  const nodes = sortedNodes(snapshot.nodes).filter((node) => node.kind === "note");
  return nodes.find((node) => node.id === normalized.id || node.filePath === normalized.filePath) ?? null;
}

export function getNoteGraphContext(
  snapshot: GraphSnapshot,
  reference: string | GraphNoteReference,
): NoteGraphContext | null {
  const note = findGraphNote(snapshot, reference);
  if (!note) {
    return null;
  }

  const nodesById = nodeIndex(snapshot);
  const outgoingLinks = sortedEdges(snapshot.edges)
    .filter((edge) => edge.source === note.id && NOTE_LINK_EDGE_KINDS.has(edge.kind))
    .map((edge) => linkContext(edge, nodesById))
    .filter((context): context is GraphLinkContext => context !== null);
  const backlinks = sortedEdges(snapshot.edges)
    .filter((edge) => edge.target === note.id && NOTE_LINK_EDGE_KINDS.has(edge.kind))
    .map((edge) => backlinkContext(edge, nodesById))
    .filter((context): context is GraphBacklinkContext => context !== null);
  const frontmatter = note.metadata.frontmatter ?? {};

  return {
    note,
    outgoingLinks,
    backlinks,
    tags: [...(note.metadata.tags ?? [])].sort(),
    properties: frontmatter,
    frontmatter,
    unresolvedLinks: outgoingLinks.filter((link) => link.edge.resolution === "unresolved"),
    externalLinks: outgoingLinks.filter((link) => link.edge.resolution === "external"),
  };
}

export function getGraphBacklinks(
  snapshot: GraphSnapshot,
  reference: string | GraphNoteReference,
): GraphBacklinkContext[] {
  return [...(getNoteGraphContext(snapshot, reference)?.backlinks ?? [])];
}

export function getGraphNeighborhood(
  snapshot: GraphSnapshot,
  reference: string | GraphNoteReference,
  options: GraphNeighborhoodOptions = {},
): GraphNeighborhood | null {
  const center = findGraphNote(snapshot, reference);
  if (!center) {
    return null;
  }

  const maxDepth = Math.max(0, Math.trunc(options.depth ?? 1));
  const nodesById = nodeIndex(snapshot);
  const includedNodeIds = new Set<string>([center.id]);
  const includedEdgeIds = new Set<string>();
  let frontier = new Set<string>([center.id]);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth += 1) {
    const nextFrontier = new Set<string>();
    for (const edge of sortedEdges(snapshot.edges)) {
      if (!frontier.has(edge.source) && !frontier.has(edge.target)) {
        continue;
      }
      if (!includeNeighborhoodEdge(edge, options, nodesById)) {
        continue;
      }
      includedEdgeIds.add(edge.id);
      for (const nodeId of [edge.source, edge.target]) {
        if (!includedNodeIds.has(nodeId)) {
          includedNodeIds.add(nodeId);
          nextFrontier.add(nodeId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    center,
    nodes: sortedNodes(Array.from(includedNodeIds).map((id) => nodesById.get(id)).filter((node): node is GraphNode => Boolean(node))),
    edges: sortedEdges(snapshot.edges.filter((edge) => includedEdgeIds.has(edge.id))),
  };
}

function normalizeReference(reference: string | GraphNoteReference): Required<GraphNoteReference> | null {
  const value = typeof reference === "string" ? { id: reference, filePath: reference } : reference;
  const id = value.id?.startsWith("note:") ? value.id : value.filePath ? noteNodeId(value.filePath) : undefined;
  const filePath = value.filePath ? path.resolve(value.filePath) : value.id?.startsWith("note:") ? value.id.slice("note:".length) : undefined;
  if (!id && !filePath) {
    return null;
  }
  return { id: id ?? noteNodeId(filePath ?? ""), filePath: filePath ?? id?.slice("note:".length) ?? "" };
}

function linkContext(edge: GraphEdge, nodesById: Map<string, GraphNode>): GraphLinkContext | null {
  const node = nodesById.get(edge.target);
  return node ? { edge, node } : null;
}

function backlinkContext(edge: GraphEdge, nodesById: Map<string, GraphNode>): GraphBacklinkContext | null {
  const sourceNode = nodesById.get(edge.source);
  return sourceNode ? { edge, sourceNode } : null;
}

function includeNeighborhoodEdge(
  edge: GraphEdge,
  options: GraphNeighborhoodOptions,
  nodesById: Map<string, GraphNode>,
): boolean {
  if (edge.kind === "hasTag" && options.includeTags === false) {
    return false;
  }
  const otherNodes = [nodesById.get(edge.source), nodesById.get(edge.target)];
  if (!options.includeUnresolved && otherNodes.some((node) => node?.kind === "unresolved")) {
    return false;
  }
  if (!options.includeExternal && otherNodes.some((node) => node?.kind === "external")) {
    return false;
  }
  return true;
}

function nodeIndex(snapshot: GraphSnapshot): Map<string, GraphNode> {
  return new Map(snapshot.nodes.map((node) => [node.id, node]));
}

function noteNodeId(filePath: string): string {
  return `note:${path.resolve(filePath)}`;
}

function sortedNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort(compareById);
}

function sortedEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...edges].sort(compareById);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
