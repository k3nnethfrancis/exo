import { describe, expect, it } from "vitest";

import type { GraphTopology } from "@exo/core";

import { createDeterministicLayout, createGraphLayoutInput, type GraphTopologyArrays } from "./graphSceneFoundation";
import {
  GraphLayoutWorkerController,
  type GraphLayoutTaskScheduler,
  type GraphLayoutWorkerResponse,
} from "./graphLayoutWorkerProtocol";

class FakeTaskScheduler implements GraphLayoutTaskScheduler {
  private nextHandle = 1;
  readonly callbacks = new Map<number, () => void>();

  schedule(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  flushOne(): boolean {
    const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return false;
    this.callbacks.delete(entry[0]);
    entry[1]();
    return true;
  }

  flushAll(limit = 1_000): number {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error("worker failed to become quiescent");
    }
    return count;
  }
}

class UncancellableTaskScheduler extends FakeTaskScheduler {
  override cancel(): void {
    // Models a callback already queued by the host. The controller token must
    // still reject it after reinitialization.
  }
}

function input(nodeCount = 24, edgeCount = 48) {
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const endpoints = new Uint32Array(edgeCount * 2);
  for (let node = 0; node < nodeCount; node += 1) {
    identityKeys[node * 2] = node + 1;
    identityKeys[node * 2 + 1] = 7;
    seeds[node] = Math.imul(node + 1, 0x9e3779b1) >>> 0;
    groups[node] = node % 4;
  }
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = edge % nodeCount;
    let target = (edge * 7 + 3) % nodeCount;
    if (target === source) target = (target + 1) % nodeCount;
    endpoints[edge * 2] = source;
    endpoints[edge * 2 + 1] = target;
    degrees[source] += 1;
    degrees[target] += 1;
  }
  const graph = {
    topologyHash: "worker-topology",
    layoutEpochId: "worker-layout",
    seed: 17,
    nodes: { identityKeys, seeds, groups, degrees, visualClasses: new Uint8Array(nodeCount) },
    edges: { endpoints, visualClasses: new Uint8Array(edgeCount) },
  } as Pick<GraphTopology, "topologyHash" | "layoutEpochId" | "seed" | "nodes" | "edges"> as GraphTopologyArrays;
  return createGraphLayoutInput(graph, createDeterministicLayout(graph));
}

describe("GraphLayoutWorkerController", () => {
  it("emits one deterministic terminal frame and performs zero work after settle", () => {
    const scheduler = new FakeTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response), { iterationsPerTask: 16 });
    controller.handle({ type: "init", generation: 1, input: input() });
    expect(scheduler.callbacks.size).toBe(1);
    scheduler.flushAll();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ type: "frame", generation: 1, terminal: true, converged: true });
    const settled = controller.snapshot();
    expect(settled).toMatchObject({ pending: false, emittedFrames: 1, emittedErrors: 0 });
    expect(scheduler.callbacks.size).toBe(0);
    scheduler.flushAll();
    expect(controller.snapshot()).toEqual(settled);
    expect(responses).toHaveLength(1);
  });

  it("emits a finite non-converged terminal frame at the deterministic cap", () => {
    const scheduler = new FakeTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response), {
      iterationsPerTask: 8,
      maximumIterations: 17,
    });
    controller.handle({ type: "init", generation: 1, input: input() });
    scheduler.flushAll();
    expect(responses).toHaveLength(1);
    const response = responses[0];
    expect(response).toMatchObject({ type: "frame", terminal: true, converged: false, iterations: 17 });
    if (response?.type !== "frame") throw new Error("expected terminal frame");
    expect([...response.frame.positions].every(Number.isFinite)).toBe(true);
    expect(controller.snapshot()).toMatchObject({ pending: false, emittedFrames: 1, emittedErrors: 0 });
  });

  it("cancels prior generations, ignores stale messages, and supports dispose then reinit", () => {
    const scheduler = new FakeTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response), { iterationsPerTask: 32 });
    controller.handle({ type: "init", generation: 2, input: input() });
    controller.handle({ type: "init", generation: 1, input: input() });
    expect(controller.snapshot().ignoredMessages).toBe(1);
    controller.handle({ type: "dispose", generation: 3 });
    expect(scheduler.callbacks.size).toBe(0);
    expect(controller.snapshot()).toMatchObject({ activeGeneration: 3, disposed: true, pending: false });
    controller.handle({ type: "init", generation: 4, input: input() });
    expect(controller.snapshot()).toMatchObject({ activeGeneration: 4, disposed: false, pending: true });
    scheduler.flushAll();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ type: "frame", generation: 4 });
  });

  it("ignores a stale layout epoch even when its queued host callback cannot be cancelled", () => {
    const scheduler = new UncancellableTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response), { iterationsPerTask: 32 });
    controller.handle({
      type: "init",
      generation: 1,
      input: { ...input(), topologyHash: "old-topology", layoutEpochId: "old-layout" },
    });
    controller.handle({
      type: "init",
      generation: 2,
      input: { ...input(), topologyHash: "new-topology", layoutEpochId: "new-layout" },
    });
    expect(scheduler.callbacks.size).toBe(2);
    scheduler.flushAll();
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      type: "frame",
      generation: 2,
      frame: { topologyHash: "new-topology", layoutEpochId: "new-layout" },
    });
  });

  it("reports malformed input once and schedules no task", () => {
    const scheduler = new FakeTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response));
    controller.handle({
      type: "init",
      generation: 1,
      input: { ...input(), initialPositions: new Float32Array([Number.NaN]) },
    });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ type: "error", generation: 1, code: "invalid-input" });
    expect(controller.snapshot()).toMatchObject({ pending: false, emittedFrames: 0, emittedErrors: 1 });
    expect(scheduler.callbacks.size).toBe(0);
  });

  it("rejects invalid generations without disturbing active work", () => {
    const scheduler = new FakeTaskScheduler();
    const responses: GraphLayoutWorkerResponse[] = [];
    const controller = new GraphLayoutWorkerController(scheduler, (response) => responses.push(response));
    controller.handle({ type: "init", generation: -1, input: input() });
    expect(responses[0]).toMatchObject({ type: "error", code: "invalid-generation" });
    expect(controller.snapshot()).toMatchObject({ activeGeneration: -1, pending: false });
  });
});
