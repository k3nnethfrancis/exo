import { describe, expect, it } from "vitest";

import {
  runArtifactPaths,
  runHasPendingReview,
  runTraceHasEvidence,
  type RunEvaluationResult,
  type RunRecord,
  type RunTracePacket,
} from "../run";

const baseRun: RunRecord = {
  id: "run-1",
  routineId: "routine-1",
  harnessId: "codex",
  status: "needsReview",
  reviewState: "pending",
  artifacts: [
    {
      id: "artifact-1",
      runId: "run-1",
      kind: "transcript",
      path: ".exo/runs/run-1/transcript.ansi.log",
      createdAt: "2026-06-14T00:00:00.000Z",
    },
    {
      id: "artifact-2",
      runId: "run-1",
      kind: "report",
      path: ".exo/runs/run-1/report.md",
      sourceCapabilityId: "alignment-routine",
      createdAt: "2026-06-14T00:01:00.000Z",
    },
  ],
  proposedFileChanges: ["notes/projects/alignment/proposal.md"],
  errors: [],
};

describe("run primitives", () => {
  it("detects runs waiting on human review", () => {
    expect(runHasPendingReview(baseRun)).toBe(true);
    expect(runHasPendingReview({ ...baseRun, status: "succeeded", reviewState: "notRequired" })).toBe(false);
  });

  it("filters artifact paths by kind", () => {
    expect(runArtifactPaths(baseRun)).toEqual([".exo/runs/run-1/transcript.ansi.log", ".exo/runs/run-1/report.md"]);
    expect(runArtifactPaths(baseRun, "report")).toEqual([".exo/runs/run-1/report.md"]);
  });

  it("keeps trace packet evidence explicit", () => {
    const packet: RunTracePacket = {
      id: "trace-1",
      runId: "run-1",
      kind: "decision",
      timestamp: "2026-06-14T00:02:00.000Z",
      actor: "alignment-routine",
      private: true,
      evidence: [
        {
          id: "evidence-1",
          kind: "markdown",
          path: "notes/projects/alignment/context.md",
          contentHash: "sha256:test",
        },
      ],
      payload: {
        decision: "proposeCorrection",
      },
    };

    expect(runTraceHasEvidence(packet)).toBe(true);
  });

  it("models evaluation results as run-linked artifacts and metrics", () => {
    const result: RunEvaluationResult = {
      id: "eval-1",
      runId: "run-1",
      evaluatorId: "alignment-evaluator-v0",
      status: "warning",
      metrics: [
        {
          name: "operator_agreement",
          value: 0.74,
          unit: "ratio",
          higherIsBetter: true,
        },
      ],
      artifactIds: ["artifact-2"],
      createdAt: "2026-06-14T00:03:00.000Z",
      summary: "Alignment is directionally correct but needs boundary review.",
    };

    expect(result.metrics[0]).toMatchObject({ name: "operator_agreement", value: 0.74 });
    expect(result.artifactIds).toEqual(["artifact-2"]);
  });
});
