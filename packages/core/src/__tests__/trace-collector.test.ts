import { describe, expect, it } from "vitest";

import type { ActivityTracePacket } from "../run";
import { TraceCollectorRegistry, type TraceCollector } from "../trace-collector";

const tracePacket: ActivityTracePacket = {
  id: "trace-1",
  activityId: "activity-1",
  kind: "decision",
  timestamp: "2026-06-14T00:00:00.000Z",
  actor: "alignment-auditor",
  private: true,
  evidence: [],
  payload: {
    autonomyBoundary: "ask",
  },
};

const testCollector: TraceCollector = {
  metadata: {
    id: "alignment-trace-collector",
    kind: "exo.training:traceCollector",
    label: "Alignment Trace Collector",
    description: "Test trace collector.",
    lifecycle: "experimental",
    owner: "@exo/core/test",
    surfaces: ["internal"],
    permissions: ["artifacts:write"],
  },
  async collect(packet, context) {
    if (packet.activityId !== context.activityId) {
      throw new Error(`Trace packet activityId mismatch: ${packet.activityId} !== ${context.activityId}`);
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

  it("lets collectors validate trace packet activity context", async () => {
    await expect(testCollector.collect(tracePacket, { activityId: "activity-1" })).resolves.toEqual(tracePacket);
    await expect(testCollector.collect(tracePacket, { activityId: "other-activity" })).rejects.toThrow("activityId mismatch");
  });
});
