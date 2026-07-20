import { describe, expect, it } from "vitest";
import { cpus } from "node:os";

import { GraphCanvasRenderer, type GraphCanvasContext, type GraphCanvasSurface } from "./graphCanvasRenderer";
import type { GraphSceneContract } from "./graphSceneFoundation";
import { createGraphPresentationPlan } from "./graphPresentation";

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
      const planSamples: number[] = [];
      const adapterSamples: number[] = [];
      let plan = createGraphPresentationPlan(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
      let render = renderer.render(plan);
      for (let iteration = 0; iteration < 33; iteration += 1) {
        context.reset();
        const planStarted = performance.now();
        plan = createGraphPresentationPlan(scene, { placements: [], omittedRequired: [] }, { profile: "overview", palette: palette() });
        const planMilliseconds = performance.now() - planStarted;
        render = renderer.render(plan);
        if (iteration < 3) continue;
        planSamples.push(planMilliseconds);
        adapterSamples.push(render.cpuMilliseconds);
      }

      expect(plan.nodes.indices).toHaveLength(scale.nodes);
      expect(plan.edges.indices).toHaveLength(scale.edges);
      expect(context.curves).toBe(scale.edges);
      expect(context.arcs).toBe(scale.nodes);
      expect(render.drawCalls).toBeLessThanOrEqual(16);
      expect(planSamples).toHaveLength(30);
      expect(adapterSamples).toHaveLength(30);
      expect(planSamples.every(Number.isFinite)).toBe(true);
      expect(adapterSamples.every(Number.isFinite)).toBe(true);
      console.info("graph-canvas-measurement", {
        ...scale,
        hardware: {
          cpu: cpus()[0]?.model ?? "unknown",
          platform: process.platform,
          architecture: process.arch,
          node: process.version,
        },
        warmedRuns: 30,
        planMilliseconds: distribution(planSamples),
        adapterMilliseconds: distribution(adapterSamples),
        drawCalls: render.drawCalls,
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
