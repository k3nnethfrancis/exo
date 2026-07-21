import type { RendererGraphNeighborhood } from "./graphAffordances";
import {
  createGraphScene,
  planGraphLabels,
  selectGraphPath,
  type GraphSceneContract,
  type GraphTopologyArrays,
  type GraphViewport,
} from "./graphSceneFoundation";
import {
  GraphPresentationCompiler,
  type GraphPresentationPalette,
  type GraphPresentationPlan,
} from "./graphPresentation";

const MAXIMUM_NEIGHBORHOOD_NODES = 8;
// Mirrors core's numeric projection contract without importing the Node-backed
// core barrel into the renderer bundle.
const DOCUMENT_EDGE_VISUAL_CLASS = 0;
const ONTOLOGY_EDGE_VISUAL_CLASS = 1;

type NeighborhoodNode = RendererGraphNeighborhood["nodes"][number];
type NeighborhoodEdge = RendererGraphNeighborhood["edges"][number];

export interface ProjectedGraphNeighborhood {
  nodes: readonly NeighborhoodNode[];
  edges: readonly NeighborhoodEdge[];
  topology: GraphTopologyArrays;
  focusIndex: number;
}

export interface CompiledGraphNeighborhoodPresentation extends ProjectedGraphNeighborhood {
  scene: GraphSceneContract;
  plan: GraphPresentationPlan;
}

/**
 * Adapt the already-resolved, bounded Connections context into the same dense
 * numeric topology consumed by the production scene and renderers. Strings are
 * retained only as cold labels/navigation targets outside the hot arrays.
 */
export function projectGraphNeighborhoodTopology(
  neighborhood: RendererGraphNeighborhood,
  maximumNodes = MAXIMUM_NEIGHBORHOOD_NODES,
): ProjectedGraphNeighborhood {
  const limit = Math.max(1, Math.min(MAXIMUM_NEIGHBORHOOD_NODES, Math.floor(maximumNodes)));
  const uniqueNodes = [...new Map(
    neighborhood.nodes
      .filter((node) => node.kind !== "note" || node.target)
      .map((node) => [node.id, node] as const),
  ).values()];
  const focus = uniqueNodes.find((node) => node.target === neighborhood.focusPath) ?? null;
  const nodes = [
    ...(focus ? [focus] : []),
    ...uniqueNodes.filter((node) => node !== focus).sort(compareNeighborhoodNode),
  ].slice(0, limit);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = neighborhood.edges
    .filter((edge) => indexById.has(edge.source) && indexById.has(edge.target))
    .sort((left, right) => left.id.localeCompare(right.id));
  const identityKeys = new Uint32Array(nodes.length * 2);
  const seeds = new Uint32Array(nodes.length);
  const groups = new Uint32Array(nodes.length);
  const degrees = new Uint32Array(nodes.length);
  const nodeVisualClasses = new Uint8Array(nodes.length);
  const endpoints = new Uint32Array(edges.length * 2);
  const edgeVisualClasses = new Uint8Array(edges.length);
  const identity = nodes.map((node) => `${node.kind}:${node.id}`);
  const topologySource = `${neighborhood.focusPath}\n${identity.join("\n")}\n${edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}`).join("\n")}`;
  const topologyKey = hash32(topologySource);

  nodes.forEach((node, index) => {
    identityKeys[index * 2] = hash32(`low:${identity[index]}`);
    identityKeys[index * 2 + 1] = hash32(`high:${identity[index]}`);
    seeds[index] = hash32(`seed:${identity[index]}`);
    groups[index] = hash32(`group:${node.kind}`);
    nodeVisualClasses[index] = node.kind === "unresolved" ? 1 : node.kind === "external" ? 2 : 0;
  });
  edges.forEach((edge, index) => {
    const source = indexById.get(edge.source) ?? 0;
    const target = indexById.get(edge.target) ?? 0;
    endpoints[index * 2] = source;
    endpoints[index * 2 + 1] = target;
    degrees[source] += 1;
    degrees[target] += 1;
    // Preserve the cold relation origin even though endpoint meaning was
    // already resolved before the renderer received this bounded context.
    edgeVisualClasses[index] = edge.kind === "ontology"
      ? ONTOLOGY_EDGE_VISUAL_CLASS
      : DOCUMENT_EDGE_VISUAL_CLASS;
  });

  return {
    nodes,
    edges,
    focusIndex: focus ? 0 : nodes.length ? 0 : -1,
    topology: {
      topologyHash: `connections-${topologyKey.toString(16).padStart(8, "0")}`,
      layoutEpochId: `connections-layout-${hash32(`layout:${topologySource}`).toString(16).padStart(8, "0")}`,
      seed: hash32(`workspace-view:${topologySource}`),
      nodes: { identityKeys, seeds, groups, degrees, visualClasses: nodeVisualClasses },
      edges: { endpoints, visualClasses: edgeVisualClasses },
    },
  };
}

/** Compile a local rail thumbnail through the full production scene contract. */
export function compileGraphNeighborhoodPresentation(
  neighborhood: RendererGraphNeighborhood,
  viewport: GraphViewport,
  palette: GraphPresentationPalette,
  compiler = new GraphPresentationCompiler(),
): CompiledGraphNeighborhoodPresentation {
  const projected = projectGraphNeighborhoodTopology(neighborhood);
  let scene = createGraphScene(projected.topology, viewport);
  if (projected.focusIndex >= 0) {
    scene = {
      ...scene,
      interaction: selectGraphPath(projected.topology, projected.focusIndex, -1, -1),
    };
  }
  const labels = planGraphLabels(
    scene.topology,
    scene.projection,
    scene.interaction,
    projected.nodes.map((node, index) => ({
      index,
      text: node.label,
      width: Math.min(112, Math.max(24, node.label.length * 6.15)),
      height: 13,
    })),
    { maxLabels: projected.nodes.length, edgeInset: 6, collisionGap: 4 },
  );
  return {
    ...projected,
    scene,
    plan: compiler.compile(scene, labels, { palette, profile: "focus" }),
  };
}

function compareNeighborhoodNode(left: NeighborhoodNode, right: NeighborhoodNode): number {
  return left.id.localeCompare(right.id) || left.target.localeCompare(right.target);
}

/** Deterministic FNV-1a for renderer-local seeds and cache identities. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
