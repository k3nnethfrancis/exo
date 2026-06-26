import type { CapabilityMetadata, CapabilitySurface } from "./capabilities";
import type { DiscoveredPlugin } from "./plugin";

export type GraphSnapshotVersion = "0.1";
export type GraphNodeKind = "note" | "tag" | "external" | "unresolved";
export type GraphEdgeKind = "wikilink" | "markdownLink" | "hasTag";
export type GraphEdgeResolution = "resolved" | "unresolved" | "external";
export type GraphVisualizationHostSurface = "editorPane" | "webPreview";

export interface GraphScope {
  workspaceRoot?: string;
  noteRootIds: string[];
  projectRootIds: string[];
  paths: string[];
}

export interface GraphSnapshot {
  version: GraphSnapshotVersion;
  generatedAt: string;
  scope: GraphScope;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
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

export interface GraphVisualizationDefinition {
  id: string;
  label: string;
  description: string;
  graphDataVersion: GraphSnapshotVersion;
  acceptedNodeKinds: GraphNodeKind[];
  acceptedEdgeKinds: GraphEdgeKind[];
  hostSurface: GraphVisualizationHostSurface;
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
  if (capability.kind !== "graphVisualization") {
    return null;
  }
  const payload = capability.compatibility;
  if (!isRecord(payload)) {
    throw new Error(`Graph visualization capability ${capability.id} must define compatibility metadata.`);
  }
  return {
    id: optionalString(payload, "id") ?? capability.id,
    label: optionalString(payload, "label") ?? capability.label,
    description: optionalString(payload, "description") ?? capability.description,
    graphDataVersion: validateGraphDataVersion(optionalString(payload, "graphDataVersion") ?? "0.1"),
    acceptedNodeKinds: validateNodeKinds(payload.acceptedNodeKinds),
    acceptedEdgeKinds: validateEdgeKinds(payload.acceptedEdgeKinds),
    hostSurface: validateHostSurface(optionalString(payload, "hostSurface") ?? "editorPane"),
    sourceCapabilityId: capability.id,
  };
}

function matchesGraphVisualizationFilter(capability: CapabilityMetadata, filter: GraphVisualizationFilter): boolean {
  if (capability.kind !== "graphVisualization") {
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
    return ["note", "tag", "external", "unresolved"];
  }
  if (!Array.isArray(input)) {
    throw new Error("Graph visualization acceptedNodeKinds must be an array.");
  }
  return input.map((value) => validateNodeKind(value));
}

function validateEdgeKinds(input: unknown): GraphEdgeKind[] {
  if (input === undefined) {
    return ["wikilink", "markdownLink", "hasTag"];
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
