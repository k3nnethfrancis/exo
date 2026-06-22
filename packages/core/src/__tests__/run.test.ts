import { describe, expect, it } from "vitest";

import {
  activityArtifactPaths,
  activityHasPendingReview,
  activityToRunRecord,
  runToActivityRecord,
  runArtifactPaths,
  runHasPendingReview,
  runTraceHasEvidence,
  type ActivityRecord,
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

  it("projects legacy run records into the generic activity substrate", () => {
    const activity = runToActivityRecord({
      ...baseRun,
      transcriptPath: ".exo/runs/run-1/transcript.ansi.log",
      logPath: ".exo/runs/run-1/run.log",
    });

    expect(activity).toMatchObject({
      id: "run-1",
      activityType: "routine.run",
      status: "needsReview",
      actor: { id: "routine-1", kind: "plugin" },
      harness: { id: "codex" },
      routine: { id: "routine-1" },
      transcriptRef: { id: "transcript", path: ".exo/runs/run-1/transcript.ansi.log" },
      logRef: { id: "log", path: ".exo/runs/run-1/run.log" },
      reviewRef: { state: "pending" },
    });
    expect(activityHasPendingReview(activity)).toBe(true);
    expect(activityArtifactPaths(activity, "report")).toEqual([".exo/runs/run-1/report.md"]);
  });

  it("projects activity-shaped records back through the run compatibility API", () => {
    const activity: ActivityRecord = {
      id: "activity-1",
      activityType: "routine.run",
      status: "succeeded",
      reviewState: "notRequired",
      actor: { id: "graph-health.plugin", kind: "plugin" },
      harness: { id: "codex", sessionId: "session-1" },
      routine: { id: "graph-health", templateId: "graph-health.template" },
      scope: {
        workspaceRoot: "/workspace",
        noteRootIds: ["notes"],
        projectRootIds: ["exo"],
        paths: ["notes", "projects/exo"],
      },
      transcriptRef: { id: "transcript", path: ".exo/runs/activity-1/transcript.ansi.log" },
      logRef: { id: "log", path: ".exo/runs/activity-1/run.log" },
      provenanceRefs: [{ id: "session", path: ".exo/terminal-transcripts/session-1.log" }],
      artifacts: [
        {
          id: "artifact-1",
          activityId: "activity-1",
          kind: "report",
          path: ".exo/artifacts/activity-1/report.md",
          createdAt: "2026-06-14T00:04:00.000Z",
        },
      ],
      errors: [],
      pluginMetadata: {
        graphHealth: {
          orphanCount: 2,
        },
      },
    };

    const run = activityToRunRecord(activity);

    expect(run).toMatchObject({
      id: "activity-1",
      routineId: "graph-health",
      harnessId: "codex",
      status: "succeeded",
      reviewState: "notRequired",
      transcriptPath: ".exo/runs/activity-1/transcript.ansi.log",
      logPath: ".exo/runs/activity-1/run.log",
      proposedFileChanges: [],
    });
    expect(run.artifacts).toEqual([
      {
        id: "artifact-1",
        activityId: "activity-1",
        runId: "activity-1",
        kind: "report",
        path: ".exo/artifacts/activity-1/report.md",
        createdAt: "2026-06-14T00:04:00.000Z",
      },
    ]);
  });
});
