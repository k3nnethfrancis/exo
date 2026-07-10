import { describe, expect, it } from "vitest";

import {
  activityArtifactPaths,
  activityHasPendingReview,
  activityTraceHasEvidence,
  type ActivityRecord,
  type ActivityTracePacket,
} from "../run";

const baseActivity: ActivityRecord = {
  id: "activity-1",
  activityType: "plugin.graphAudit",
  status: "needsReview",
  reviewState: "pending",
  actor: { id: "graph-audit.plugin", kind: "plugin" },
  harness: { id: "codex" },
  artifacts: [
    {
      id: "artifact-1",
      activityId: "activity-1",
      kind: "transcript",
      path: ".exo/activities/activity-1/transcript.ansi.log",
      createdAt: "2026-06-14T00:00:00.000Z",
    },
    {
      id: "artifact-2",
      activityId: "activity-1",
      kind: "report",
      path: ".exo/artifacts/activity-1/report.md",
      sourceCapabilityId: "graph-audit.plugin",
      createdAt: "2026-06-14T00:01:00.000Z",
    },
  ],
  errors: [],
};

describe("activity primitives", () => {
  it("detects activities waiting on human review", () => {
    expect(activityHasPendingReview(baseActivity)).toBe(true);
    expect(activityHasPendingReview({ ...baseActivity, status: "succeeded", reviewState: "notRequired" })).toBe(false);
  });

  it("filters artifact paths by kind", () => {
    expect(activityArtifactPaths(baseActivity)).toEqual([
      ".exo/activities/activity-1/transcript.ansi.log",
      ".exo/artifacts/activity-1/report.md",
    ]);
    expect(activityArtifactPaths(baseActivity, "report")).toEqual([".exo/artifacts/activity-1/report.md"]);
  });

  it("keeps trace packet evidence explicit", () => {
    const packet: ActivityTracePacket = {
      id: "trace-1",
      activityId: "activity-1",
      kind: "decision",
      timestamp: "2026-06-14T00:02:00.000Z",
      actor: "graph-audit.plugin",
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

    expect(activityTraceHasEvidence(packet)).toBe(true);
  });

  it("keeps evaluation results plugin-owned behind artifact refs", () => {
    const activity: ActivityRecord = {
      ...baseActivity,
      artifacts: [
        ...baseActivity.artifacts,
        {
          id: "eval-results",
          activityId: "activity-1",
          kind: "evaluation",
          path: ".exo/artifacts/activity-1/eval-results.json",
          title: "Alignment Evaluation Results",
          mimeType: "application/json",
          sourceCapabilityId: "alignment-evaluator-v0",
          createdAt: "2026-06-14T00:03:00.000Z",
        },
      ],
      pluginMetadata: {
        "alignment-evaluator-v0": {
          schema: "plugin-owned",
        },
      },
    };

    expect(activityArtifactPaths(activity, "evaluation")).toEqual([".exo/artifacts/activity-1/eval-results.json"]);
    expect(activity.pluginMetadata).toEqual({ "alignment-evaluator-v0": { schema: "plugin-owned" } });
  });
});
