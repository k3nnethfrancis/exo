import { describe, expect, it } from "vitest";
import type { GraphViewProjection } from "@exo/core";

import {
  EMPTY_INSPECTED_CONCEPT_STATE,
  graphNodeIndexForConcept,
  reduceInspectedConcept,
} from "./useInspectedConcept";

describe("inspected Concept ownership", () => {
  it("separates ordinary inspection from a camera focus request", () => {
    const inspected = reduceInspectedConcept(EMPTY_INSPECTED_CONCEPT_STATE, {
      type: "inspect",
      concept: { filePath: "/notes/one.md" },
      source: "editor",
    });

    expect(inspected.concept).toEqual({ filePath: "/notes/one.md" });
    expect(inspected.source).toBe("editor");
    expect(inspected.focusRequest).toBeNull();
  });

  it("emits a new focus sequence for repeated requests on the same Concept", () => {
    const first = reduceInspectedConcept(EMPTY_INSPECTED_CONCEPT_STATE, {
      type: "focus",
      concept: { filePath: "/notes/one.md" },
      source: "editor",
    });
    const second = reduceInspectedConcept(first, {
      type: "focus",
      concept: { filePath: "/notes/one.md" },
      source: "editor",
    });

    expect(first.focusRequest?.sequence).toBe(1);
    expect(second.focusRequest?.sequence).toBe(2);
  });

  it("remaps an inspected Concept by id first and path after a projection refresh", () => {
    const projection = graphProjection([
      { id: "concept:new", path: "/notes/moved.md" },
      { id: "concept:stable", path: "/notes/renamed.md" },
    ]);

    expect(graphNodeIndexForConcept(projection, {
      conceptId: "concept:stable",
      filePath: "/notes/old.md",
    })).toBe(1);
    expect(graphNodeIndexForConcept(projection, { filePath: "/notes/moved.md" })).toBe(0);
  });
});

function graphProjection(nodes: Array<{ id: string; path: string }>): GraphViewProjection {
  return {
    version: "0.1",
    layoutVersion: "finite-force-0.1",
    sourceSnapshotId: "snapshot",
    seed: 1,
    nodes: nodes.map((node) => ({ ...node, label: node.id, group: "notes", kind: "concept", degree: 0 })),
    edges: [],
    omitted: { tagConcepts: 0, tagRelations: 0 },
  };
}
