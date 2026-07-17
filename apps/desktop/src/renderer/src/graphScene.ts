import type { GraphViewProjection } from "@exo/core";

export interface GraphCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export interface ProjectedGraphNode {
  index: number;
  x: number;
  y: number;
  depth: number;
  scale: number;
  visible: boolean;
}

export interface GraphPathResult {
  status: "idle" | "same" | "found" | "unreachable";
  nodes: Set<number>;
  edgeIds: Set<string>;
}

export const DEFAULT_GRAPH_CAMERA: GraphCamera = {
  yaw: -0.42,
  pitch: 0.24,
  distance: 760,
  target: [0, 0, 0],
};

export function seededGraphPositions(projection: GraphViewProjection): Float32Array {
  const positions = new Float32Array(projection.nodes.length * 3);
  const groups = [...new Set(projection.nodes.map((node) => node.group))].sort();
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const anchorRadius = Math.max(80, Math.sqrt(projection.nodes.length) * 18);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const anchors = groups.map((_, index) => {
    const y = groups.length === 1 ? 0 : 1 - (index / Math.max(1, groups.length - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    return [Math.cos(angle) * ring * anchorRadius, y * anchorRadius * 0.72, Math.sin(angle) * ring * anchorRadius] as const;
  });
  projection.nodes.forEach((node, index) => {
    const seed = hash32(`${projection.seed}:${node.id}`);
    const theta = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
    const z = (((seed >>> 16) & 0xffff) / 0xffff) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = 20 + (hash32(`${node.id}:radius`) / 0xffffffff) * 58;
    const anchor = anchors[groupIndex.get(node.group) ?? 0] ?? [0, 0, 0];
    positions[index * 3] = anchor[0] + Math.cos(theta) * radial * radius;
    positions[index * 3 + 1] = anchor[1] + z * radius;
    positions[index * 3 + 2] = anchor[2] + Math.sin(theta) * radial * radius;
  });
  return positions;
}

export function projectGraphPositions(
  positions: Float32Array,
  camera: GraphCamera,
  width: number,
  height: number,
): ProjectedGraphNode[] {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const focal = Math.min(width, height) * 0.96;
  const projected: ProjectedGraphNode[] = [];
  for (let index = 0; index < positions.length / 3; index += 1) {
    const x0 = positions[index * 3] - camera.target[0];
    const y0 = positions[index * 3 + 1] - camera.target[1];
    const z0 = positions[index * 3 + 2] - camera.target[2];
    const x1 = x0 * cosYaw - z0 * sinYaw;
    const z1 = x0 * sinYaw + z0 * cosYaw;
    const y1 = y0 * cosPitch - z1 * sinPitch;
    const z2 = y0 * sinPitch + z1 * cosPitch;
    const depth = camera.distance + z2;
    const scale = depth > 1 ? focal / depth : 0;
    const x = width * 0.5 + x1 * scale;
    const y = height * 0.5 + y1 * scale;
    projected.push({ index, x, y, depth, scale, visible: depth > 8 && x > -40 && x < width + 40 && y > -40 && y < height + 40 });
  }
  return projected;
}

export function pickGraphNode(nodes: readonly ProjectedGraphNode[], x: number, y: number, padding = 12): number {
  let winner = -1;
  let best = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (!node.visible) continue;
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance <= padding && distance < best) {
      winner = node.index;
      best = distance;
    }
  }
  return winner;
}

export function shortestGraphPath(projection: GraphViewProjection, source: number, target: number): GraphPathResult {
  if (source < 0 || target < 0) return { status: "idle", nodes: new Set(), edgeIds: new Set() };
  if (source === target) return { status: "same", nodes: new Set([source]), edgeIds: new Set() };
  const adjacency = projection.nodes.map(() => [] as Array<{ node: number; edgeId: string }>);
  for (const edge of projection.edges) {
    adjacency[edge.source]?.push({ node: edge.target, edgeId: edge.id });
    adjacency[edge.target]?.push({ node: edge.source, edgeId: edge.id });
  }
  const previous = new Int32Array(projection.nodes.length).fill(-1);
  const previousEdge = new Array<string | undefined>(projection.nodes.length);
  const queue = new Int32Array(projection.nodes.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = source;
  previous[source] = source;
  while (head < tail && previous[target] < 0) {
    const current = queue[head++];
    for (const next of adjacency[current] ?? []) {
      if (previous[next.node] >= 0) continue;
      previous[next.node] = current;
      previousEdge[next.node] = next.edgeId;
      queue[tail++] = next.node;
    }
  }
  if (previous[target] < 0) return { status: "unreachable", nodes: new Set(), edgeIds: new Set() };
  const nodes = new Set<number>();
  const edgeIds = new Set<string>();
  for (let current = target; current !== source; current = previous[current]) {
    nodes.add(current);
    const edgeId = previousEdge[current];
    if (edgeId) edgeIds.add(edgeId);
  }
  nodes.add(source);
  return { status: "found", nodes, edgeIds };
}

export function graphNeighbors(projection: GraphViewProjection, index: number): Set<number> {
  const neighbors = new Set<number>();
  for (const edge of projection.edges) {
    if (edge.source === index) neighbors.add(edge.target);
    if (edge.target === index) neighbors.add(edge.source);
  }
  return neighbors;
}

export function frameGraphCamera(positions: Float32Array): GraphCamera {
  if (positions.length === 0) return { ...DEFAULT_GRAPH_CAMERA, target: [...DEFAULT_GRAPH_CAMERA.target] };
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]); maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]); maxY = Math.max(maxY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]); maxZ = Math.max(maxZ, positions[index + 2]);
  }
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 120);
  return {
    ...DEFAULT_GRAPH_CAMERA,
    distance: Math.max(260, radius * 2.15),
    target: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

export function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
