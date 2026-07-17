import { describe, expect, it } from "vitest";

import { evaluateGraphUtility } from "../graph-utility";
import type { KnowledgeGraphSnapshot } from "../knowledge-graph";

describe("GraphUtilityBench tracer", () => {
  it("reports separate evidenced dimensions and never fabricates an aggregate quality score", () => {
    const snapshot: KnowledgeGraphSnapshot = {
      version: "0.2",
      snapshotId: "fixture",
      generatedAt: "2026-07-17T00:00:00.000Z",
      scope: { noteRootIds: ["notes"], paths: [] },
      concepts: [
        { id: "a", label: "A", conceptTypes: [], properties: {}, resolution: "resolved", tags: [] },
        { id: "b", label: "B", conceptTypes: [], properties: {}, resolution: "resolved", tags: [] },
      ],
      relations: [
        { id: "resolved", source: "a", target: "b", family: "link", authority: "authored", resolution: "resolved", directed: true, evidence: [{ kind: "source-span", noteId: "a", sourceRange: { from: 0, to: 5 } }] },
        { id: "broken", source: "a", target: "missing", family: "link", authority: "authored", resolution: "unresolved", directed: true, evidence: [] },
      ],
      findings: [],
      activeProfile: { id: "generic-markdown", version: "1", label: "Generic Markdown", source: "built-in", state: "active" },
    };

    const report = evaluateGraphUtility(snapshot);

    expect(report.dimensions.map((dimension) => dimension.id)).toEqual(["identity", "resolution", "evidence", "profile-conformance"]);
    expect(report.dimensions.find((dimension) => dimension.id === "resolution")).toMatchObject({ measured: 1, total: 2, ratio: 0.5 });
    expect(report.dimensions.find((dimension) => dimension.id === "evidence")).toMatchObject({ measured: 1, total: 2, ratio: 0.5 });
    expect(report.dimensions.find((dimension) => dimension.id === "evidence")?.findings).toContainEqual(expect.objectContaining({ code: "relation.missing-evidence" }));
    expect(report).not.toHaveProperty("score");
  });
});
