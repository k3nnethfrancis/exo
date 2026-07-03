import type { CapabilityMetadata, CapabilitySurface } from "./capabilities";
import type { DiscoveredPlugin } from "./plugin";

export type GraphSnapshotVersion = "0.1";
export type GraphNodeKind = "note" | "tag" | "external" | "unresolved";
export type GraphEdgeKind = "wikilink" | "markdownLink" | "hasTag";
export type GraphEdgeResolution = "resolved" | "unresolved" | "external";
export type GraphVisualizationHostSurface = "editorPane" | "webPreview";
export type GraphVisualizationRenderMode = "2d" | "3d" | "custom";

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

export interface GraphVisualizationDataContract {
  snapshotVersion: GraphSnapshotVersion;
  acceptedNodeKinds: readonly GraphNodeKind[];
  acceptedEdgeKinds: readonly GraphEdgeKind[];
}

export interface GraphVisualizationSurfaceContribution {
  hostSurface: GraphVisualizationHostSurface;
  renderMode: GraphVisualizationRenderMode;
  preferredPlacement: "toolDock" | "editorGrid" | "webPreview";
}

export interface GraphVisualizationDefinition {
  id: string;
  label: string;
  description: string;
  data: GraphVisualizationDataContract;
  surface: GraphVisualizationSurfaceContribution;
  graphDataVersion: GraphSnapshotVersion;
  acceptedNodeKinds: readonly GraphNodeKind[];
  acceptedEdgeKinds: readonly GraphEdgeKind[];
  hostSurface: GraphVisualizationHostSurface;
  renderMode: GraphVisualizationRenderMode;
  preferredPlacement: GraphVisualizationSurfaceContribution["preferredPlacement"];
  sourceCapabilityId?: string;
  sourcePluginId?: string;
}

export interface GraphVisualizationFilter {
  includeDisabled?: boolean;
  surface?: CapabilitySurface;
}

export function graphVisualizationsFromPlugin(
  plugin: DiscoveredPlugin,
  filter: GraphVisualizationFilter = {},
): GraphVisualizationDefinition[] {
  if (filter.surface && !plugin.manifest.surfaces.includes(filter.surface)) {
    return [];
  }
  return plugin.manifest.capabilities.flatMap((capability) => {
    if (!matchesGraphVisualizationFilter(capability, filter)) {
      return [];
    }
    const graphView = graphVisualizationFromCapability(capability);
    if (!graphView) {
      return [];
    }
    return [
      {
        ...graphView,
        sourceCapabilityId: capability.id,
        sourcePluginId: plugin.manifest.id,
      },
    ];
  });
}

export function graphVisualizationFromCapability(capability: CapabilityMetadata): GraphVisualizationDefinition | null {
  if (capability.kind !== "exo.graph:visualization") {
    return null;
  }
  const payload = graphVisualizationPayload(capability);
  if (!isRecord(payload)) {
    throw new Error(`Graph visualization capability ${capability.id} must define compatibility.graphVisualization.`);
  }
  const graphDataVersion = validateGraphDataVersion(optionalString(payload, "graphDataVersion") ?? optionalString(payload, "snapshotVersion") ?? "0.1");
  const acceptedNodeKinds = validateNodeKinds(payload.acceptedNodeKinds);
  const acceptedEdgeKinds = validateEdgeKinds(payload.acceptedEdgeKinds);
  const hostSurface = validateHostSurface(optionalString(payload, "hostSurface") ?? "editorPane");
  const renderMode = validateRenderMode(optionalString(payload, "renderMode") ?? "2d");
  const preferredPlacement = validatePreferredPlacement(optionalString(payload, "preferredPlacement") ?? defaultPlacementForHostSurface(hostSurface));
  return {
    id: optionalString(payload, "id") ?? capability.id,
    label: optionalString(payload, "label") ?? capability.label,
    description: optionalString(payload, "description") ?? capability.description,
    data: {
      snapshotVersion: graphDataVersion,
      acceptedNodeKinds,
      acceptedEdgeKinds,
    },
    surface: {
      hostSurface,
      renderMode,
      preferredPlacement,
    },
    graphDataVersion,
    acceptedNodeKinds,
    acceptedEdgeKinds,
    hostSurface,
    renderMode,
    preferredPlacement,
    sourceCapabilityId: capability.id,
  };
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

function matchesGraphVisualizationFilter(capability: CapabilityMetadata, filter: GraphVisualizationFilter): boolean {
  if (capability.kind !== "exo.graph:visualization") {
    return false;
  }
  if (!filter.includeDisabled && capability.lifecycle === "disabled") {
    return false;
  }
  if (filter.surface && !capability.surfaces.includes(filter.surface)) {
    return false;
  }
  return true;
}

function validateGraphDataVersion(value: string): GraphSnapshotVersion {
  if (value !== "0.1") {
    throw new Error(`Graph visualization graphDataVersion is unsupported: ${value}`);
  }
  return value;
}

function validateNodeKinds(input: unknown): GraphNodeKind[] {
  if (input === undefined) {
    return [...GRAPH_NODE_KINDS];
  }
  if (!Array.isArray(input)) {
    throw new Error("Graph visualization acceptedNodeKinds must be an array.");
  }
  return input.map((value) => validateNodeKind(value));
}

function validateEdgeKinds(input: unknown): GraphEdgeKind[] {
  if (input === undefined) {
    return [...GRAPH_EDGE_KINDS];
  }
  if (!Array.isArray(input)) {
    throw new Error("Graph visualization acceptedEdgeKinds must be an array.");
  }
  return input.map((value) => validateEdgeKind(value));
}

function validateNodeKind(value: unknown): GraphNodeKind {
  switch (value) {
    case "note":
    case "tag":
    case "external":
    case "unresolved":
      return value;
    default:
      throw new Error(`Graph visualization acceptedNodeKinds contains unsupported value: ${String(value)}`);
  }
}

function validateEdgeKind(value: unknown): GraphEdgeKind {
  switch (value) {
    case "wikilink":
    case "markdownLink":
    case "hasTag":
      return value;
    default:
      throw new Error(`Graph visualization acceptedEdgeKinds contains unsupported value: ${String(value)}`);
  }
}

function validateHostSurface(value: string): GraphVisualizationHostSurface {
  if (value !== "editorPane" && value !== "webPreview") {
    throw new Error(`Graph visualization hostSurface is unsupported: ${value}`);
  }
  return value;
}

function validateRenderMode(value: string): GraphVisualizationRenderMode {
  if (value !== "2d" && value !== "3d" && value !== "custom") {
    throw new Error(`Graph visualization renderMode is unsupported: ${value}`);
  }
  return value;
}

function validatePreferredPlacement(value: string): GraphVisualizationSurfaceContribution["preferredPlacement"] {
  if (value !== "toolDock" && value !== "editorGrid" && value !== "webPreview") {
    throw new Error(`Graph visualization preferredPlacement is unsupported: ${value}`);
  }
  return value;
}

function defaultPlacementForHostSurface(hostSurface: GraphVisualizationHostSurface): GraphVisualizationSurfaceContribution["preferredPlacement"] {
  return hostSurface === "webPreview" ? "webPreview" : "editorGrid";
}

function graphVisualizationPayload(capability: CapabilityMetadata): unknown {
  const compatibility = capability.compatibility;
  if (!isRecord(compatibility)) {
    return undefined;
  }
  return compatibility.graphVisualization ?? compatibility;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Graph visualization field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
