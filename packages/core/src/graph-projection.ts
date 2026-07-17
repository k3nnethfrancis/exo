import { createHash } from "node:crypto";

import type { ConceptNode, GraphFinding, KnowledgeGraphSnapshot, RelationEdge } from "./knowledge-graph";

export const GRAPH_PROJECTION_VERSION = "0.1" as const;
export const GRAPH_LAYOUT_VERSION = "finite-force-0.1" as const;

export interface GraphViewNode {
  id: string;
  label: string;
  path: string;
  group: string;
  kind: "concept" | "tag" | "unresolved" | "external";
  degree: number;
}

export interface GraphViewEdge {
  id: string;
  source: number;
  target: number;
  family: RelationEdge["family"];
  authority: RelationEdge["authority"];
  resolution: RelationEdge["resolution"];
  directed: boolean;
}

export interface GraphViewProjection {
  version: typeof GRAPH_PROJECTION_VERSION;
  layoutVersion: typeof GRAPH_LAYOUT_VERSION;
  sourceSnapshotId: string;
  seed: number;
  nodes: readonly GraphViewNode[];
  edges: readonly GraphViewEdge[];
  omitted: { tagConcepts: number; tagRelations: number };
}

export interface GraphViewBundle {
  projection: GraphViewProjection;
}

export interface GraphConceptDetail {
  concept: ConceptNode;
  findings: readonly GraphFinding[];
}

export function compileGraphView(snapshot: KnowledgeGraphSnapshot): GraphViewProjection {
  const tagConceptIds = new Set(snapshot.concepts.filter((concept) => concept.id.startsWith("tag:")).map((concept) => concept.id));
  const concepts = snapshot.concepts
    .filter((concept) => !tagConceptIds.has(concept.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const indexById = new Map(concepts.map((concept, index) => [concept.id, index]));
  const degree = new Uint32Array(concepts.length);
  const visibleRelations = snapshot.relations.filter((relation) => relation.family !== "tag-membership" && !tagConceptIds.has(relation.source) && !tagConceptIds.has(relation.target));
  const edges = [...visibleRelations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((relation) => {
      const source = indexById.get(relation.source);
      const target = indexById.get(relation.target);
      if (source === undefined || target === undefined || source === target) return [];
      degree[source] += 1;
      degree[target] += 1;
      return [{
        id: relation.id,
        source,
        target,
        family: relation.family,
        authority: relation.authority,
        resolution: relation.resolution,
        directed: relation.directed,
      }];
    });
  const nodes = concepts.map((concept, index) => ({
    id: concept.id,
    label: concept.label,
    path: concept.filePath ?? concept.relativePath ?? "",
    group: concept.conceptTypes[0]
      ?? graphGeography(concept.relativePath)
      ?? concept.tags[0]
      ?? concept.rootId
      ?? "notes",
    kind: concept.resolution === "external"
      ? "external" as const
      : concept.resolution === "unresolved"
        ? "unresolved" as const
        : concept.id.startsWith("tag:")
          ? "tag" as const
          : "concept" as const,
    degree: degree[index] ?? 0,
  }));
  return {
    version: GRAPH_PROJECTION_VERSION,
    layoutVersion: GRAPH_LAYOUT_VERSION,
    sourceSnapshotId: snapshot.snapshotId,
    seed: projectionSeed(snapshot),
    nodes,
    edges,
    omitted: {
      tagConcepts: tagConceptIds.size,
      tagRelations: snapshot.relations.length - visibleRelations.length,
    },
  };
}

function graphGeography(relativePath?: string): string | undefined {
  if (!relativePath) return undefined;
  const normalized = relativePath.replaceAll("\\", "/");
  const separator = normalized.indexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : "root";
}

function projectionSeed(snapshot: KnowledgeGraphSnapshot): number {
  // Content edits must not reseed the whole scene. The layout seed describes
  // the stable workspace/profile/view algorithm, not one generated snapshot.
  const identity = JSON.stringify({
    version: GRAPH_PROJECTION_VERSION,
    layoutVersion: GRAPH_LAYOUT_VERSION,
    roots: [...snapshot.scope.noteRootIds].sort(),
    profile: snapshot.activeProfile.id,
    profileVersion: snapshot.activeProfile.version,
  });
  return createHash("sha256").update(identity).digest().readUInt32LE(0);
}
