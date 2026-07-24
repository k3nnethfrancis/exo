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

export interface GraphPresentationCompilerStats {
  compilations: number;
  topologyRebuilds: number;
  paletteRebuilds: number;
  orderRebuilds: number;
  geometryRebuilds: number;
  styleRebuilds: number;
  numericReuseHits: number;
  capacityGrowths: number;
  /** Cumulative typed-array capacity bytes allocated by this compiler. */
  allocatedBytes: number;
  /** Typed-array capacity bytes retained by the current compiler generation. */
  residentCapacityBytes: number;
  nodeCapacity: number;
  edgeCapacity: number;
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

/**
 * Reusable presentation compiler for interactive camera frames.
 *
 * The pure function above remains the detached truth oracle. This compiler
 * preserves the same plan shape and bytes, but its numeric typed-array views
 * are owned by the compiler and remain valid only until its next `compile`.
 * Pixel adapters consume a plan synchronously, so that lifetime removes the
 * otherwise dominant per-frame ArrayBuffer churn without changing renderer
 * meaning. Labels stay detached because they are cold, bounded scene data.
 */
export class GraphPresentationCompiler {
  private nodeCapacity = 0;
  private edgeCapacity = 0;
  private nodeBucketCapacity = 0;
  private edgeBucketCapacity = 0;
  private nodes = emptyNodePresentation();
  private edges = emptyEdgePresentation();
  private nodeSemanticRadii = new Float64Array(0);
  private nodeBaseColorStyles = new Uint8Array(0);
  private nodeBaseFillColors = new Uint32Array(0);
  private nodeEmphasisByIndex = new Uint8Array(0);
  private edgeBaseStrokeColors = new Uint32Array(0);
  private edgeEmphasisByIndex = new Uint8Array(0);
  private edgeCurveCache = new Float32Array(0);
  private edgeDepthCache = new Float32Array(0);
  private nodeBucketCounts = new Uint32Array(0);
  private nodeBucketCursors = new Uint32Array(0);
  private edgeBucketCounts = new Uint32Array(0);
  private edgeBucketCursors = new Uint32Array(0);
  private nodeViewCount = -1;
  private edgeViewCount = -1;
  private nodeView = emptyNodePresentation();
  private edgeView = emptyEdgePresentation();
  private topologyHash = "";
  private topologyNodes: GraphSceneContract["topology"]["nodes"] | null = null;
  private topologyEdges: GraphSceneContract["topology"]["edges"] | null = null;
  private paletteSnapshot: GraphPresentationPalette | null = null;
  private projectionNodes: Float32Array | null = null;
  private projectionWidth = 0;
  private projectionHeight = 0;
  private geometryProjectionNodes: Float32Array | null = null;
  private selected = Number.NaN;
  private pathTarget = Number.NaN;
  private hovered = Number.NaN;
  private pathNodes: Uint8Array | null = null;
  private pathEdges: Uint8Array | null = null;
  private readonly cameraSnapshot = new Float64Array(9);
  private hasCameraSnapshot = false;
  private profileName: GraphPresentationProfileName | null = null;
  private hasCompiled = false;
  private readonly counters: Omit<GraphPresentationCompilerStats, "residentCapacityBytes" | "nodeCapacity" | "edgeCapacity"> = {
    compilations: 0,
    topologyRebuilds: 0,
    paletteRebuilds: 0,
    orderRebuilds: 0,
    geometryRebuilds: 0,
    styleRebuilds: 0,
    numericReuseHits: 0,
    capacityGrowths: 0,
    allocatedBytes: 0,
  };

  compile(
    scene: GraphSceneContract,
    labelPlan: GraphLabelPlan,
    options: GraphPresentationOptions,
  ): GraphPresentationPlan {
    validatePalette(options.palette);
    this.counters.compilations += 1;
    const profileName = options.profile ?? adaptiveProfile(scene);
    const topologyChanged = this.topologyChanged(scene);
    const paletteChanged = !samePalette(this.paletteSnapshot, options.palette);
    const paletteOrderChanged = !this.paletteSnapshot
      || this.paletteSnapshot.nodeColors.length !== options.palette.nodeColors.length;
    const projectionChanged = this.projectionNodes !== scene.projection.nodes
      || this.projectionWidth !== scene.projection.viewport.width
      || this.projectionHeight !== scene.projection.viewport.height;
    const interactionChanged = this.selected !== scene.interaction.selected
      || this.pathTarget !== scene.interaction.pathTarget
      || this.hovered !== scene.interaction.hovered
      || this.pathNodes !== scene.interaction.pathNodes
      || this.pathEdges !== scene.interaction.pathEdges;
    const cameraChanged = !this.hasCameraSnapshot || !sameCamera(this.cameraSnapshot, scene);
    const profileChanged = this.profileName !== profileName;

    this.ensureNodeCapacity(scene.topology.nodes.seeds.length);
    this.ensureEdgeCapacity(scene.topology.edges.visualClasses.length);
    this.ensureBucketCapacity((4 * 16 * (options.palette.nodeColors.length + 4)) * NODE_DEPTH_BUCKETS, 4 * 4 * 8);

    if (topologyChanged) {
      this.rebuildTopologyCache(scene);
      this.counters.topologyRebuilds += 1;
    }
    if (topologyChanged || paletteChanged) {
      this.rebuildPaletteCache(scene, options.palette);
      this.counters.paletteRebuilds += 1;
    }

    const orderChanged = !this.hasCompiled || topologyChanged || projectionChanged || interactionChanged || paletteOrderChanged;
    const geometryChanged = topologyChanged || this.geometryProjectionNodes !== scene.projection.nodes;
    if (orderChanged) {
      this.rebuildEmphasis(scene);
      const nodeCount = this.rebuildNodeOrder(scene, options.palette);
      const edgeCount = this.rebuildEdgeOrder(scene);
      this.setViewCounts(nodeCount, edgeCount);
      this.rebuildOrderedNodes(scene, options.palette, profileName);
      this.rebuildOrderedEdges(scene, options.palette, profileName, geometryChanged);
      this.counters.orderRebuilds += 1;
      this.counters.styleRebuilds += 1;
      if (geometryChanged) this.counters.geometryRebuilds += 1;
    } else {
      let rebuilt = false;
      if (paletteChanged) {
        this.rebuildNodeColors(options.palette);
        this.rebuildEdgeColors(options.palette);
        rebuilt = true;
      }
      if (cameraChanged || profileChanged) {
        this.rebuildNodeMetrics(scene, profileName);
        this.rebuildEdgeMetrics(scene, profileName);
        rebuilt = true;
      }
      if (rebuilt) this.counters.styleRebuilds += 1;
      else this.counters.numericReuseHits += 1;
    }

    this.captureInputs(scene, options.palette, profileName, paletteChanged);
    const profile = GRAPH_PRESENTATION_PROFILES[profileName];
    return {
      version: GRAPH_PRESENTATION_VERSION,
      topologyHash: scene.topology.topologyHash,
      layoutEpochId: scene.topology.layoutEpochId,
      viewport: { ...scene.projection.viewport },
      profile: profile.name,
      clearColor: options.palette.clearColor,
      nodes: this.nodeView,
      edges: this.edgeView,
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

  stats(): GraphPresentationCompilerStats {
    return {
      ...this.counters,
      residentCapacityBytes: presentationCapacityBytes(
        this.nodeCapacity,
        this.edgeCapacity,
        this.nodeBucketCapacity,
        this.edgeBucketCapacity,
      ),
      nodeCapacity: this.nodeCapacity,
      edgeCapacity: this.edgeCapacity,
    };
  }

  private topologyChanged(scene: GraphSceneContract): boolean {
    return this.topologyHash !== scene.topology.topologyHash
      || this.topologyNodes !== scene.topology.nodes
      || this.topologyEdges !== scene.topology.edges;
  }

  private ensureNodeCapacity(required: number): void {
    if (required <= this.nodeCapacity) return;
    const capacity = boundedCapacity(this.nodeCapacity, required, Math.floor(0x3fffffff / 2));
    this.nodeCapacity = capacity;
    this.nodes = allocateNodePresentation(capacity);
    this.nodeSemanticRadii = new Float64Array(capacity);
    this.nodeBaseColorStyles = new Uint8Array(capacity);
    this.nodeBaseFillColors = new Uint32Array(capacity);
    this.nodeEmphasisByIndex = new Uint8Array(capacity);
    this.nodeViewCount = -1;
    this.counters.capacityGrowths += 1;
    this.counters.allocatedBytes += nodeCapacityBytes(capacity);
  }

  private ensureEdgeCapacity(required: number): void {
    if (required <= this.edgeCapacity) return;
    const capacity = boundedCapacity(this.edgeCapacity, required, Math.floor(0x3fffffff / 6));
    this.edgeCapacity = capacity;
    this.edges = allocateEdgePresentation(capacity);
    this.edgeBaseStrokeColors = new Uint32Array(capacity);
    this.edgeEmphasisByIndex = new Uint8Array(capacity);
    this.edgeCurveCache = new Float32Array(capacity * 6);
    this.edgeDepthCache = new Float32Array(capacity);
    this.edgeViewCount = -1;
    this.geometryProjectionNodes = null;
    this.counters.capacityGrowths += 1;
    this.counters.allocatedBytes += edgeCapacityBytes(capacity);
  }

  private ensureBucketCapacity(nodeRequired: number, edgeRequired: number): void {
    if (nodeRequired > this.nodeBucketCapacity) {
      const capacity = boundedCapacity(this.nodeBucketCapacity, nodeRequired, 0x3fffffff);
      this.nodeBucketCapacity = capacity;
      this.nodeBucketCounts = new Uint32Array(capacity);
      this.nodeBucketCursors = new Uint32Array(capacity);
      this.counters.capacityGrowths += 1;
      this.counters.allocatedBytes += capacity * Uint32Array.BYTES_PER_ELEMENT * 2;
    }
    if (edgeRequired > this.edgeBucketCapacity) {
      const capacity = boundedCapacity(this.edgeBucketCapacity, edgeRequired, 0x3fffffff);
      this.edgeBucketCapacity = capacity;
      this.edgeBucketCounts = new Uint32Array(capacity);
      this.edgeBucketCursors = new Uint32Array(capacity);
      this.counters.capacityGrowths += 1;
      this.counters.allocatedBytes += capacity * Uint32Array.BYTES_PER_ELEMENT * 2;
    }
  }

  private rebuildTopologyCache(scene: GraphSceneContract): void {
    const nodes = scene.topology.nodes;
    for (let index = 0; index < nodes.seeds.length; index += 1) {
      const visualClass = nodes.visualClasses[index] ?? 0;
      const styleScale = 1 + Math.min(7, Math.max(0, visualClass)) * 0.035;
      this.nodeSemanticRadii[index] = (3.4 + 0.75 * Math.log2(1 + Math.max(0, nodes.degrees[index] ?? 0))) * styleScale;
    }
    this.geometryProjectionNodes = null;
  }

  private rebuildPaletteCache(scene: GraphSceneContract, palette: GraphPresentationPalette): void {
    const nodes = scene.topology.nodes;
    for (let index = 0; index < nodes.seeds.length; index += 1) {
      const visualClass = nodes.visualClasses[index] ?? 0;
      const group = nodes.groups[index] ?? 0;
      this.nodeBaseColorStyles[index] = visualClass === 1 ? palette.nodeColors.length
        : visualClass === 2 ? palette.nodeColors.length + 1
          : group % palette.nodeColors.length;
      this.nodeBaseFillColors[index] = visualClass === 1 ? palette.unresolved
        : visualClass === 2 ? palette.external
          : palette.nodeColors[group % palette.nodeColors.length] ?? palette.accent;
    }
    for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
      const visualClass = scene.topology.edges.visualClasses[index] ?? 0;
      this.edgeBaseStrokeColors[index] = visualClass === 1 ? palette.accent
        : visualClass === 2 ? palette.external
          : visualClass >= 3 ? palette.unresolved
            : palette.muted;
    }
  }

  private rebuildEmphasis(scene: GraphSceneContract): void {
    for (let index = 0; index < scene.topology.nodes.seeds.length; index += 1) {
      this.nodeEmphasisByIndex[index] = nodeEmphasis(scene, index);
    }
    for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
      const source = scene.topology.edges.endpoints[index * 2] ?? scene.topology.nodes.seeds.length;
      const target = scene.topology.edges.endpoints[index * 2 + 1] ?? scene.topology.nodes.seeds.length;
      this.edgeEmphasisByIndex[index] = edgeEmphasis(scene, index, source, target);
    }
  }

  private rebuildNodeOrder(scene: GraphSceneContract, palette: GraphPresentationPalette): number {
    const bucketCount = (4 * 16 * (palette.nodeColors.length + 4)) * NODE_DEPTH_BUCKETS;
    this.nodeBucketCounts.fill(0, 0, bucketCount);
    let visibleCount = 0;
    for (let index = 0; index < scene.topology.nodes.seeds.length; index += 1) {
      const offset = index * 4;
      if (scene.projection.nodes[offset + 3] !== 1) continue;
      if (!Number.isFinite(scene.projection.nodes[offset]) || !Number.isFinite(scene.projection.nodes[offset + 1])) continue;
      this.nodeBucketCounts[this.compiledNodeBucket(scene, index, palette.nodeColors.length + 4)] += 1;
      visibleCount += 1;
    }
    prefixCursors(this.nodeBucketCounts, this.nodeBucketCursors, bucketCount);
    for (let index = 0; index < scene.topology.nodes.seeds.length; index += 1) {
      const offset = index * 4;
      if (scene.projection.nodes[offset + 3] !== 1) continue;
      if (!Number.isFinite(scene.projection.nodes[offset]) || !Number.isFinite(scene.projection.nodes[offset + 1])) continue;
      const bucket = this.compiledNodeBucket(scene, index, palette.nodeColors.length + 4);
      this.nodes.indices[this.nodeBucketCursors[bucket] ?? 0] = index;
      this.nodeBucketCursors[bucket] += 1;
    }
    return visibleCount;
  }

  private rebuildEdgeOrder(scene: GraphSceneContract): number {
    const bucketCount = 4 * 4 * 8;
    this.edgeBucketCounts.fill(0, 0, bucketCount);
    const nodeCount = scene.topology.nodes.seeds.length;
    let visibleCount = 0;
    for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
      const source = scene.topology.edges.endpoints[index * 2] ?? nodeCount;
      const target = scene.topology.edges.endpoints[index * 2 + 1] ?? nodeCount;
      if (source >= nodeCount || target >= nodeCount) continue;
      if (scene.projection.nodes[source * 4 + 3] !== 1 || scene.projection.nodes[target * 4 + 3] !== 1) continue;
      this.edgeBucketCounts[this.compiledEdgeBucket(scene, index)] += 1;
      visibleCount += 1;
    }
    prefixCursors(this.edgeBucketCounts, this.edgeBucketCursors, bucketCount);
    for (let index = 0; index < scene.topology.edges.visualClasses.length; index += 1) {
      const source = scene.topology.edges.endpoints[index * 2] ?? nodeCount;
      const target = scene.topology.edges.endpoints[index * 2 + 1] ?? nodeCount;
      if (source >= nodeCount || target >= nodeCount) continue;
      if (scene.projection.nodes[source * 4 + 3] !== 1 || scene.projection.nodes[target * 4 + 3] !== 1) continue;
      const bucket = this.compiledEdgeBucket(scene, index);
      this.edges.indices[this.edgeBucketCursors[bucket] ?? 0] = index;
      this.edgeBucketCursors[bucket] += 1;
    }
    return visibleCount;
  }

  private compiledNodeBucket(scene: GraphSceneContract, index: number, colorStyles: number): number {
    const emphasis = this.nodeEmphasisByIndex[index] ?? 0;
    const colorStyle = emphasis & GraphPresentationEmphasis.selected ? colorStyles - 2
      : emphasis & GraphPresentationEmphasis.path ? colorStyles - 1
        : this.nodeBaseColorStyles[index] ?? 0;
    const style = (emphasisLayer(emphasis) * 16 + (emphasis & 0x0f)) * colorStyles + colorStyle;
    const depth = clamp(scene.projection.nodes[index * 4 + 2] ?? 1, 0, 1);
    return style * NODE_DEPTH_BUCKETS + NODE_DEPTH_BUCKETS - 1 - Math.round(depth * (NODE_DEPTH_BUCKETS - 1));
  }

  private compiledEdgeBucket(scene: GraphSceneContract, index: number): number {
    const emphasis = this.edgeEmphasisByIndex[index] ?? 0;
    const visualClass = Math.min(7, scene.topology.edges.visualClasses[index] ?? 0);
    return (emphasisLayer(emphasis) * 4 + (emphasis & 0x03)) * 8 + visualClass;
  }

  private rebuildOrderedNodes(
    scene: GraphSceneContract,
    palette: GraphPresentationPalette,
    profileName: GraphPresentationProfileName,
  ): void {
    const profile = GRAPH_PRESENTATION_PROFILES[profileName];
    const hasSelection = scene.interaction.selected >= 0;
    const zoom = graphCameraRadiusZoom(scene.camera.distance);
    for (let target = 0; target < this.nodeView.indices.length; target += 1) {
      const index = this.nodes.indices[target] ?? 0;
      const source = index * 4;
      const emphasis = this.nodeEmphasisByIndex[index] ?? 0;
      const visualClass = scene.topology.nodes.visualClasses[index] ?? 0;
      this.nodes.centers[target * 2] = scene.projection.nodes[source] ?? 0;
      this.nodes.centers[target * 2 + 1] = scene.projection.nodes[source + 1] ?? 0;
      this.nodes.depths[target] = scene.projection.nodes[source + 2] ?? 1;
      this.nodes.visualClasses[target] = visualClass;
      this.nodes.radii[target] = emphasizedRadius(compiledNodeRadius(this.nodeSemanticRadii[index] ?? 0, zoom, profile), emphasis);
      this.nodes.opacities[target] = nodeOpacity(profile, emphasis, hasSelection);
      this.nodes.fillColors[target] = emphasis & GraphPresentationEmphasis.selected ? palette.accent
        : emphasis & GraphPresentationEmphasis.path ? palette.path
          : this.nodeBaseFillColors[index] ?? palette.accent;
      this.nodes.strokeColors[target] = emphasis & GraphPresentationEmphasis.selected ? palette.accent
        : emphasis & GraphPresentationEmphasis.path ? palette.path
          : palette.accent;
      this.nodes.strokeWidths[target] = emphasis & GraphPresentationEmphasis.selected ? 1.65
        : emphasis & (GraphPresentationEmphasis.path | GraphPresentationEmphasis.hovered) ? 1.15
          : 0;
      this.nodes.strokeOpacities[target] = emphasis & GraphPresentationEmphasis.selected ? 1
        : emphasis & (GraphPresentationEmphasis.path | GraphPresentationEmphasis.hovered) ? 0.94
          : 0;
      this.nodes.emphasis[target] = emphasis;
    }
  }

  private rebuildOrderedEdges(
    scene: GraphSceneContract,
    palette: GraphPresentationPalette,
    profileName: GraphPresentationProfileName,
    geometryChanged: boolean,
  ): void {
    const profile = GRAPH_PRESENTATION_PROFILES[profileName];
    const hasSelection = scene.interaction.selected >= 0;
    for (let target = 0; target < this.edgeView.indices.length; target += 1) {
      const index = this.edges.indices[target] ?? 0;
      const sourceNode = scene.topology.edges.endpoints[index * 2] ?? 0;
      const targetNode = scene.topology.edges.endpoints[index * 2 + 1] ?? 0;
      const source = sourceNode * 4;
      const destination = targetNode * 4;
      const emphasis = this.edgeEmphasisByIndex[index] ?? 0;
      const visualClass = scene.topology.edges.visualClasses[index] ?? 0;
      const curveOffset = target * 6;
      const cacheOffset = index * 6;
      if (geometryChanged) {
        writeCurve(
          this.edgeCurveCache,
          cacheOffset,
          scene.projection.nodes[source] ?? 0,
          scene.projection.nodes[source + 1] ?? 0,
          scene.projection.nodes[destination] ?? 0,
          scene.projection.nodes[destination + 1] ?? 0,
          index,
        );
        this.edgeDepthCache[index] = ((scene.projection.nodes[source + 2] ?? 1) + (scene.projection.nodes[destination + 2] ?? 1)) / 2;
      }
      copyCurve(this.edgeCurveCache, cacheOffset, this.edges.curves, curveOffset);
      this.edges.depths[target] = this.edgeDepthCache[index] ?? 1;
      this.edges.visualClasses[target] = visualClass;
      this.edges.widths[target] = edgeWidth(profile, visualClass, emphasis);
      this.edges.opacities[target] = edgeOpacity(profile, emphasis, hasSelection);
      this.edges.strokeColors[target] = emphasis & GraphPresentationEmphasis.path ? palette.path
        : emphasis & GraphPresentationEmphasis.selected ? palette.accent
          : this.edgeBaseStrokeColors[index] ?? palette.muted;
      this.edges.emphasis[target] = emphasis;
    }
    if (geometryChanged) this.geometryProjectionNodes = scene.projection.nodes;
  }

  private rebuildNodeColors(palette: GraphPresentationPalette): void {
    for (let target = 0; target < this.nodeView.indices.length; target += 1) {
      const index = this.nodes.indices[target] ?? 0;
      const emphasis = this.nodeEmphasisByIndex[index] ?? 0;
      this.nodes.fillColors[target] = emphasis & GraphPresentationEmphasis.selected ? palette.accent
        : emphasis & GraphPresentationEmphasis.path ? palette.path
          : this.nodeBaseFillColors[index] ?? palette.accent;
      this.nodes.strokeColors[target] = emphasis & GraphPresentationEmphasis.selected ? palette.accent
        : emphasis & GraphPresentationEmphasis.path ? palette.path
          : palette.accent;
    }
  }

  private rebuildEdgeColors(palette: GraphPresentationPalette): void {
    for (let target = 0; target < this.edgeView.indices.length; target += 1) {
      const index = this.edges.indices[target] ?? 0;
      const emphasis = this.edgeEmphasisByIndex[index] ?? 0;
      this.edges.strokeColors[target] = emphasis & GraphPresentationEmphasis.path ? palette.path
        : emphasis & GraphPresentationEmphasis.selected ? palette.accent
          : this.edgeBaseStrokeColors[index] ?? palette.muted;
    }
  }

  private rebuildNodeMetrics(scene: GraphSceneContract, profileName: GraphPresentationProfileName): void {
    const profile = GRAPH_PRESENTATION_PROFILES[profileName];
    const hasSelection = scene.interaction.selected >= 0;
    const zoom = graphCameraRadiusZoom(scene.camera.distance);
    for (let target = 0; target < this.nodeView.indices.length; target += 1) {
      const index = this.nodes.indices[target] ?? 0;
      const emphasis = this.nodeEmphasisByIndex[index] ?? 0;
      this.nodes.radii[target] = emphasizedRadius(compiledNodeRadius(this.nodeSemanticRadii[index] ?? 0, zoom, profile), emphasis);
      this.nodes.opacities[target] = nodeOpacity(profile, emphasis, hasSelection);
    }
  }

  private rebuildEdgeMetrics(scene: GraphSceneContract, profileName: GraphPresentationProfileName): void {
    const profile = GRAPH_PRESENTATION_PROFILES[profileName];
    const hasSelection = scene.interaction.selected >= 0;
    for (let target = 0; target < this.edgeView.indices.length; target += 1) {
      const index = this.edges.indices[target] ?? 0;
      const emphasis = this.edgeEmphasisByIndex[index] ?? 0;
      this.edges.widths[target] = edgeWidth(profile, scene.topology.edges.visualClasses[index] ?? 0, emphasis);
      this.edges.opacities[target] = edgeOpacity(profile, emphasis, hasSelection);
    }
  }

  private setViewCounts(nodeCount: number, edgeCount: number): void {
    if (this.nodeViewCount !== nodeCount) {
      this.nodeViewCount = nodeCount;
      this.nodeView = viewNodePresentation(this.nodes, nodeCount);
    }
    if (this.edgeViewCount !== edgeCount) {
      this.edgeViewCount = edgeCount;
      this.edgeView = viewEdgePresentation(this.edges, edgeCount);
    }
  }

  private captureInputs(
    scene: GraphSceneContract,
    palette: GraphPresentationPalette,
    profileName: GraphPresentationProfileName,
    paletteChanged: boolean,
  ): void {
    this.topologyHash = scene.topology.topologyHash;
    this.topologyNodes = scene.topology.nodes;
    this.topologyEdges = scene.topology.edges;
    if (paletteChanged) this.paletteSnapshot = clonePalette(palette);
    this.projectionNodes = scene.projection.nodes;
    this.projectionWidth = scene.projection.viewport.width;
    this.projectionHeight = scene.projection.viewport.height;
    this.selected = scene.interaction.selected;
    this.pathTarget = scene.interaction.pathTarget;
    this.hovered = scene.interaction.hovered;
    this.pathNodes = scene.interaction.pathNodes;
    this.pathEdges = scene.interaction.pathEdges;
    writeCameraValues(this.cameraSnapshot, scene);
    this.hasCameraSnapshot = true;
    this.profileName = profileName;
    this.hasCompiled = true;
  }
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

function emptyNodePresentation(): GraphNodePresentation {
  return {
    indices: new Uint32Array(0),
    centers: new Float32Array(0),
    depths: new Float32Array(0),
    visualClasses: new Uint8Array(0),
    radii: new Float32Array(0),
    opacities: new Float32Array(0),
    fillColors: new Uint32Array(0),
    strokeColors: new Uint32Array(0),
    strokeWidths: new Float32Array(0),
    strokeOpacities: new Float32Array(0),
    emphasis: new Uint8Array(0),
  };
}

function emptyEdgePresentation(): GraphEdgePresentation {
  return {
    indices: new Uint32Array(0),
    curves: new Float32Array(0),
    depths: new Float32Array(0),
    visualClasses: new Uint8Array(0),
    widths: new Float32Array(0),
    opacities: new Float32Array(0),
    strokeColors: new Uint32Array(0),
    emphasis: new Uint8Array(0),
  };
}

function allocateNodePresentation(capacity: number): GraphNodePresentation {
  return {
    indices: new Uint32Array(capacity),
    centers: new Float32Array(capacity * 2),
    depths: new Float32Array(capacity),
    visualClasses: new Uint8Array(capacity),
    radii: new Float32Array(capacity),
    opacities: new Float32Array(capacity),
    fillColors: new Uint32Array(capacity),
    strokeColors: new Uint32Array(capacity),
    strokeWidths: new Float32Array(capacity),
    strokeOpacities: new Float32Array(capacity),
    emphasis: new Uint8Array(capacity),
  };
}

function allocateEdgePresentation(capacity: number): GraphEdgePresentation {
  return {
    indices: new Uint32Array(capacity),
    curves: new Float32Array(capacity * 6),
    depths: new Float32Array(capacity),
    visualClasses: new Uint8Array(capacity),
    widths: new Float32Array(capacity),
    opacities: new Float32Array(capacity),
    strokeColors: new Uint32Array(capacity),
    emphasis: new Uint8Array(capacity),
  };
}

function viewNodePresentation(storage: GraphNodePresentation, length: number): GraphNodePresentation {
  return {
    indices: storage.indices.subarray(0, length),
    centers: storage.centers.subarray(0, length * 2),
    depths: storage.depths.subarray(0, length),
    visualClasses: storage.visualClasses.subarray(0, length),
    radii: storage.radii.subarray(0, length),
    opacities: storage.opacities.subarray(0, length),
    fillColors: storage.fillColors.subarray(0, length),
    strokeColors: storage.strokeColors.subarray(0, length),
    strokeWidths: storage.strokeWidths.subarray(0, length),
    strokeOpacities: storage.strokeOpacities.subarray(0, length),
    emphasis: storage.emphasis.subarray(0, length),
  };
}

function viewEdgePresentation(storage: GraphEdgePresentation, length: number): GraphEdgePresentation {
  return {
    indices: storage.indices.subarray(0, length),
    curves: storage.curves.subarray(0, length * 6),
    depths: storage.depths.subarray(0, length),
    visualClasses: storage.visualClasses.subarray(0, length),
    widths: storage.widths.subarray(0, length),
    opacities: storage.opacities.subarray(0, length),
    strokeColors: storage.strokeColors.subarray(0, length),
    emphasis: storage.emphasis.subarray(0, length),
  };
}

function prefixCursors(counts: Uint32Array, cursors: Uint32Array, length: number): void {
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    cursors[index] = offset;
    offset += counts[index] ?? 0;
  }
}

function copyCurve(source: Float32Array, sourceOffset: number, target: Float32Array, targetOffset: number): void {
  target[targetOffset] = source[sourceOffset] ?? 0;
  target[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
  target[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
  target[targetOffset + 3] = source[sourceOffset + 3] ?? 0;
  target[targetOffset + 4] = source[sourceOffset + 4] ?? 0;
  target[targetOffset + 5] = source[sourceOffset + 5] ?? 0;
}

function graphCameraRadiusZoom(distance: number): number {
  return clamp(Math.pow(760 / Math.max(1, distance), 0.38), 0.95, 4);
}

function compiledNodeRadius(
  semanticRadius: number,
  zoom: number,
  profile: GraphPresentationProfile,
): number {
  return clamp(clamp(semanticRadius * zoom, 3, 30) * profile.radiusScale, profile.minimumRadius, profile.maximumRadius);
}

function samePalette(left: GraphPresentationPalette | null, right: GraphPresentationPalette): boolean {
  if (!left
    || left.clearColor !== right.clearColor
    || left.text !== right.text
    || left.muted !== right.muted
    || left.accent !== right.accent
    || left.path !== right.path
    || left.unresolved !== right.unresolved
    || left.external !== right.external
    || left.nodeColors.length !== right.nodeColors.length) return false;
  for (let index = 0; index < left.nodeColors.length; index += 1) {
    if (left.nodeColors[index] !== right.nodeColors[index]) return false;
  }
  return true;
}

function clonePalette(palette: GraphPresentationPalette): GraphPresentationPalette {
  return { ...palette, nodeColors: new Uint32Array(palette.nodeColors) };
}

function writeCameraValues(target: Float64Array, scene: Pick<GraphSceneContract, "camera">): void {
  target[0] = scene.camera.yaw;
  target[1] = scene.camera.pitch;
  target[2] = scene.camera.distance;
  target[3] = scene.camera.target[0];
  target[4] = scene.camera.target[1];
  target[5] = scene.camera.target[2];
  target[6] = scene.camera.fov;
  target[7] = scene.camera.near;
  target[8] = scene.camera.far;
}

function sameCamera(snapshot: Float64Array, scene: Pick<GraphSceneContract, "camera">): boolean {
  return snapshot[0] === scene.camera.yaw
    && snapshot[1] === scene.camera.pitch
    && snapshot[2] === scene.camera.distance
    && snapshot[3] === scene.camera.target[0]
    && snapshot[4] === scene.camera.target[1]
    && snapshot[5] === scene.camera.target[2]
    && snapshot[6] === scene.camera.fov
    && snapshot[7] === scene.camera.near
    && snapshot[8] === scene.camera.far;
}

function boundedCapacity(current: number, required: number, maximum: number): number {
  if (!Number.isSafeInteger(required) || required < 0 || required > maximum) {
    throw new Error(`Graph presentation capacity ${required} exceeds the typed-array bound ${maximum}.`);
  }
  let capacity = Math.max(256, current);
  while (capacity < required && capacity <= Math.floor(maximum / 2)) capacity *= 2;
  if (capacity < required) capacity = required;
  return capacity;
}

function nodeCapacityBytes(capacity: number): number {
  return capacity * 56;
}

function edgeCapacityBytes(capacity: number): number {
  return capacity * 79;
}

function presentationCapacityBytes(
  nodeCapacity: number,
  edgeCapacity: number,
  nodeBucketCapacity: number,
  edgeBucketCapacity: number,
): number {
  return nodeCapacityBytes(nodeCapacity)
    + edgeCapacityBytes(edgeCapacity)
    + (nodeBucketCapacity + edgeBucketCapacity) * Uint32Array.BYTES_PER_ELEMENT * 2;
}

function validatePalette(palette: GraphPresentationPalette): void {
  if (palette.nodeColors.length < 1 || palette.nodeColors.length > MAXIMUM_NODE_PALETTE_COLORS) {
    throw new Error(`Graph presentation palettes require 1-${MAXIMUM_NODE_PALETTE_COLORS} node colors.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
