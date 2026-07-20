import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCENE_CAMERA,
  buildGraphPickIndex,
  type GraphLabelPlan,
  type GraphSceneContract,
} from "./graphSceneFoundation";
import {
  GraphPresentationEmphasis,
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
