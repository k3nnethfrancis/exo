import { describe, expect, it } from "vitest";

import { compileGraphView } from "../graph-projection";
import type { KnowledgeGraphSnapshot } from "../knowledge-graph";

describe("graph projection", () => {
  it("compiles stable dense topology without turning open ontology values into renderer kinds", () => {
    const snapshot: KnowledgeGraphSnapshot = {
      version: "0.2",
      snapshotId: "knowledge-graph:0.2:fixture",
      generatedAt: "2026-07-17T00:00:00.000Z",
      scope: { noteRootIds: ["notes"], paths: [] },
      concepts: [
        { id: "b", label: "B", conceptTypes: ["Arbitrary/UserType"], properties: {}, resolution: "resolved", tags: [] },
        { id: "a", label: "A", conceptTypes: [], properties: {}, resolution: "resolved", tags: [] },
      ],
      relations: [{ id: "r", source: "a", target: "b", family: "link", predicate: "custom-predicate", authority: "authored", resolution: "resolved", directed: true, evidence: [] }],
      findings: [],
      activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" },
    };

    const projection = compileGraphView(snapshot);

    expect(projection).toEqual(compileGraphView(snapshot));
    expect(projection.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(projection.nodes[1]).toMatchObject({ group: "Arbitrary/UserType", kind: "concept", degree: 1 });
    expect(projection.edges).toEqual([expect.objectContaining({ source: 0, target: 1, family: "link" })]);
    expect(projection.omitted).toEqual({ tagConcepts: 0, tagRelations: 0 });
    expect(JSON.stringify(projection)).not.toContain("custom-predicate");
  });

  it("keeps the layout seed stable across property-only edits", () => {
    const base: KnowledgeGraphSnapshot = {
      version: "0.2",
      snapshotId: "before",
      generatedAt: "2026-07-17T00:00:00.000Z",
      scope: { noteRootIds: ["notes"], paths: ["a.md"] },
      concepts: [{ id: "a", label: "A", conceptTypes: [], properties: { status: "draft" }, resolution: "resolved", tags: [] }],
      relations: [],
      findings: [],
      activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" },
    };
    const changed = { ...base, snapshotId: "after", concepts: [{ ...base.concepts[0], properties: { status: "done" } }] };
    expect(compileGraphView(changed).seed).toBe(compileGraphView(base).seed);
  });
});
