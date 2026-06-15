import { describe, expect, it } from "vitest";

import { guardianAngelTraceCollector } from "../guardian-angel";
import type { RunTracePacket } from "../run";
import { TraceCollectorRegistry } from "../trace-collector";

const tracePacket: RunTracePacket = {
  id: "trace-1",
  runId: "run-1",
  kind: "decision",
  timestamp: "2026-06-14T00:00:00.000Z",
  actor: "guardian-angel",
  private: true,
  evidence: [],
  payload: {
    autonomyBoundary: "ask",
  },
};

describe("trace collector contracts", () => {
  it("registers and resolves trace collectors", () => {
    const registry = new TraceCollectorRegistry([guardianAngelTraceCollector]);

    expect(registry.list().map((collector) => collector.metadata.id)).toEqual(["guardian-angel-trace-collector"]);
    expect(registry.require("guardian-angel-trace-collector")).toBe(guardianAngelTraceCollector);
  });

  it("rejects duplicate trace collector ids", () => {
    const registry = new TraceCollectorRegistry([guardianAngelTraceCollector]);

    expect(() => registry.register(guardianAngelTraceCollector)).toThrow("Trace collector already registered: guardian-angel-trace-collector");
  });

  it("validates Guardian Angel trace packet run context", async () => {
    await expect(guardianAngelTraceCollector.collect(tracePacket, { runId: "run-1", routineId: "routine-1" })).resolves.toEqual(tracePacket);
    await expect(guardianAngelTraceCollector.collect(tracePacket, { runId: "other-run" })).rejects.toThrow("runId mismatch");
  });
});
