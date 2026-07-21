import { describe, expect, it } from "vitest";

import {
  compileGraphTopology,
  createGraphTopology,
  graphTopologyPayloadBytes,
} from "../graph-projection";
import type { KnowledgeGraphSnapshot } from "../knowledge-graph";

describe("graph projection", () => {
  it("keeps cold identities, labels, paths, and ontology strings out of hot topology", () => {
    const snapshot = fixtureSnapshot();
    const first = compileGraphTopology(snapshot);
    const second = compileGraphTopology(snapshot);

    expect(first.topology).toEqual(second.topology);
    expect(first.conceptIds).toEqual(["note:private:a.md", "note:private:b.md"]);
    expect(first.conceptIndexById.get("note:private:b.md")).toBe(1);
    expect(first.conceptIndexByFilePath.get("/Users/private/notes/a.md")).toBe(0);
    expect(first.topology.nodeCount).toBe(2);
    expect(first.topology.edgeCount).toBe(1);
    expect(first.topology.payloadBytes).toBe(graphTopologyPayloadBytes(first.topology));
    const wire = JSON.stringify(first.topology);
    expect(wire).not.toContain("Private Alpha");
    expect(wire).not.toContain("/Users/private/notes");
    expect(wire).not.toContain("note:private:a.md");
    expect(wire).not.toContain("SensitiveOntologyType");
    expect(first.topology.nodes.identityKeys).toHaveLength(4);
  });

  it("separates collision-prone layout seeds from 64-bit continuity keys", () => {
    const base = topologyInput(2, 1);
    base.nodes.seeds.fill(42);
    base.nodes.identityKeys.set([1, 0, 2, 0]);
    const first = createGraphTopology(base);
    const changed = topologyInput(2, 1);
    changed.nodes.seeds.fill(42);
    changed.nodes.identityKeys.set([1, 0, 3, 0]);
    const second = createGraphTopology(changed);

    expect(first.nodes.seeds[0]).toBe(first.nodes.seeds[1]);
    expect([...first.nodes.identityKeys]).toEqual([1, 0, 2, 0]);
    expect(first.topologyHash).not.toBe(second.topologyHash);
    expect(first.layoutEpochId).not.toBe(second.layoutEpochId);
  });

  it("does not reset topology or layout epochs for property-only edits", () => {
    const before = fixtureSnapshot();
    const after: KnowledgeGraphSnapshot = {
      ...before,
      snapshotId: "snapshot:property-edit",
      concepts: before.concepts.map((concept) => concept.id.endsWith("a.md")
        ? { ...concept, properties: { status: "changed" } }
        : concept),
    };
    const first = compileGraphTopology(before).topology;
    const second = compileGraphTopology(after).topology;

    expect(second.sourceSnapshotId).not.toBe(first.sourceSnapshotId);
    expect(second.profileHash).toBe(first.profileHash);
    expect(second.topologyHash).toBe(first.topologyHash);
    expect(second.layoutEpochId).toBe(first.layoutEpochId);
    expect(second.transportHash).not.toBe(first.transportHash);
  });

  it("holds deterministic packed payload gates at launch scales", () => {
    const scales = [
      { nodes: 10_000, edges: 50_000, payloadBytes: 660_560, topologyHash: "graph-topology:0.1:599afafa480128d3", transportHash: "graph-transport:0.1:708924b3f018349a", layoutEpochId: "graph-layout:0.1:f4fafcabaa19931e" },
      { nodes: 50_000, edges: 250_000, payloadBytes: 3_300_562, topologyHash: "graph-topology:0.1:801a42fd8e58207c", transportHash: "graph-transport:0.1:9ea10f9283a5264d", layoutEpochId: "graph-layout:0.1:53ababff705e1c05" },
      { nodes: 100_000, edges: 500_000, payloadBytes: 6_600_563, topologyHash: "graph-topology:0.1:e6987d1b64ee0d43", transportHash: "graph-transport:0.1:3241a4ccbe7c39b0", layoutEpochId: "graph-layout:0.1:06c3522ae8893f17" },
    ];

    for (const scale of scales) {
      const first = createGraphTopology(topologyInput(scale.nodes, scale.edges));
      const second = createGraphTopology(topologyInput(scale.nodes, scale.edges));
      expect(first.payloadBytes).toBe(scale.payloadBytes);
      expect(first.payloadBytes).toBeLessThan(8 * 1024 * 1024);
      expect(first.payloadBytes).toBe(second.payloadBytes);
      expect(first.topologyHash).toBe(scale.topologyHash);
      expect(first.transportHash).toBe(scale.transportHash);
      expect(first.layoutEpochId).toBe(scale.layoutEpochId);
      expect(second.topologyHash).toBe(scale.topologyHash);
      expect(second.transportHash).toBe(scale.transportHash);
      expect(second.layoutEpochId).toBe(scale.layoutEpochId);
    }
  }, 20_000);

  it("rejects malformed identity and endpoint arrays", () => {
    const badIdentity = topologyInput(2, 1);
    badIdentity.nodes.identityKeys = new Uint32Array(3);
    expect(() => createGraphTopology(badIdentity)).toThrow("identity keys");
    const badEndpoint = topologyInput(2, 1);
    badEndpoint.edges.endpoints[1] = 2;
    expect(() => createGraphTopology(badEndpoint)).toThrow("outside the node array");
    const pooled = topologyInput(2, 1);
    pooled.nodes.seeds = new Uint32Array(new ArrayBuffer(16), 4, 2);
    expect(() => createGraphTopology(pooled)).toThrow("exact ArrayBuffer storage");
  });
});

function fixtureSnapshot(): KnowledgeGraphSnapshot {
  return {
    version: "0.3",
    snapshotId: "snapshot:fixture",
    generatedAt: "2026-07-17T00:00:00.000Z",
    scope: { workspaceRoot: "/Users/private/notes", noteRootIds: ["private"], paths: ["/Users/private/notes/a.md"] },
    concepts: [
      { id: "note:private:b.md", label: "Private Beta", filePath: "/Users/private/notes/b.md", conceptTypes: [], properties: {}, resolution: "resolved", tags: [] },
      { id: "note:private:a.md", label: "Private Alpha", filePath: "/Users/private/notes/a.md", conceptTypes: ["SensitiveOntologyType"], properties: {}, resolution: "resolved", tags: [] },
    ],
    relations: [{ id: "relation:private", source: "note:private:a.md", target: "note:private:b.md", family: "link", origin: "document", resolution: "resolved", directed: true, evidence: [] }],
    findings: [],
    activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" },
    activeOntology: { state: "generic" },
  };
}

function topologyInput(nodeCount: number, edgeCount: number) {
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const visualClasses = new Uint8Array(nodeCount);
  for (let index = 0; index < nodeCount; index += 1) {
    identityKeys[index * 2] = index;
    identityKeys[index * 2 + 1] = 0x9e3779b9;
    seeds[index] = Math.imul(index + 1, 2_654_435_761) >>> 0;
    groups[index] = index % 17;
    degrees[index] = edgeCount === 0 ? 0 : 10;
    visualClasses[index] = index % 3;
  }
  const endpoints = new Uint32Array(edgeCount * 2);
  const edgeClasses = new Uint8Array(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    endpoints[index * 2] = index % nodeCount;
    endpoints[index * 2 + 1] = (index * 7 + 1) % nodeCount;
    edgeClasses[index] = index % 6;
  }
  return {
    sourceSnapshotId: "snapshot:scale",
    activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" } as const,
    activeOntology: { state: "generic" } as const,
    seed: 0x12345678,
    nodes: { identityKeys, seeds, groups, degrees, visualClasses },
    edges: { endpoints, visualClasses: edgeClasses },
  };
}
