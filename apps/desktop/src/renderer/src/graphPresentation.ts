import {
  graphNodeScreenRadius,
  type GraphLabelPlan,
  type GraphSceneContract,
  type GraphViewport,
} from "./graphSceneFoundation";

export const GRAPH_PRESENTATION_VERSION = "0.1" as const;

export const GraphPresentationEmphasis = {
  selected: 1 << 0,
  path: 1 << 1,
  hovered: 1 << 2,
  pathTarget: 1 << 3,
} as const;

export type GraphPresentationProfileName = "overview" | "exploration" | "focus";

interface GraphPresentationProfile {
  name: GraphPresentationProfileName;
  radiusScale: number;
  minimumRadius: number;
  maximumRadius: number;
  edgeWidthScale: number;
  baseNodeOpacity: number;
  quietNodeOpacity: number;
  baseEdgeOpacity: number;
  quietEdgeOpacity: number;
}

/** Resolved theme tokens. Integration derives these from Exo's CSS variables. */
export interface GraphPresentationPalette {
  /** Null keeps Canvas transparent over the owning Exo surface. */
  clearColor: number | null;
  text: number;
  muted: number;
  accent: number;
  path: number;
  unresolved: number;
  external: number;
  nodeColors: Uint32Array;
}

const GRAPH_PRESENTATION_PROFILES: Readonly<Record<GraphPresentationProfileName, GraphPresentationProfile>> = {
  overview: {
    name: "overview",
    radiusScale: 0.82,
    minimumRadius: 2.4,
    maximumRadius: 16,
    edgeWidthScale: 0.84,
    baseNodeOpacity: 0.72,
    quietNodeOpacity: 0.14,
    baseEdgeOpacity: 0.11,
    quietEdgeOpacity: 0.028,
  },
  exploration: {
    name: "exploration",
    radiusScale: 1,
    minimumRadius: 3,
    maximumRadius: 30,
    edgeWidthScale: 1,
    baseNodeOpacity: 0.82,
    quietNodeOpacity: 0.17,
    baseEdgeOpacity: 0.14,
    quietEdgeOpacity: 0.038,
  },
  focus: {
    name: "focus",
    radiusScale: 1.18,
    minimumRadius: 4,
    maximumRadius: 34,
    edgeWidthScale: 1.12,
    baseNodeOpacity: 0.86,
    quietNodeOpacity: 0.19,
    baseEdgeOpacity: 0.16,
    quietEdgeOpacity: 0.046,
  },
};

export interface GraphNodePresentation {
  /** Original topology node index, in deterministic draw order. */
  indices: Uint32Array;
  /** Interleaved screen x/y coordinates. */
  centers: Float32Array;
  depths: Float32Array;
  visualClasses: Uint8Array;
  radii: Float32Array;
  opacities: Float32Array;
  fillColors: Uint32Array;
  strokeColors: Uint32Array;
  strokeWidths: Float32Array;
  strokeOpacities: Float32Array;
  emphasis: Uint8Array;
}

export interface GraphEdgePresentation {
  /** Original topology edge index, in deterministic draw order. */
  indices: Uint32Array;
  /** Interleaved source, quadratic control, and target x/y coordinates. */
  curves: Float32Array;
  depths: Float32Array;
  visualClasses: Uint8Array;
  widths: Float32Array;
  opacities: Float32Array;
  strokeColors: Uint32Array;
  emphasis: Uint8Array;
}

export interface GraphLabelPresentationStyle {
  font: string;
  requiredFont: string;
  color: number;
  requiredColor: number;
  opacity: number;
}

export interface GraphPresentationPlan {
  version: typeof GRAPH_PRESENTATION_VERSION;
  topologyHash: string;
  layoutEpochId: string;
  viewport: GraphViewport;
  profile: GraphPresentationProfileName;
  clearColor: number | null;
  nodes: GraphNodePresentation;
  edges: GraphEdgePresentation;
  /** Labels have already been selected, measured, and placed by the scene. */
  labels: GraphLabelPlan;
  labelStyle: GraphLabelPresentationStyle;
}

export interface GraphPresentationOptions {
  palette: GraphPresentationPalette;
  /** Deterministic replay/test override. Production presentation is adaptive. */
  profile?: GraphPresentationProfileName;
}

const NODE_DEPTH_BUCKETS = 64;
const MAXIMUM_NODE_PALETTE_COLORS = 16;

export function graphPresentationNodeRadius(
  degree: number,
  visualClass: number,
  scene: Pick<GraphSceneContract, "camera">,
  profileName: GraphPresentationProfileName = "exploration",
): number {
  const profile = GRAPH_PRESENTATION_PROFILES[profileName];
  const radius = graphNodeScreenRadius(degree, visualClass, scene.camera) * profile.radiusScale;
  return clamp(radius, profile.minimumRadius, profile.maximumRadius);
}

/**
 * Resolve scene state into renderer-neutral draw data. This is the last layer
 * allowed to inspect topology, selection, path, projection, or label meaning.
 */
export function createGraphPresentationPlan(
  scene: GraphSceneContract,
  labelPlan: GraphLabelPlan,
  options: GraphPresentationOptions,
): GraphPresentationPlan {
  validatePalette(options.palette);
  const profileName = options.profile ?? adaptiveProfile(scene);
  const profile = GRAPH_PRESENTATION_PROFILES[profileName];
  const nodeOrder = visibleNodeOrder(scene, options.palette);
  const edgeOrder = visibleEdgeOrder(scene);
  const hasSelection = scene.interaction.selected >= 0;
  const nodes: GraphNodePresentation = {
    indices: new Uint32Array(nodeOrder.length),
    centers: new Float32Array(nodeOrder.length * 2),
    depths: new Float32Array(nodeOrder.length),
    visualClasses: new Uint8Array(nodeOrder.length),
    radii: new Float32Array(nodeOrder.length),
    opacities: new Float32Array(nodeOrder.length),
    fillColors: new Uint32Array(nodeOrder.length),
    strokeColors: new Uint32Array(nodeOrder.length),
    strokeWidths: new Float32Array(nodeOrder.length),
    strokeOpacities: new Float32Array(nodeOrder.length),
    emphasis: new Uint8Array(nodeOrder.length),
  };
  for (let target = 0; target < nodeOrder.length; target += 1) {
    const index = nodeOrder[target] ?? 0;
    const source = index * 4;
    const emphasis = nodeEmphasis(scene, index);
    const visualClass = scene.topology.nodes.visualClasses[index] ?? 0;
    nodes.indices[target] = index;
    nodes.centers[target * 2] = scene.projection.nodes[source] ?? 0;
    nodes.centers[target * 2 + 1] = scene.projection.nodes[source + 1] ?? 0;
    nodes.depths[target] = scene.projection.nodes[source + 2] ?? 1;
    nodes.visualClasses[target] = visualClass;
    nodes.radii[target] = emphasizedRadius(
      graphPresentationNodeRadius(scene.topology.nodes.degrees[index] ?? 0, visualClass, scene, profileName),
      emphasis,
    );
    nodes.opacities[target] = nodeOpacity(profile, emphasis, hasSelection);
    nodes.fillColors[target] = nodeColor(options.palette, scene.topology.nodes.groups[index] ?? 0, visualClass, emphasis);
    nodes.strokeColors[target] = emphasis & GraphPresentationEmphasis.selected ? options.palette.accent
      : emphasis & GraphPresentationEmphasis.path ? options.palette.path
        : options.palette.accent;
    nodes.strokeWidths[target] = emphasis & GraphPresentationEmphasis.selected ? 1.65
      : emphasis & (GraphPresentationEmphasis.path | GraphPresentationEmphasis.hovered) ? 1.15
        : 0;
    nodes.strokeOpacities[target] = emphasis & GraphPresentationEmphasis.selected ? 1
      : emphasis & (GraphPresentationEmphasis.path | GraphPresentationEmphasis.hovered) ? 0.94
        : 0;
    nodes.emphasis[target] = emphasis;
  }

  const edges: GraphEdgePresentation = {
    indices: new Uint32Array(edgeOrder.length),
    curves: new Float32Array(edgeOrder.length * 6),
    depths: new Float32Array(edgeOrder.length),
    visualClasses: new Uint8Array(edgeOrder.length),
    widths: new Float32Array(edgeOrder.length),
    opacities: new Float32Array(edgeOrder.length),
    strokeColors: new Uint32Array(edgeOrder.length),
    emphasis: new Uint8Array(edgeOrder.length),
  };
  for (let target = 0; target < edgeOrder.length; target += 1) {
    const index = edgeOrder[target] ?? 0;
    const sourceNode = scene.topology.edges.endpoints[index * 2] ?? 0;
    const targetNode = scene.topology.edges.endpoints[index * 2 + 1] ?? 0;
    const source = sourceNode * 4;
    const destination = targetNode * 4;
    const emphasis = edgeEmphasis(scene, index, sourceNode, targetNode);
    const visualClass = scene.topology.edges.visualClasses[index] ?? 0;
    edges.indices[target] = index;
    const curveOffset = target * 6;
    writeCurve(
      edges.curves,
      curveOffset,
      scene.projection.nodes[source] ?? 0,
      scene.projection.nodes[source + 1] ?? 0,
      scene.projection.nodes[destination] ?? 0,
      scene.projection.nodes[destination + 1] ?? 0,
      index,
    );
    edges.depths[target] = ((scene.projection.nodes[source + 2] ?? 1) + (scene.projection.nodes[destination + 2] ?? 1)) / 2;
    edges.visualClasses[target] = visualClass;
    edges.widths[target] = edgeWidth(profile, visualClass, emphasis);
    edges.opacities[target] = edgeOpacity(profile, emphasis, hasSelection);
    edges.strokeColors[target] = edgeColor(options.palette, visualClass, emphasis);
    edges.emphasis[target] = emphasis;
  }

  return {
    version: GRAPH_PRESENTATION_VERSION,
    topologyHash: scene.topology.topologyHash,
    layoutEpochId: scene.topology.layoutEpochId,
    viewport: { ...scene.projection.viewport },
    profile: profileName,
    clearColor: options.palette.clearColor,
    nodes,
    edges,
    labels: cloneLabelPlan(labelPlan),
    labelStyle: {
      font: '500 11px "IBM Plex Mono", ui-monospace, monospace',
      requiredFont: '650 11px "IBM Plex Mono", ui-monospace, monospace',
      color: options.palette.text,
      requiredColor: options.palette.accent,
      opacity: 0.9,
    },
  };
}

function visibleNodeOrder(scene: GraphSceneContract, palette: GraphPresentationPalette): Uint32Array {
  const colorStyles = palette.nodeColors.length + 4;
  const styleCount = 4 * 16 * colorStyles;
  const counts = new Uint32Array(styleCount * NODE_DEPTH_BUCKETS);
  let visibleCount = 0;
  for (let index = 0; index < scene.topology.nodes.seeds.length; index += 1) {
    const offset = index * 4;
    if (scene.projection.nodes[offset + 3] !== 1) continue;
    if (!Number.isFinite(scene.projection.nodes[offset]) || !Number.isFinite(scene.projection.nodes[offset + 1])) continue;
    counts[nodeBucket(scene, palette, index, colorStyles)] += 1;
    visibleCount += 1;
  }
  const offsets = prefixOffsets(counts);
  const cursors = new Uint32Array(offsets.subarray(0, counts.length));
  const order = new Uint32Array(visibleCount);
  for (let index = 0; index < scene.topology.nodes.seeds.length; index += 1) {
    const offset = index * 4;
    if (scene.projection.nodes[offset + 3] !== 1) continue;
    if (!Number.isFinite(scene.projection.nodes[offset]) || !Number.isFinite(scene.projection.nodes[offset + 1])) continue;
    const bucket = nodeBucket(scene, palette, index, colorStyles);
    order[cursors[bucket] ?? 0] = index;
    cursors[bucket] += 1;
  }
  return order;
}

function visibleEdgeOrder(scene: GraphSceneContract): Uint32Array {
  const nodeCount = scene.topology.nodes.seeds.length;
  const counts = new Uint32Array(4 * 4 * 8);
  let visibleCount = 0;
  for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
    const source = scene.topology.edges.endpoints[index * 2] ?? nodeCount;
    const target = scene.topology.edges.endpoints[index * 2 + 1] ?? nodeCount;
    if (source >= nodeCount || target >= nodeCount) continue;
    if (scene.projection.nodes[source * 4 + 3] !== 1 || scene.projection.nodes[target * 4 + 3] !== 1) continue;
    counts[edgeBucket(scene, index, source, target)] += 1;
    visibleCount += 1;
  }
  const offsets = prefixOffsets(counts);
  const cursors = new Uint32Array(offsets.subarray(0, counts.length));
  const order = new Uint32Array(visibleCount);
  for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
    const source = scene.topology.edges.endpoints[index * 2] ?? nodeCount;
    const target = scene.topology.edges.endpoints[index * 2 + 1] ?? nodeCount;
    if (source >= nodeCount || target >= nodeCount) continue;
    if (scene.projection.nodes[source * 4 + 3] !== 1 || scene.projection.nodes[target * 4 + 3] !== 1) continue;
    const bucket = edgeBucket(scene, index, source, target);
    order[cursors[bucket] ?? 0] = index;
    cursors[bucket] += 1;
  }
  return order;
}

function nodeBucket(scene: GraphSceneContract, palette: GraphPresentationPalette, index: number, colorStyles: number): number {
  const emphasis = nodeEmphasis(scene, index);
  const layer = emphasisLayer(emphasis);
  const visualClass = scene.topology.nodes.visualClasses[index] ?? 0;
  const colorStyle = nodeColorStyle(palette, scene.topology.nodes.groups[index] ?? 0, visualClass, emphasis);
  const style = (layer * 16 + (emphasis & 0x0f)) * colorStyles + colorStyle;
  const depth = clamp(scene.projection.nodes[index * 4 + 2] ?? 1, 0, 1);
  const depthBucket = NODE_DEPTH_BUCKETS - 1 - Math.round(depth * (NODE_DEPTH_BUCKETS - 1));
  return style * NODE_DEPTH_BUCKETS + depthBucket;
}

function edgeBucket(scene: GraphSceneContract, index: number, source: number, target: number): number {
  const emphasis = edgeEmphasis(scene, index, source, target);
  const visualClass = Math.min(7, scene.topology.edges.visualClasses[index] ?? 0);
  return (emphasisLayer(emphasis) * 4 + (emphasis & 0x03)) * 8 + visualClass;
}

function prefixOffsets(counts: Uint32Array): Uint32Array {
  const offsets = new Uint32Array(counts.length + 1);
  for (let index = 0; index < counts.length; index += 1) offsets[index + 1] = (offsets[index] ?? 0) + (counts[index] ?? 0);
  return offsets;
}

function nodeEmphasis(scene: GraphSceneContract, index: number): number {
  let emphasis = 0;
  if (index === scene.interaction.selected) emphasis |= GraphPresentationEmphasis.selected;
  if (scene.interaction.pathNodes[index] === 1) emphasis |= GraphPresentationEmphasis.path;
  if (index === scene.interaction.hovered) emphasis |= GraphPresentationEmphasis.hovered;
  if (index === scene.interaction.pathTarget) emphasis |= GraphPresentationEmphasis.pathTarget | GraphPresentationEmphasis.path;
  return emphasis;
}

function edgeEmphasis(scene: GraphSceneContract, index: number, source: number, target: number): number {
  let emphasis = 0;
  if (source === scene.interaction.selected || target === scene.interaction.selected) emphasis |= GraphPresentationEmphasis.selected;
  if (scene.interaction.pathEdges[index] === 1) emphasis |= GraphPresentationEmphasis.path;
  return emphasis;
}

function emphasisLayer(emphasis: number): number {
  if (emphasis & GraphPresentationEmphasis.selected) return 3;
  if (emphasis & GraphPresentationEmphasis.hovered) return 2;
  if (emphasis & GraphPresentationEmphasis.path) return 1;
  return 0;
}

function emphasizedRadius(radius: number, emphasis: number): number {
  if (emphasis & GraphPresentationEmphasis.selected) return radius * 1.18;
  if (emphasis & GraphPresentationEmphasis.hovered) return radius * 1.1;
  if (emphasis & GraphPresentationEmphasis.path) return radius * 1.08;
  return radius;
}

function nodeOpacity(profile: GraphPresentationProfile, emphasis: number, hasSelection: boolean): number {
  if (emphasis & GraphPresentationEmphasis.selected) return 1;
  if (emphasis & GraphPresentationEmphasis.hovered) return 0.96;
  if (emphasis & GraphPresentationEmphasis.path) return 0.92;
  return hasSelection ? profile.quietNodeOpacity : profile.baseNodeOpacity;
}

function edgeOpacity(profile: GraphPresentationProfile, emphasis: number, hasSelection: boolean): number {
  if (emphasis & GraphPresentationEmphasis.path) return 0.94;
  if (emphasis & GraphPresentationEmphasis.selected) return 0.48;
  return hasSelection ? profile.quietEdgeOpacity : profile.baseEdgeOpacity;
}

function edgeWidth(profile: GraphPresentationProfile, visualClass: number, emphasis: number): number {
  const classScale = visualClass === 2 ? 0.94 : visualClass >= 3 ? 1.06 : 1;
  const emphasized = emphasis & GraphPresentationEmphasis.path ? 2
    : emphasis & GraphPresentationEmphasis.selected ? 1.3
      : 0.68;
  return emphasized * classScale * profile.edgeWidthScale;
}

function nodeColor(palette: GraphPresentationPalette, group: number, visualClass: number, emphasis: number): number {
  if (emphasis & GraphPresentationEmphasis.selected) return palette.accent;
  if (emphasis & GraphPresentationEmphasis.path) return palette.path;
  if (visualClass === 1) return palette.unresolved;
  if (visualClass === 2) return palette.external;
  return palette.nodeColors[group % palette.nodeColors.length] ?? palette.accent;
}

function nodeColorStyle(palette: GraphPresentationPalette, group: number, visualClass: number, emphasis: number): number {
  if (emphasis & GraphPresentationEmphasis.selected) return palette.nodeColors.length + 2;
  if (emphasis & GraphPresentationEmphasis.path) return palette.nodeColors.length + 3;
  if (visualClass === 1) return palette.nodeColors.length;
  if (visualClass === 2) return palette.nodeColors.length + 1;
  return group % palette.nodeColors.length;
}

function edgeColor(palette: GraphPresentationPalette, visualClass: number, emphasis: number): number {
  if (emphasis & GraphPresentationEmphasis.path) return palette.path;
  if (emphasis & GraphPresentationEmphasis.selected) return palette.accent;
  if (visualClass === 1) return palette.accent;
  if (visualClass === 2) return palette.external;
  if (visualClass >= 3) return palette.unresolved;
  return palette.muted;
}

function writeCurve(
  curves: Float32Array,
  offset: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  index: number,
): void {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const bend = Math.min(34, distance * 0.115) * (index & 1 ? -1 : 1);
  curves[offset] = sourceX;
  curves[offset + 1] = sourceY;
  curves[offset + 2] = (sourceX + targetX) * 0.5 - (dy / distance) * bend;
  curves[offset + 3] = (sourceY + targetY) * 0.5 + (dx / distance) * bend;
  curves[offset + 4] = targetX;
  curves[offset + 5] = targetY;
}

function cloneLabelPlan(plan: GraphLabelPlan): GraphLabelPlan {
  return {
    placements: plan.placements.map((placement) => ({ ...placement, box: { ...placement.box } })),
    omittedRequired: [...plan.omittedRequired],
  };
}

function adaptiveProfile(scene: GraphSceneContract): GraphPresentationProfileName {
  const area = Math.max(1, scene.projection.viewport.width * scene.projection.viewport.height);
  const density = scene.projection.pickIndex.nodeIndices.length / area;
  if (scene.interaction.selected >= 0 && scene.camera.distance <= 560) return "focus";
  if (scene.camera.distance >= 1_300 || density >= 0.025) return "overview";
  return "exploration";
}

function validatePalette(palette: GraphPresentationPalette): void {
  if (palette.nodeColors.length < 1 || palette.nodeColors.length > MAXIMUM_NODE_PALETTE_COLORS) {
    throw new Error(`Graph presentation palettes require 1-${MAXIMUM_NODE_PALETTE_COLORS} node colors.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
