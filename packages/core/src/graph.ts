export type GraphSnapshotVersion = "0.1";
export type GraphNodeKind = "note" | "tag" | "external" | "unresolved";
export type GraphEdgeKind = "wikilink" | "markdownLink" | "hasTag";
export type GraphEdgeResolution = "resolved" | "unresolved" | "external";

export const GRAPH_SNAPSHOT_VERSION: GraphSnapshotVersion = "0.1";
export const GRAPH_NODE_KINDS = ["note", "tag", "external", "unresolved"] satisfies GraphNodeKind[];
export const GRAPH_EDGE_KINDS = ["wikilink", "markdownLink", "hasTag"] satisfies GraphEdgeKind[];

export interface GraphScope {
  workspaceRoot?: string;
  noteRootIds: readonly string[];
  projectRootIds: readonly string[];
  paths: readonly string[];
}

export interface GraphSnapshotSchema {
  version: GraphSnapshotVersion;
  nodeKinds: readonly GraphNodeKind[];
  edgeKinds: readonly GraphEdgeKind[];
  canonicalEdgeDirection: "outgoing";
  backlinks: "derived";
}

export interface GraphSnapshot {
  version: GraphSnapshotVersion;
  snapshotId: string;
  generatedAt: string;
  schema: GraphSnapshotSchema;
  scope: GraphScope;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  warnings: readonly string[];
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  filePath?: string;
  rootId?: string;
  metadata: GraphNodeMetadata;
}

export interface GraphNodeMetadata {
  title?: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  directed: true;
  resolution: GraphEdgeResolution;
  metadata: GraphEdgeMetadata;
}

export interface GraphEdgeMetadata {
  label?: string;
  targetText?: string;
  sourceFilePath?: string;
}

export interface GraphBacklink {
  source: string;
  target: string;
  edgeId: string;
  kind: GraphEdgeKind;
  resolution: GraphEdgeResolution;
}

export function deriveGraphBacklinks(snapshot: GraphSnapshot): GraphBacklink[] {
  return snapshot.edges
    .map((edge) => ({
      source: edge.target,
      target: edge.source,
      edgeId: edge.id,
      kind: edge.kind,
      resolution: edge.resolution,
    }))
    .sort((left, right) => `${left.source}:${left.target}:${left.edgeId}`.localeCompare(`${right.source}:${right.target}:${right.edgeId}`));
}
