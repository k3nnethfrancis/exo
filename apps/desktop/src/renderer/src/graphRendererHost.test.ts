import { describe, expect, it, vi } from "vitest";

import type { GraphPresentationPlan } from "./graphPresentation";
import {
  GraphRendererHost,
  type GraphPixelRenderer,
  type GraphPixelRendererMeasurement,
  type GraphRendererFrame,
} from "./graphRendererHost";
import type { GraphGpuRuntime } from "./graphWebGpuRenderer";

describe("graph renderer recovery host", () => {
  it("boots Canvas when actual-runtime WebGPU capability is unavailable", async () => {
    const canvas = new MockRenderer();
    const createWebGpu = vi.fn();
    const frame = recoveryFrame();
    const host = new GraphRendererHost<RecoveryState>({
      webGpuRuntime: null,
      createWebGpu,
      createCanvas: () => canvas,
    });
    host.resize({ width: 640, height: 420, dpr: 2 });
    host.render(frame);

    await expect(host.start()).resolves.toBe("canvas2d");

    expect(createWebGpu).not.toHaveBeenCalled();
    expect(host.kind).toBe("canvas2d");
    expect(canvas.viewports).toEqual([{ width: 640, height: 420, dpr: 2 }]);
    expect(canvas.plans).toEqual([frame.plan]);
    expect(host.frame).toBe(frame);
  });

  it("recreates WebGPU once and preserves exact camera, selection, path, layout, and detail identity", async () => {
    const gpuRenderers: MockRenderer[] = [];
    const transitions: unknown[] = [];
    const frame = recoveryFrame();
    const host = new GraphRendererHost<RecoveryState>({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        const renderer = new MockRenderer(failure);
        gpuRenderers.push(renderer);
        return renderer;
      },
      createCanvas: () => new MockRenderer(),
      onTransition: (transition) => transitions.push(transition),
    });
    host.resize({ width: 800, height: 600, dpr: 2 });
    host.render(frame);
    await host.start();

    gpuRenderers[0]!.fail(new Error("lost"));
    await host.settled();

    expect(host.kind).toBe("webgpu");
    expect(gpuRenderers).toHaveLength(2);
    expect(gpuRenderers[0]!.destroyCalls).toBe(1);
    expect(gpuRenderers[1]!.plans).toEqual([frame.plan]);
    expect(gpuRenderers[1]!.viewports).toEqual([{ width: 800, height: 600, dpr: 2 }]);
    expect(host.frame).toBe(frame);
    expect(host.frame!.state).toBe(frame.state);
    expect(host.frame!.state.camera).toBe(frame.state.camera);
    expect(host.frame!.state.selection).toBe(frame.state.selection);
    expect(host.frame!.state.path).toBe(frame.state.path);
    expect(host.frame!.state.layout).toBe(frame.state.layout);
    expect(host.frame!.state.detail).toBe(frame.state.detail);
    expect(host.snapshot()).toMatchObject({
      kind: "webgpu",
      transitionReason: "recreated",
      recoveryState: "ready",
      transitions: 2,
      failures: 1,
      recreationAttempts: 1,
      fallbacks: 0,
    });
    expect(transitions).toEqual([
      expect.objectContaining({ kind: "webgpu", reason: "boot", frame }),
      expect.objectContaining({ kind: "webgpu", reason: "recreated", frame }),
    ]);
  });

  it("falls back to Canvas when the single WebGPU recreation fails", async () => {
    const first = new MockRenderer();
    const canvas = new MockRenderer();
    let calls = 0;
    const frame = recoveryFrame();
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        calls += 1;
        if (calls === 2) throw new Error("replacement failed");
        first.failure = failure;
        return first;
      },
      createCanvas: () => canvas,
    });
    host.render(frame);
    await host.start();

    first.fail(new Error("device lost"));
    await host.settled();

    expect(calls).toBe(2);
    expect(host.kind).toBe("canvas2d");
    expect(first.destroyCalls).toBe(1);
    expect(canvas.plans).toEqual([frame.plan]);
    expect(host.frame).toBe(frame);
    expect(host.snapshot()).toMatchObject({
      transitionReason: "recovery-fallback",
      recoveryState: "fallback",
      failures: 1,
      recreationAttempts: 1,
      fallbacks: 1,
    });
  });

  it("falls back to Canvas when initial WebGPU creation or shader setup fails", async () => {
    const canvas = new MockRenderer();
    const errors: Error[] = [];
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async () => { throw new Error("shader compilation failed"); },
      createCanvas: () => canvas,
      onError: (error) => errors.push(error),
    });

    await expect(host.start()).resolves.toBe("canvas2d");

    expect(host.kind).toBe("canvas2d");
    expect(errors).toContainEqual(expect.objectContaining({ message: "shader compilation failed" }));
  });

  it("does not start a second recovery when render fails during a pending recreation", async () => {
    const replacement = deferred<MockRenderer>();
    const first = new MockRenderer();
    let createCalls = 0;
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        createCalls += 1;
        if (createCalls === 1) {
          first.failure = failure;
          return first;
        }
        const renderer = await replacement.promise;
        renderer.failure = failure;
        return renderer;
      },
      createCanvas: () => new MockRenderer(),
    });
    await host.start();

    first.fail(new Error("device lost"));
    first.throwOnRender = new Error("draw after loss");
    host.render(recoveryFrame());
    expect(createCalls).toBe(2);

    replacement.resolve(new MockRenderer());
    await host.settled();
    expect(createCalls).toBe(2);
    expect(host.kind).toBe("webgpu");
  });

  it("destroys a renderer returned after teardown without activating or transitioning", async () => {
    const pending = deferred<MockRenderer>();
    const transitions: unknown[] = [];
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async () => pending.promise,
      createCanvas: () => new MockRenderer(),
      onTransition: (transition) => transitions.push(transition),
    });
    const start = host.start();
    host.destroy();
    const lateRenderer = new MockRenderer();
    pending.resolve(lateRenderer);

    await expect(start).rejects.toMatchObject({ code: "destroyed" });
    expect(lateRenderer.destroyCalls).toBe(1);
    expect(transitions).toEqual([]);
    expect(host.kind).toBeNull();
  });

  it("rejects late callbacks from lost generations", async () => {
    const renderers: MockRenderer[] = [];
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        const renderer = new MockRenderer(failure);
        renderers.push(renderer);
        return renderer;
      },
      createCanvas: () => new MockRenderer(),
    });
    await host.start();
    renderers[0]!.fail(new Error("first loss"));
    await host.settled();
    const generation = host.generation;

    renderers[0]!.fail(new Error("late old callback"));
    await host.settled();

    expect(renderers).toHaveLength(2);
    expect(host.kind).toBe("webgpu");
    expect(host.generation).toBe(generation);
  });

  it("falls back after the recreated WebGPU generation fails", async () => {
    const renderers: MockRenderer[] = [];
    const canvas = new MockRenderer();
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        const renderer = new MockRenderer(failure);
        renderers.push(renderer);
        return renderer;
      },
      createCanvas: () => canvas,
    });
    await host.start();
    renderers[0]!.fail(new Error("first loss"));
    await host.settled();
    renderers[1]!.fail(new Error("second loss"));
    await host.settled();

    expect(host.kind).toBe("canvas2d");
    expect(renderers).toHaveLength(2);
    expect(renderers.every((renderer) => renderer.destroyCalls === 1)).toBe(true);
  });

  it("destroys deterministically and ignores callbacks after teardown", async () => {
    const renderer = new MockRenderer();
    const host = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        renderer.failure = failure;
        return renderer;
      },
      createCanvas: () => new MockRenderer(),
    });
    await host.start();
    host.destroy();
    host.destroy();
    renderer.fail(new Error("late"));

    expect(renderer.destroyCalls).toBe(1);
    expect(host.kind).toBeNull();
    expect(host.frame).toBeNull();
    expect(() => host.render(recoveryFrame())).toThrow("destroyed");
  });

  it("surfaces an explicit error when no renderer can start or recover", async () => {
    const boot = new GraphRendererHost({
      webGpuRuntime: null,
      createWebGpu: async () => new MockRenderer(),
      createCanvas: () => { throw new Error("no canvas"); },
    });
    await expect(boot.start()).rejects.toMatchObject({ code: "canvas-unavailable" });

    const active = new MockRenderer();
    const errors: Error[] = [];
    let gpuCalls = 0;
    const recovery = new GraphRendererHost({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async (_runtime, failure) => {
        gpuCalls += 1;
        if (gpuCalls > 1) throw new Error("no second gpu");
        active.failure = failure;
        return active;
      },
      createCanvas: () => { throw new Error("no canvas"); },
      onError: (error) => errors.push(error),
    });
    await recovery.start();
    active.fail(new Error("lost"));
    await recovery.settled();

    expect(recovery.kind).toBeNull();
    expect(errors).toContainEqual(expect.objectContaining({ code: "recovery-failed" }));
    expect(recovery.snapshot().recoveryState).toBe("failed");
  });

  it("exposes a controlled fallback transition without replacing retained CPU state", async () => {
    const gpu = new MockRenderer();
    const canvas = new MockRenderer();
    const frame = recoveryFrame();
    const host = new GraphRendererHost<RecoveryState>({
      webGpuRuntime: fakeRuntime(),
      createWebGpu: async () => gpu,
      createCanvas: () => canvas,
    });
    host.render(frame);
    await host.start();

    await host.forceCanvasFallbackForTesting();

    expect(host.kind).toBe("canvas2d");
    expect(host.frame).toBe(frame);
    expect(host.frame!.state).toBe(frame.state);
    expect(canvas.plans).toEqual([frame.plan]);
    expect(host.snapshot()).toMatchObject({ transitionReason: "recovery-fallback", fallbacks: 1 });
  });
});

class MockRenderer implements GraphPixelRenderer {
  plans: GraphPresentationPlan[] = [];
  viewports: Array<{ width: number; height: number; dpr: number }> = [];
  destroyCalls = 0;
  throwOnRender: Error | null = null;

  constructor(public failure: ((error: Error) => void) | null = null) {}
  resize(viewport: { width: number; height: number; dpr: number }) { this.viewports.push({ ...viewport }); }
  render(plan: GraphPresentationPlan): GraphPixelRendererMeasurement {
    if (this.throwOnRender) throw this.throwOnRender;
    this.plans.push(plan);
    return { cpuMilliseconds: 0, drawCalls: 0, nodes: plan.nodes.indices.length, edges: plan.edges.indices.length, width: plan.viewport.width, height: plan.viewport.height, dpr: 1 };
  }
  destroy() { this.destroyCalls += 1; }
  fail(error: Error) { this.failure?.(error); }
}

interface RecoveryState {
  camera: object;
  selection: object;
  path: object;
  layout: object;
  detail: object;
}

function recoveryFrame(): GraphRendererFrame<RecoveryState> {
  return {
    plan: emptyPlan(),
    state: {
      camera: { yaw: 0.3, pitch: -0.1, distance: 720 },
      selection: { index: 4 },
      path: { indices: new Uint32Array([4, 8]) },
      layout: { epoch: "layout:stable", positions: new Float32Array([1, 2, 3]) },
      detail: { conceptId: "concept:4" },
    },
  };
}

function emptyPlan(): GraphPresentationPlan {
  return {
    version: "0.1",
    topologyHash: "topology:stable",
    layoutEpochId: "layout:stable",
    viewport: { width: 800, height: 600 },
    profile: "exploration",
    clearColor: null,
    nodes: {
      indices: new Uint32Array(0), centers: new Float32Array(0), depths: new Float32Array(0),
      visualClasses: new Uint8Array(0), radii: new Float32Array(0), opacities: new Float32Array(0),
      fillColors: new Uint32Array(0), strokeColors: new Uint32Array(0), strokeWidths: new Float32Array(0),
      strokeOpacities: new Float32Array(0), emphasis: new Uint8Array(0),
    },
    edges: {
      indices: new Uint32Array(0), curves: new Float32Array(0), depths: new Float32Array(0),
      visualClasses: new Uint8Array(0), widths: new Float32Array(0), opacities: new Float32Array(0),
      strokeColors: new Uint32Array(0), emphasis: new Uint8Array(0),
    },
    labels: { placements: [], omittedRequired: [] },
    labelStyle: { font: "11px monospace", requiredFont: "600 11px monospace", color: 0, requiredColor: 0, opacity: 1 },
  };
}

function fakeRuntime(): GraphGpuRuntime {
  return {
    gpu: { requestAdapter: async () => null, getPreferredCanvasFormat: () => "bgra8unorm" },
    bufferUsage: { copyDestination: 8, uniform: 64, storage: 128 },
    shaderStage: { vertex: 1, fragment: 2 },
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => { resolve = settle; });
  return { promise, resolve };
}
