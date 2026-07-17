import { createHash } from "node:crypto";

export const KNOWLEDGE_GRAPH_VERSION = "0.2" as const;

export type KnowledgeGraphVersion = typeof KNOWLEDGE_GRAPH_VERSION;
export type GraphPropertyValue = null | boolean | number | string | readonly GraphPropertyValue[] | GraphPropertyObject;
export interface GraphPropertyObject { readonly [key: string]: GraphPropertyValue }

export type ConceptResolution = "resolved" | "unresolved" | "external";
export type RelationAuthority = "authored" | "declared" | "derived";
export type RelationResolution = "resolved" | "unresolved" | "ambiguous" | "external";
export type RelationFamily = "link" | "property-reference" | "tag-membership" | "hierarchy" | "semantic";

export interface GraphProducer {
  id: string;
  version: string;
}

export interface GraphSourceRange {
  /** Body-relative UTF-16 code-unit offset, inclusive. */
  from: number;
  /** Body-relative UTF-16 code-unit offset, exclusive. */
  to: number;
}

export interface RelationEvidence {
  kind: "source-span" | "property" | "path" | "profile-rule" | "model";
  noteId?: string;
  property?: string;
  sourceRange?: GraphSourceRange;
  producer?: GraphProducer;
  detail?: string;
}

export interface ConceptNode {
  id: string;
  noteId?: string;
  label: string;
  conceptTypes: readonly string[];
  properties: Readonly<Record<string, GraphPropertyValue>>;
  resolution: ConceptResolution;
  filePath?: string;
  rootId?: string;
  relativePath?: string;
  tags: readonly string[];
}

export interface RelationEdge {
  id: string;
  source: string;
  target: string;
  family: RelationFamily;
  predicate?: string;
  authority: RelationAuthority;
  resolution: RelationResolution;
  directed: boolean;
  confidence?: number;
  evidence: readonly RelationEvidence[];
  label?: string;
}

export interface KnowledgeGraphScope {
  workspaceRoot?: string;
  noteRootIds: readonly string[];
  paths: readonly string[];
}

export interface KnowledgeGraphSnapshot {
  version: KnowledgeGraphVersion;
  snapshotId: string;
  generatedAt: string;
  scope: KnowledgeGraphScope;
  concepts: readonly ConceptNode[];
  relations: readonly RelationEdge[];
  findings: readonly GraphFinding[];
  activeProfile: KnowledgeProfileStatus;
}

export interface GraphFinding {
  id: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  conceptIds: readonly string[];
  relationIds: readonly string[];
  evidence: readonly RelationEvidence[];
}

export interface KnowledgeProfileStatus {
  id: string;
  version: string;
  label: string;
  source: "built-in" | "workspace";
  state: "active" | "fallback";
}

export function graphPropertyRecord(value: Record<string, unknown>): Record<string, GraphPropertyValue> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, graphPropertyValue(item)]),
  );
}

export function graphPropertyValue(value: unknown): GraphPropertyValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(graphPropertyValue);
  if (value && typeof value === "object") return graphPropertyRecord(value as Record<string, unknown>);
  // YAML cannot faithfully express undefined, bigint, symbols, or functions.
  // Preserve their visible value rather than silently deleting the property.
  return String(value);
}

export function knowledgeGraphSnapshotId(
  scope: KnowledgeGraphScope,
  concepts: readonly ConceptNode[],
  relations: readonly RelationEdge[],
  profile: KnowledgeProfileStatus,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ version: KNOWLEDGE_GRAPH_VERSION, scope, concepts, relations, profile }))
    .digest("hex")
    .slice(0, 16);
  return `knowledge-graph:${KNOWLEDGE_GRAPH_VERSION}:${digest}`;
}
