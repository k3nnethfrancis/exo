import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCENE_CAMERA,
  buildGraphPickIndex,
  type GraphLabelPlan,
  type GraphSceneContract,
} from "./graphSceneFoundation";
import {
  GraphPresentationEmphasis,
  GraphPresentationCompiler,
  createGraphPresentationPlan,
  graphPresentationNodeRadius,
  type GraphPresentationPalette,
} from "./graphPresentation";

describe("renderer-neutral graph presentation", () => {
  it("resolves visible draw data, depth order, and selection/path emphasis before rendering", () => {
    const scene = fixtureScene();
    const labels = labelPlan();
    const plan = createGraphPresentationPlan(scene, labels, { palette: palette() });

    expect([...plan.nodes.indices]).toEqual([0, 2, 1]);
    expect([...plan.edges.indices].sort()).toEqual([0, 1]);
    expect(plan.nodes.visualClasses).toEqual(new Uint8Array([0, 2, 1]));
    expect(plan.nodes.opacities.every((opacity) => opacity > 0)).toBe(true);
    const selected = [...plan.nodes.indices].indexOf(1);
    const target = [...plan.nodes.indices].indexOf(2);
    expect(plan.nodes.emphasis[selected] & GraphPresentationEmphasis.selected).toBeTruthy();
    expect(plan.nodes.emphasis[target] & GraphPresentationEmphasis.pathTarget).toBeTruthy();
    expect(plan.nodes.opacities[selected]).toBe(1);
    expect(plan.edges.emphasis.some((emphasis) => Boolean(emphasis & GraphPresentationEmphasis.path))).toBe(true);
    expect(plan.labels).toEqual(labels);
    expect(plan.labels).not.toBe(labels);
  });

  it("produces byte-for-byte deterministic numeric plans and detached label snapshots", () => {
    const scene = fixtureScene();
    const labels = labelPlan();
    const first = createGraphPresentationPlan(scene, labels, { profile: "focus", palette: palette() });
    const second = createGraphPresentationPlan(scene, labels, { profile: "focus", palette: palette() });

    expect(first).toEqual(second);
    labels.placements[0]!.text = "mutated after planning";
    expect(first.labels.placements[0]?.text).toBe("Alpha");
    expect(first.profile).toBe("focus");
  });

  it("keeps internal presentation profiles legible and radius monotonic", () => {
    const scene = fixtureScene();
    const overview = graphPresentationNodeRadius(4, 0, scene, "overview");
    const exploration = graphPresentationNodeRadius(4, 0, scene, "exploration");
    const focus = graphPresentationNodeRadius(4, 0, scene, "focus");
    const highDegree = graphPresentationNodeRadius(128, 0, scene, "exploration");
    const close = graphPresentationNodeRadius(4, 0, { camera: { ...scene.camera, distance: 160 } }, "exploration");

    expect(overview).toBeLessThan(exploration);
    expect(exploration).toBeLessThan(focus);
    expect(highDegree).toBeGreaterThan(exploration);
    expect(close).toBeGreaterThan(exploration);
    expect(overview).toBeGreaterThanOrEqual(2.4);
    expect(focus).toBeLessThanOrEqual(34);
  });

  it("draws equal-style nodes far-to-near without a comparator sort", () => {
    const scene = fixtureScene();
    scene.topology.nodes.groups.fill(0);
    scene.topology.nodes.visualClasses.fill(0);
    scene.projection.nodes[15] = 1;
    scene.interaction = {
      selected: -1,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(scene.topology.nodes.seeds.length),
      pathEdges: new Uint8Array(scene.topology.edges.visualClasses.length),
    };

    const plan = createGraphPresentationPlan(scene, labelPlan(), { palette: palette() });

    expect([...plan.nodes.indices]).toEqual([0, 2, 3, 1]);
    expect(plan.nodes.depths[0]).toBeCloseTo(0.8);
    expect(plan.nodes.depths[1]).toBeCloseTo(0.6);
    expect(plan.nodes.depths[2]).toBeCloseTo(0.5);
    expect(plan.nodes.depths[3]).toBeCloseTo(0.3);
  });

  it("carries the resolved theme palette without inventing a Canvas theme", () => {
    const scene = fixtureScene();
    scene.interaction = {
      selected: -1,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(scene.topology.nodes.seeds.length),
      pathEdges: new Uint8Array(scene.topology.edges.visualClasses.length),
    };
    const dark = palette();
    dark.clearColor = 0x111512ff;
    dark.text = 0xf0f2efff;
    dark.muted = 0x656b67ff;

    const plan = createGraphPresentationPlan(scene, labelPlan(), { palette: dark });

    expect(plan.clearColor).toBe(dark.clearColor);
    expect(plan.labelStyle.color).toBe(dark.text);
    const ordinaryEdge = [...plan.edges.indices].indexOf(0);
    expect(plan.edges.strokeColors[ordinaryEdge]).toBe(dark.muted);
  });
});

describe("reusable graph presentation compiler", () => {
  it("matches the detached oracle exactly across every invalidation dimension", () => {
    const compiler = new GraphPresentationCompiler();
    const base = fixtureScene();
    const dark = palette();
    dark.clearColor = 0x111512ff;
    dark.text = 0xf0f2efff;
    dark.muted = 0x656b67ff;
    dark.nodeColors = new Uint32Array([0x182d27ff, 0xa54d31ff, 0x514781ff]);
    const recolored = palette();
    recolored.accent = 0x734b9aff;
    recolored.path = 0xc17a43ff;
    recolored.nodeColors = new Uint32Array([0x734b9aff, 0x975b3eff, 0x61528aff, 0x596e4aff]);

    const radiusOnly = cloneScene(base);
    radiusOnly.camera.distance = 540;

    const camera = cloneScene(base);
    camera.camera.distance = 1_600;
    camera.camera.yaw = 0.6;
    camera.projection.nodes = new Float32Array(camera.projection.nodes);
    camera.projection.nodes[0] = 112;
    camera.projection.nodes[1] = 92;
    camera.projection.nodes[2] = 0.18;
    camera.projection.nodes[4] = 245;
    camera.projection.nodes[5] = 175;
    camera.projection.nodes[6] = 0.77;

    const interaction = cloneScene(camera);
    interaction.interaction = {
      selected: 0,
      pathTarget: 2,
      hovered: 1,
      pathNodes: new Uint8Array([1, 0, 1, 0]),
      pathEdges: new Uint8Array([1, 0, 0]),
    };

    const layoutEpochOnly = cloneScene(interaction);
    layoutEpochOnly.topology = { ...interaction.topology, layoutEpochId: "layout:fixture:2" };
    layoutEpochOnly.layout = { ...interaction.layout, layoutEpochId: "layout:fixture:2", sequence: 2 };

    const nextEpoch = cloneScene(interaction);
    nextEpoch.topology = {
      topologyHash: "topology:next",
      layoutEpochId: "layout:next",
      seed: 9,
      nodes: {
        identityKeys: new Uint32Array([1, 0, 2, 0, 3, 0, 4, 0, 5, 0]),
        seeds: new Uint32Array([11, 22, 33, 44, 55]),
        groups: new Uint32Array([0, 1, 2, 3, 1]),
        degrees: new Uint32Array([1, 2, 3, 1, 1]),
        visualClasses: new Uint8Array([0, 1, 2, 0, 0]),
      },
      edges: {
        endpoints: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4]),
        visualClasses: new Uint8Array([0, 2, 1, 0]),
      },
    };
    nextEpoch.layout = {
      topologyHash: "topology:next",
      layoutEpochId: "layout:next",
      sequence: 2,
      positions: new Float32Array(15),
      continuityMask: new Uint8Array(5),
      settled: false,
    };
    nextEpoch.interaction = {
      selected: 4,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(5),
      pathEdges: new Uint8Array(4),
    };
    nextEpoch.projection.nodes = new Float32Array([
      100, 100, 0.8, 1,
      220, 180, 0.3, 1,
      340, 120, 0.6, 1,
      480, 240, 0.5, 0,
      520, 320, 0.4, 1,
    ]);

    const culled = cloneScene(nextEpoch);
    culled.projection.nodes = new Float32Array(culled.projection.nodes);
    culled.projection.nodes.fill(0);
    culled.interaction = {
      selected: -1,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(5),
      pathEdges: new Uint8Array(4),
    };

    const empty = cloneScene(base);
    empty.topology = {
      topologyHash: "topology:empty",
      layoutEpochId: "layout:empty",
      seed: 0,
      nodes: {
        identityKeys: new Uint32Array(0),
        seeds: new Uint32Array(0),
        groups: new Uint32Array(0),
        degrees: new Uint32Array(0),
        visualClasses: new Uint8Array(0),
      },
      edges: { endpoints: new Uint32Array(0), visualClasses: new Uint8Array(0) },
    };
    empty.layout = {
      topologyHash: "topology:empty",
      layoutEpochId: "layout:empty",
      sequence: 0,
      positions: new Float32Array(0),
      continuityMask: new Uint8Array(0),
      settled: true,
    };
    empty.interaction = {
      selected: -1,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(0),
      pathEdges: new Uint8Array(0),
    };
    empty.projection.nodes = new Float32Array(0);

    const cases = [
      { scene: base, labels: labelPlan(), options: { palette: palette(), profile: "overview" as const } },
      { scene: base, labels: labelPlan(), options: { palette: palette(), profile: "exploration" as const } },
      { scene: base, labels: labelPlan(), options: { palette: palette(), profile: "focus" as const } },
      { scene: base, labels: { placements: [], omittedRequired: [3] }, options: { palette: palette(), profile: "focus" as const } },
      { scene: base, labels: labelPlan(), options: { palette: recolored, profile: "focus" as const } },
      { scene: radiusOnly, labels: labelPlan(), options: { palette: recolored, profile: "focus" as const } },
      { scene: base, labels: labelPlan(), options: { palette: dark } },
      { scene: camera, labels: labelPlan(), options: { palette: dark } },
      { scene: interaction, labels: labelPlan(), options: { palette: dark } },
      { scene: layoutEpochOnly, labels: labelPlan(), options: { palette: dark } },
      { scene: nextEpoch, labels: labelPlan(), options: { palette: palette() } },
      { scene: culled, labels: { placements: [], omittedRequired: [] }, options: { palette: palette() } },
      { scene: empty, labels: { placements: [], omittedRequired: [] }, options: { palette: palette() } },
    ];

    for (const entry of cases) {
      const expected = createGraphPresentationPlan(entry.scene, entry.labels, entry.options);
      const actual = compiler.compile(entry.scene, entry.labels, entry.options);
      expect(actual).toEqual(expected);
    }
  });

  it("reuses bounded capacities across camera, interaction, theme, profile, and stable frames", () => {
    const compiler = new GraphPresentationCompiler();
    const firstScene = fixtureScene();
    const first = compiler.compile(firstScene, labelPlan(), { palette: palette() });
    const firstBuffers = presentationBuffers(first);
    const warm = compiler.stats();

    const cameraScene = cloneScene(firstScene);
    cameraScene.camera.distance = 620;
    cameraScene.projection.nodes = new Float32Array(cameraScene.projection.nodes);
    cameraScene.projection.nodes[0] = 104;
    compiler.compile(cameraScene, labelPlan(), { palette: palette() });

    const interactionScene = cloneScene(cameraScene);
    interactionScene.interaction = {
      selected: 0,
      pathTarget: 2,
      hovered: 1,
      pathNodes: new Uint8Array([1, 1, 1, 0]),
      pathEdges: new Uint8Array([1, 1, 0]),
    };
    compiler.compile(interactionScene, labelPlan(), { palette: palette(), profile: "focus" });
    const changedTheme = palette();
    changedTheme.accent = 0x734b9aff;
    compiler.compile(interactionScene, labelPlan(), { palette: changedTheme, profile: "overview" });
    compiler.compile(interactionScene, labelPlan(), { palette: changedTheme, profile: "overview" });

    const after = compiler.stats();
    expect(after.capacityGrowths).toBe(warm.capacityGrowths);
    expect(after.allocatedBytes).toBe(warm.allocatedBytes);
    expect(after.numericReuseHits).toBeGreaterThan(0);
    const latest = compiler.compile(interactionScene, labelPlan(), { palette: changedTheme, profile: "overview" });
    expect(presentationBuffers(latest)).toEqual(firstBuffers);
    expect(compiler.stats().residentCapacityBytes).toBe(compiler.stats().allocatedBytes);
  });

  it("grows typed capacities geometrically without exceeding twice the requested topology", () => {
    const compiler = new GraphPresentationCompiler();
    const scene = scaleScene(257, 513);
    const expected = createGraphPresentationPlan(scene, { placements: [], omittedRequired: [] }, { palette: palette() });
    const actual = compiler.compile(scene, { placements: [], omittedRequired: [] }, { palette: palette() });
    expect(actual).toEqual(expected);
    const warm = compiler.stats();
    expect(warm.nodeCapacity).toBe(512);
    expect(warm.edgeCapacity).toBe(1_024);
    expect(warm.nodeCapacity).toBeLessThan(scene.topology.nodes.seeds.length * 2);
    expect(warm.edgeCapacity).toBeLessThan(scene.topology.edges.visualClasses.length * 2);

    compiler.compile(scene, { placements: [], omittedRequired: [] }, { palette: palette() });
    expect(compiler.stats().capacityGrowths).toBe(warm.capacityGrowths);
    expect(compiler.stats().allocatedBytes).toBe(warm.allocatedBytes);
  });
});

function fixtureScene(): GraphSceneContract {
  const projectionNodes = new Float32Array([
    100, 100, 0.8, 1,
    220, 180, 0.3, 1,
    340, 120, 0.6, 1,
    480, 240, 0.5, 0,
  ]);
  return {
    topology: {
      topologyHash: "topology:fixture",
      layoutEpochId: "layout:fixture",
      seed: 7,
      nodes: {
        identityKeys: new Uint32Array([1, 0, 2, 0, 3, 0, 4, 0]),
        seeds: new Uint32Array([11, 22, 33, 44]),
        groups: new Uint32Array([0, 1, 2, 3]),
        degrees: new Uint32Array([1, 2, 2, 1]),
        visualClasses: new Uint8Array([0, 1, 2, 0]),
      },
      edges: {
        endpoints: new Uint32Array([0, 1, 1, 2, 2, 3]),
        visualClasses: new Uint8Array([0, 2, 1]),
      },
    },
    layout: {
      topologyHash: "topology:fixture",
      layoutEpochId: "layout:fixture",
      sequence: 1,
      positions: new Float32Array(12),
      continuityMask: new Uint8Array(4),
      settled: true,
    },
    interaction: {
      selected: 1,
      pathTarget: 2,
      hovered: -1,
      pathNodes: new Uint8Array([0, 1, 1, 0]),
      pathEdges: new Uint8Array([0, 1, 0]),
    },
    camera: { ...DEFAULT_SCENE_CAMERA },
    projection: {
      nodes: projectionNodes,
      viewport: { width: 800, height: 600 },
      pickIndex: buildGraphPickIndex(projectionNodes, { width: 800, height: 600 }),
    },
  };
}

function labelPlan(): GraphLabelPlan {
  return {
    placements: [
      { index: 1, text: "Alpha", x: 230, y: 180, depth: 0.3, required: true, box: { left: 228, top: 166, right: 270, bottom: 184 } },
      { index: 2, text: "Beta", x: 350, y: 120, depth: 0.6, required: false, box: { left: 348, top: 106, right: 385, bottom: 124 } },
    ],
    omittedRequired: [],
  };
}

function palette(): GraphPresentationPalette {
  return {
    clearColor: null,
    text: 0x202522ff,
    muted: 0x8f9792ff,
    accent: 0x3f7d72ff,
    path: 0xbf6840ff,
    unresolved: 0xbf6840ff,
    external: 0x78699cff,
    nodeColors: new Uint32Array([0x3f7d72ff, 0xbf6840ff, 0x78699cff, 0x8a7b4eff]),
  };
}

function cloneScene(scene: GraphSceneContract): GraphSceneContract {
  return {
    ...scene,
    topology: scene.topology,
    layout: { ...scene.layout },
    interaction: { ...scene.interaction },
    camera: { ...scene.camera, target: [...scene.camera.target] },
    projection: { ...scene.projection, viewport: { ...scene.projection.viewport } },
  };
}

function presentationBuffers(plan: ReturnType<typeof createGraphPresentationPlan>): ArrayBufferLike[] {
  return [
    plan.nodes.indices.buffer,
    plan.nodes.centers.buffer,
    plan.nodes.depths.buffer,
    plan.nodes.visualClasses.buffer,
    plan.nodes.radii.buffer,
    plan.nodes.opacities.buffer,
    plan.nodes.fillColors.buffer,
    plan.nodes.strokeColors.buffer,
    plan.nodes.strokeWidths.buffer,
    plan.nodes.strokeOpacities.buffer,
    plan.nodes.emphasis.buffer,
    plan.edges.indices.buffer,
    plan.edges.curves.buffer,
    plan.edges.depths.buffer,
    plan.edges.visualClasses.buffer,
    plan.edges.widths.buffer,
    plan.edges.opacities.buffer,
    plan.edges.strokeColors.buffer,
    plan.edges.emphasis.buffer,
  ];
}

function scaleScene(nodeCount: number, edgeCount: number): GraphSceneContract {
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const visualClasses = new Uint8Array(nodeCount);
  const projection = new Float32Array(nodeCount * 4);
  for (let index = 0; index < nodeCount; index += 1) {
    identityKeys[index * 2] = index;
    seeds[index] = index;
    groups[index] = index % 8;
    degrees[index] = 4;
    projection[index * 4] = index % 800;
    projection[index * 4 + 1] = (index * 7) % 600;
    projection[index * 4 + 2] = (index % 100) / 100;
    projection[index * 4 + 3] = 1;
  }
  const endpoints = new Uint32Array(edgeCount * 2);
  const edgeClasses = new Uint8Array(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    endpoints[index * 2] = index % nodeCount;
    endpoints[index * 2 + 1] = (index * 5 + 1) % nodeCount;
  }
  const topologyHash = `topology:${nodeCount}:${edgeCount}`;
  const layoutEpochId = `layout:${nodeCount}:${edgeCount}`;
  return {
    topology: {
      topologyHash,
      layoutEpochId,
      seed: 1,
      nodes: { identityKeys, seeds, groups, degrees, visualClasses },
      edges: { endpoints, visualClasses: edgeClasses },
    },
    layout: {
      topologyHash,
      layoutEpochId,
      sequence: 1,
      positions: new Float32Array(nodeCount * 3),
      continuityMask: new Uint8Array(nodeCount),
      settled: true,
    },
    interaction: {
      selected: -1,
      pathTarget: -1,
      hovered: -1,
      pathNodes: new Uint8Array(nodeCount),
      pathEdges: new Uint8Array(edgeCount),
    },
    camera: { ...DEFAULT_SCENE_CAMERA },
    projection: {
      nodes: projection,
      viewport: { width: 800, height: 600 },
      pickIndex: buildGraphPickIndex(projection, { width: 800, height: 600 }),
    },
  };
}
