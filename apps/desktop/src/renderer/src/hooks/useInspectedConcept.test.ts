import { describe, expect, it } from "vitest";

import {
  EMPTY_INSPECTED_CONCEPT_STATE,
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

  it("clears only the editor-owned inspection when editor ownership disappears", () => {
    const editorInspection = reduceInspectedConcept(EMPTY_INSPECTED_CONCEPT_STATE, {
      type: "inspect",
      concept: { filePath: "/notes/editor.md" },
      source: "editor",
    });
    const graphInspection = reduceInspectedConcept(EMPTY_INSPECTED_CONCEPT_STATE, {
      type: "inspect",
      concept: { filePath: "/notes/graph.md" },
      source: "graph",
    });

    expect(reduceInspectedConcept(editorInspection, { type: "sync-editor", filePath: null })).toMatchObject({
      concept: null,
      source: "editor",
    });
    expect(reduceInspectedConcept(graphInspection, { type: "sync-editor", filePath: null })).toBe(graphInspection);
  });
});
