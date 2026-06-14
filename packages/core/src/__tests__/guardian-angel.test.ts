import { describe, expect, it } from "vitest";

import {
  guardianAngelStrategicAlignmentRoutineExample,
  guardianAngelTraceHasEvidence,
  type GuardianAngelCandidateDecisionRecord,
  type GuardianAngelReviewRecord,
  type GuardianAngelTracePacket,
} from "../guardian-angel";

describe("guardian angel contracts", () => {
  it("defines the strategic-alignment Routine example as a proposed-artifact workflow", () => {
    expect(guardianAngelStrategicAlignmentRoutineExample).toMatchObject({
      harnessId: "codex",
      trigger: { kind: "manual" },
      outputPolicy: {
        fileChanges: "propose",
        artifacts: "record",
      },
      enabled: false,
    });
    expect(guardianAngelStrategicAlignmentRoutineExample.requiredSkills.map((skill) => skill.id)).toEqual([
      "guardian-angel-strategic-alignment",
    ]);
    expect(guardianAngelStrategicAlignmentRoutineExample.permissions.permissions).toEqual(
      expect.arrayContaining(["workspace:read", "notes:read", "projects:read", "artifacts:write"]),
    );
  });

  it("models candidate decisions and review corrections separately", () => {
    const candidate: GuardianAngelCandidateDecisionRecord = {
      recordType: "candidateGaDecision",
      scenarioId: "pd_synthetic_001",
      candidateId: "profiled_ga_v0",
      model: "gpt-5-mini",
      promptRef: "prompts/profiled-ga-v0.md",
      principalProfileRef: "principal.md",
      relationshipPacketRef: "relationships/synthetic-close-collaborator.json",
      chosenAction: "A0",
      actionDistribution: { A0: 0.7, A1: 0.3 },
      confidence: 0.62,
      rationale: "Long-term reciprocity dominates the one-shot payoff.",
      autonomyBoundary: "ask",
      rawResponseRef: "raw/profiled_ga_v0_pd_synthetic_001.md",
      reviewStatus: "unreviewed",
    };
    const review: GuardianAngelReviewRecord = {
      recordType: "review",
      targetRecordId: "candidate-1",
      reviewer: "kenneth",
      status: "corrected",
      redactionStatus: "privateOnly",
      notes: "Correct strategic direction, wrong autonomy boundary.",
      correction: "Should defer rather than ask in this context.",
      tags: ["relationship-sensitive"],
    };

    expect(candidate.reviewStatus).toBe("unreviewed");
    expect(review.status).toBe("corrected");
    expect(review.correction).toContain("defer");
  });

  it("keeps trace evidence explicit", () => {
    const packet: GuardianAngelTracePacket = {
      id: "trace-1",
      runId: "run-1",
      kind: "principalResponse",
      actor: "principal",
      timestamp: "2026-06-14T00:00:00.000Z",
      private: true,
      redactionStatus: "privateOnly",
      evidence: [
        {
          id: "evidence-1",
          kind: "markdown",
          path: "notes/projects/guardian-angel/strategic-dilemma-alignment-protocol-v0.md",
          contentHash: "sha256:test",
        },
      ],
      payload: {
        scenarioId: "pd_synthetic_001",
      },
    };

    expect(guardianAngelTraceHasEvidence(packet)).toBe(true);
  });
});
