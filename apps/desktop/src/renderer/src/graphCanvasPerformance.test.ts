import { describe, expect, it } from "vitest";
import { cpus } from "node:os";

import { GraphCanvasRenderer, type GraphCanvasContext, type GraphCanvasSurface } from "./graphCanvasRenderer";
import type { GraphSceneContract } from "./graphSceneFoundation";
import { GraphPresentationCompiler, createGraphPresentationPlan, type GraphPresentationPlan } from "./graphPresentation";

describe("Canvas plan and draw-call scale measurements", () => {
  for (const scale of [
    { nodes: 10_000, edges: 50_000 },
    { nodes: 50_000, edges: 250_000 },
  ]) {
    it(`measures ${scale.nodes.toLocaleString()} nodes and ${scale.edges.toLocaleString()} edges without an FPS claim`, () => {
      const scene = scaleScene(scale.nodes, scale.edges);
      const context = new CountingContext();
      const renderer = new GraphCanvasRenderer(surface(context));
      renderer.resize({ width: 1440, height: 900, dpr: 2 });
      const pureSamples: number[] = [];
      const cameraSamples: number[] = [];
      const interactionSamples: number[] = [];
      const stableSamples: number[] = [];
      const adapterSamples: number[] = [];
      const compiler = new GraphPresentationCompiler();
      const cameraScene = alternateProjection(scene);
      const selectedScene = alternateInteraction(scene, 0);
      const pathScene = alternateInteraction(scene, 1);
      let plan = createGraphPresentationPlan(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
      let render = renderer.render(plan);
      for (let iteration = 0; iteration < 33; iteration += 1) {
        context.reset();
        const planStarted = performance.now();
        plan = createGraphPresentationPlan(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
        const planMilliseconds = performance.now() - planStarted;
        render = renderer.render(plan);
        if (iteration < 3) continue;
        pureSamples.push(planMilliseconds);
        adapterSamples.push(render.cpuMilliseconds);
      }

      compiler.compile(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
      const warmStats = compiler.stats();
      const stableBuffers = presentationBuffers(compiler.compile(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() }));
      measureCompiler(compiler, [scene, cameraScene], cameraSamples);
      measureCompiler(compiler, [selectedScene, pathScene], interactionSamples);
      compiler.compile(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
      measureCompiler(compiler, [scene], stableSamples);
      const finalPlan = compiler.compile(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
      const finalStats = compiler.stats();
      const pureDistribution = distribution(pureSamples);
      const cameraDistribution = distribution(cameraSamples);
      const interactionDistribution = distribution(interactionSamples);
      const stableDistribution = distribution(stableSamples);
      const adapterDistribution = distribution(adapterSamples);
      const cpu = cpus()[0]?.model ?? "unknown";

      expect(plan.nodes.indices).toHaveLength(scale.nodes);
      expect(plan.edges.indices).toHaveLength(scale.edges);
      expect(context.curves).toBe(scale.edges);
      expect(context.arcs).toBe(scale.nodes);
      expect(render.drawCalls).toBeLessThanOrEqual(16);
      expect(pureSamples).toHaveLength(30);
      expect(cameraSamples).toHaveLength(30);
      expect(interactionSamples).toHaveLength(30);
      expect(stableSamples).toHaveLength(30);
      expect(adapterSamples).toHaveLength(30);
      expect(pureSamples.every(Number.isFinite)).toBe(true);
      expect(cameraSamples.every(Number.isFinite)).toBe(true);
      expect(interactionSamples.every(Number.isFinite)).toBe(true);
      expect(stableSamples.every(Number.isFinite)).toBe(true);
      expect(adapterSamples.every(Number.isFinite)).toBe(true);
      expect(finalStats.capacityGrowths).toBe(warmStats.capacityGrowths);
      expect(finalStats.allocatedBytes).toBe(warmStats.allocatedBytes);
      expect(presentationBuffers(finalPlan)).toEqual(stableBuffers);
      if (scale.nodes === 50_000 && cpu === "Apple M2 Max" && process.arch === "arm64") {
        expect(cameraDistribution.p95).toBeLessThan(16.7);
      }
      console.info("graph-canvas-measurement", {
        ...scale,
        hardware: {
          cpu,
          platform: process.platform,
          architecture: process.arch,
          node: process.version,
        },
        warmedRuns: 30,
        purePlanMilliseconds: pureDistribution,
        compiledCameraMilliseconds: cameraDistribution,
        compiledInteractionMilliseconds: interactionDistribution,
        compiledStableMilliseconds: stableDistribution,
        adapterMilliseconds: adapterDistribution,
        drawCalls: render.drawCalls,
        compiler: {
          nodeCapacity: finalStats.nodeCapacity,
          edgeCapacity: finalStats.edgeCapacity,
          residentCapacityBytes: finalStats.residentCapacityBytes,
          capacityGrowths: finalStats.capacityGrowths,
          capacityGrowthsDuringMeasuredFrames: finalStats.capacityGrowths - warmStats.capacityGrowths,
          allocatedBytesDuringMeasuredFrames: finalStats.allocatedBytes - warmStats.allocatedBytes,
          orderRebuilds: finalStats.orderRebuilds,
          geometryRebuilds: finalStats.geometryRebuilds,
          numericReuseHits: finalStats.numericReuseHits,
        },
      });
    }, 30_000);
  }
});

class CountingContext implements GraphCanvasContext {
  fillStyle = "";
  strokeStyle = "";
  font = "";
  globalAlpha = 1;
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  textBaseline: CanvasTextBaseline = "alphabetic";
  imageSmoothingEnabled = false;
  curves = 0;
  arcs = 0;
  reset() { this.curves = 0; this.arcs = 0; }
  setTransform() {}
  clearRect() {}
  fillRect() {}
  beginPath() {}
  moveTo() {}
  quadraticCurveTo() { this.curves += 1; }
  arc() { this.arcs += 1; }
  fill() {}
  stroke() {}
  fillText() {}
}

function measureCompiler(
  compiler: GraphPresentationCompiler,
  scenes: readonly GraphSceneContract[],
  samples: number[],
): void {
  for (let iteration = 0; iteration < 33; iteration += 1) {
    const scene = scenes[iteration % scenes.length] ?? scenes[0]!;
    const started = performance.now();
    compiler.compile(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
    const milliseconds = performance.now() - started;
    if (iteration >= 3) samples.push(milliseconds);
  }
}

function distribution(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) => sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)] ?? 0;
  return {
    p50: Number(percentile(0.5).toFixed(2)),
    p95: Number(percentile(0.95).toFixed(2)),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
  };
}

function surface(context: GraphCanvasContext): GraphCanvasSurface {
  return { width: 1, height: 1, getContext: () => context };
}

function scaleScene(nodeCount: number, edgeCount: number): GraphSceneContract {
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount).fill(10);
  const visualClasses = new Uint8Array(nodeCount);
  const projection = new Float32Array(nodeCount * 4);
  for (let index = 0; index < nodeCount; index += 1) {
    identityKeys[index * 2] = index;
    identityKeys[index * 2 + 1] = 17;
    seeds[index] = index;
    groups[index] = index % 8;
    projection[index * 4] = (index * 37) % 1440;
    projection[index * 4 + 1] = (index * 53) % 900;
    projection[index * 4 + 2] = (index % 1000) / 1000;
    projection[index * 4 + 3] = 1;
  }
  const endpoints = new Uint32Array(edgeCount * 2);
  const edgeClasses = new Uint8Array(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    endpoints[index * 2] = index % nodeCount;
    endpoints[index * 2 + 1] = (index * 7 + 1) % nodeCount;
  }
  return {
    topology: {
      topologyHash: `topology:${nodeCount}:${edgeCount}`,
      layoutEpochId: `layout:${nodeCount}:${edgeCount}`,
      seed: 1,
      nodes: { identityKeys, seeds, groups, degrees, visualClasses },
      edges: { endpoints, visualClasses: edgeClasses },
    },
    layout: {
      topologyHash: `topology:${nodeCount}:${edgeCount}`,
      layoutEpochId: `layout:${nodeCount}:${edgeCount}`,
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
    camera: { yaw: 0, pitch: 0, distance: 760, target: [0, 0, 0], fov: Math.PI / 4.2, near: 0.1, far: 50_000 },
    projection: {
      nodes: projection,
      viewport: { width: 1440, height: 900 },
      pickIndex: { cellSize: 48, columns: 1, rows: 1, offsets: new Uint32Array(2), nodeIndices: new Uint32Array(0) },
    },
  };
}

function alternateProjection(scene: GraphSceneContract): GraphSceneContract {
  const nodes = new Float32Array(scene.projection.nodes);
  for (let index = 0; index < nodes.length / 4; index += 1) {
    nodes[index * 4] = ((nodes[index * 4] ?? 0) + 17) % scene.projection.viewport.width;
    nodes[index * 4 + 1] = ((nodes[index * 4 + 1] ?? 0) + 11) % scene.projection.viewport.height;
    nodes[index * 4 + 2] = 1 - (nodes[index * 4 + 2] ?? 0);
  }
  return {
    ...scene,
    camera: { ...scene.camera, yaw: scene.camera.yaw + 0.04, distance: scene.camera.distance + 12 },
    projection: { ...scene.projection, nodes },
  };
}

function alternateInteraction(scene: GraphSceneContract, variant: number): GraphSceneContract {
  const nodeCount = scene.topology.nodes.seeds.length;
  const edgeCount = scene.topology.edges.visualClasses.length;
  const pathNodes = new Uint8Array(nodeCount);
  const pathEdges = new Uint8Array(edgeCount);
  const selected = variant % Math.max(1, nodeCount);
  const pathTarget = (variant + 17) % Math.max(1, nodeCount);
  pathNodes[selected] = 1;
  pathNodes[pathTarget] = 1;
  if (edgeCount > 0) pathEdges[variant % edgeCount] = 1;
  return {
    ...scene,
    interaction: { selected, pathTarget, hovered: (variant + 3) % Math.max(1, nodeCount), pathNodes, pathEdges },
  };
}

function presentationBuffers(plan: GraphPresentationPlan): ArrayBufferLike[] {
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

function palette() {
  return {
    clearColor: null,
    text: 0x202522ff,
    muted: 0x8f9792ff,
    accent: 0x3f7d72ff,
    path: 0xbf6840ff,
    unresolved: 0xbf6840ff,
    external: 0x78699cff,
    nodeColors: new Uint32Array([0x3f7d72ff, 0xbf6840ff, 0x78699cff, 0x8a7b4eff, 0x52779cff, 0x9b5f6cff, 0x65825bff, 0x8d684cff]),
  };
}
