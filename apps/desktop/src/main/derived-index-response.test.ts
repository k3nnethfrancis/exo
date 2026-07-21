import { describe, expect, it } from "vitest";

import { createGraphTopology } from "@exo/core";

import {
  derivedIndexResponseBytes,
  isGraphTopology,
  MAX_DERIVED_RESPONSE_BYTES,
} from "./derived-index-response";

describe("derived index response bounds", () => {
  it("measures typed topology buffers without JSON-expanding their entries", () => {
    const topology = createGraphTopology({
      sourceSnapshotId: "snapshot:fixture",
      activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" },
      activeOntology: { state: "generic" },
      seed: 7,
      nodes: {
        identityKeys: new Uint32Array(200_000),
        seeds: new Uint32Array(100_000),
        groups: new Uint32Array(100_000),
        degrees: new Uint32Array(100_000),
        visualClasses: new Uint8Array(100_000),
      },
      edges: {
        endpoints: new Uint32Array(1_000_000),
        visualClasses: new Uint8Array(500_000),
      },
    });
    const response = { id: 1, ok: true as const, result: topology };

    expect(isGraphTopology(topology)).toBe(true);
    const envelopeBytes = Buffer.byteLength(JSON.stringify({ id: 1, ok: true, result: null }), "utf8");
    expect(derivedIndexResponseBytes(response)).toBe(topology.payloadBytes + envelopeBytes - 4);
    expect(derivedIndexResponseBytes(response)).toBeLessThan(MAX_DERIVED_RESPONSE_BYTES);
    expect(Buffer.byteLength(JSON.stringify(response), "utf8")).toBeGreaterThan(MAX_DERIVED_RESPONSE_BYTES);
    const firstClone = structuredClone(topology);
    const secondClone = structuredClone(topology);
    expect(firstClone.nodes.identityKeys).toBeInstanceOf(Uint32Array);
    expect(secondClone.transportHash).toBe(firstClone.transportHash);
    expect(topology.nodes.identityKeys.byteLength).toBe(800_000);
  });

  it("uses ordinary UTF-8 JSON size for cold and error responses", () => {
    const response = { id: 2, ok: false as const, error: "nope" };
    expect(derivedIndexResponseBytes(response)).toBe(Buffer.byteLength(JSON.stringify(response), "utf8"));
  });
});
