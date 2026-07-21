import { describe, expect, it } from "vitest";

import {
  ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS,
  assertOntologyReviewGuard,
  boundedOntologyReviewText,
} from "../ontology-review";

describe("Ontology review boundary", () => {
  it("accepts only a compact exact guard shape", () => {
    expect(assertOntologyReviewGuard({
      candidateRevision: null,
      activationRevision: "active",
      baseSnapshotId: "knowledge-graph:0.3:test",
    })).toEqual({
      candidateRevision: null,
      activationRevision: "active",
      baseSnapshotId: "knowledge-graph:0.3:test",
    });
    expect(() => assertOntologyReviewGuard({
      candidateRevision: null,
      activationRevision: null,
      baseSnapshotId: "snapshot",
      path: "/private/workspace",
    })).toThrow("unsupported fields");
    expect(() => assertOntologyReviewGuard({
      candidateRevision: "x".repeat(129),
      activationRevision: null,
      baseSnapshotId: "snapshot",
    })).toThrow("bounded string");
  });

  it("mechanically bounds renderer-facing diagnostic text", () => {
    expect(boundedOntologyReviewText("x".repeat(1_000), ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS))
      .toHaveLength(ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS);
  });
});
