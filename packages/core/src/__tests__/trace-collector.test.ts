import { describe, expect, it } from "vitest";

import type { RunTracePacket } from "../run";
import { TraceCollectorRegistry, type TraceCollector } from "../trace-collector";

const tracePacket: RunTracePacket = {
  id: "trace-1",
  runId: "run-1",
  kind: "decision",
  timestamp: "2026-06-14T00:00:00.000Z",
  actor: "alignment-routine",
  private: true,
  evidence: [],
  payload: {
    autonomyBoundary: "ask",
  },
};

const testCollector: TraceCollector = {
  metadata: {
    id: "alignment-trace-collector",
    kind: "traceCollector",
    label: "Alignment Trace Collector",
    description: "Test trace collector.",
    lifecycle: "experimental",
    owner: "@exo/core/test",
    surfaces: ["internal"],
    permissions: ["artifacts:write"],
  },
  async collect(packet, context) {
    if (packet.runId !== context.runId) {
      throw new Error(`Trace packet runId mismatch: ${packet.runId} !== ${context.runId}`);
    }
    return packet;
  },
};

describe("trace collector contracts", () => {
  it("registers and resolves trace collectors", () => {
    const registry = new TraceCollectorRegistry([testCollector]);

    expect(registry.list().map((collector) => collector.metadata.id)).toEqual(["alignment-trace-collector"]);
    expect(registry.require("alignment-trace-collector")).toBe(testCollector);
  });

  it("rejects duplicate trace collector ids", () => {
    const registry = new TraceCollectorRegistry([testCollector]);

    expect(() => registry.register(testCollector)).toThrow("Trace collector already registered: alignment-trace-collector");
  });

  it("lets collectors validate trace packet run context", async () => {
    await expect(testCollector.collect(tracePacket, { runId: "run-1", routineId: "routine-1" })).resolves.toEqual(tracePacket);
    await expect(testCollector.collect(tracePacket, { runId: "other-run" })).rejects.toThrow("runId mismatch");
  });
});
