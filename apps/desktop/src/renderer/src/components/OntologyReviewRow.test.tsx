import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OntologyReviewPresentation } from "./OntologyReviewRow";

describe("Ontology review presentation", () => {
  it("renders Ontology review as one compact path-free decision row", () => {
    const html = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null}
        notice={null}
        onKeep={() => {}}
        onReject={() => {}}
        onReopen={() => {}}
        reopened={false}
        review={{
          active: { state: "generic" },
          candidate: { state: "valid", id: "research", label: "Research", version: "2", revision: "candidate-secret", pending: true, rejected: false },
          guard: { candidateRevision: "candidate-secret", activationRevision: null, baseSnapshotId: "snapshot-secret" },
          effects: {
            baseSnapshotId: "snapshot-secret",
            candidateSnapshotId: "candidate-snapshot-secret",
            affectedConcepts: 3,
            before: { typedConcepts: 0, ontologyRelations: 0, findings: { info: 0, warning: 0, error: 0 } },
            after: { typedConcepts: 3, ontologyRelations: 2, findings: { info: 1, warning: 0, error: 0 } },
          },
          diagnostics: [],
          omittedDiagnostics: 0,
        }}
      />,
    );

    expect(html).toContain("Generic");
    expect(html).toContain("Research · v2");
    expect(html).toContain("3 typed");
    expect(html).toContain("+2 relations");
    expect(html).toContain('aria-label="Keep ontology"');
    expect(html).toContain('aria-label="Reject ontology"');
    expect(html).not.toContain("candidate-secret");
    expect(html).not.toContain("snapshot-secret");
    expect(html).not.toContain("ontology.yaml");
  });

  it("keeps rejected and invalid Ontology states deliberate", () => {
    const rejected = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null} notice={null} onKeep={() => {}} onReject={() => {}} onReopen={() => {}} reopened={false}
        review={{
          active: { state: "active", id: "research", version: "1" },
          candidate: { state: "absent", revision: null, pending: true, rejected: true },
          guard: { candidateRevision: null, activationRevision: "active", baseSnapshotId: "base" },
          diagnostics: [], omittedDiagnostics: 0,
        }}
      />,
    );
    expect(rejected).toContain("Not applied");
    expect(rejected.match(/Not applied/g)).toHaveLength(1);
    expect(rejected).toContain('aria-label="Review ontology again"');
    expect(rejected).not.toContain('aria-label="Keep ontology"');

    const invalid = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null} notice={null} onKeep={() => {}} onReject={() => {}} onReopen={() => {}} reopened={true}
        review={{
          active: { state: "generic" },
          candidate: { state: "invalid", revision: "invalid", pending: true, rejected: false },
          guard: { candidateRevision: "invalid", activationRevision: null, baseSnapshotId: "base" },
          diagnostics: [{ severity: "error", code: "invalid", message: "Fix one field." }], omittedDiagnostics: 2,
        }}
      />,
    );
    expect(invalid).toContain("Fix one field.");
    expect(invalid).toContain("2 more");
    expect(invalid).toContain('aria-label="Keep ontology"');
    expect(invalid).toContain("disabled");
  });

  it("hides Ontology actions for current, preview-error, and invalid Active states", () => {
    const current = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null} notice={null} onKeep={() => {}} onReject={() => {}} onReopen={() => {}} reopened={false}
        review={{
          active: { state: "active", id: "research", version: "1" },
          candidate: { state: "valid", id: "research", version: "1", revision: "same", pending: false, rejected: false },
          guard: { candidateRevision: "same", activationRevision: "active", baseSnapshotId: "base" },
          diagnostics: [], omittedDiagnostics: 0,
        }}
      />,
    );
    expect(current).not.toContain('aria-label="Keep ontology"');
    expect(current).not.toContain('aria-label="Reject ontology"');

    const unavailable = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null} notice="Preview unavailable" onKeep={() => {}} onReject={() => {}} onReopen={() => {}} reopened={false}
        review={null}
      />,
    );
    expect(unavailable).toContain("Preview unavailable");
    expect(unavailable).not.toContain('aria-label="Keep ontology"');

    const invalidActive = renderToStaticMarkup(
      <OntologyReviewPresentation
        busy={null} notice="Changed—review again" onKeep={() => {}} onReject={() => {}} onReopen={() => {}} reopened={false}
        review={{
          active: { state: "invalid-state" },
          candidate: { state: "valid", id: "candidate", version: "1", revision: "candidate", pending: true, rejected: false },
          guard: { candidateRevision: "candidate", activationRevision: null, baseSnapshotId: "base" },
          diagnostics: [], omittedDiagnostics: 0,
        }}
      />,
    );
    expect(invalidActive).toContain("Active unavailable");
    expect(invalidActive).toContain("Changed—review again");
    expect(invalidActive).not.toContain('aria-label="Keep ontology"');
    expect(invalidActive).not.toContain('aria-label="Reject ontology"');
  });
});
