import { describe, expect, it, vi } from "vitest";
import type { InvocationFileReviewPayload } from "../../../shared/api";

import {
  beginInvocationReviewDecision,
  invocationReviewPayloadRequestIsCurrent,
  runInvocationReviewDecision,
} from "./useInvocationReviewController";

const payload = {
  invocation: { id: "invocation-a" },
  change: {
    id: "change-a",
    before: { path: "/notes/before.md" },
    after: { path: "/notes/after.md" },
  },
} as InvocationFileReviewPayload;

describe("invocation review controller ownership", () => {
  it("rejects an older delayed payload request after a newer review becomes active", () => {
    const newer = { workspaceGeneration: 4, invocationId: "invocation-b", changeId: "change-b", requestId: 2 };
    const older = { workspaceGeneration: 4, invocationId: "invocation-a", changeId: "change-a", requestId: 1 };

    expect(invocationReviewPayloadRequestIsCurrent(older, newer)).toBe(false);
    expect(invocationReviewPayloadRequestIsCurrent(newer, newer)).toBe(true);
  });

  it("guards a second Keep or Reject action and freezes the displayed decision identity and paths", () => {
    const first = beginInvocationReviewDecision(false, payload, ["/notes/before.md", "/notes/after.md", "/notes/other.md"]);
    const repeated = beginInvocationReviewDecision(first.pending, payload, ["/notes/other.md"]);

    expect(first.snapshot).toMatchObject({
      invocationId: "invocation-a",
      changeId: "change-a",
      affectedOpenPaths: ["/notes/before.md", "/notes/after.md"],
    });
    expect(first.snapshot?.payload).toBe(payload);
    expect(repeated.snapshot).toBeNull();
  });

  it("completes save and drain before the durable decision and does not decide when the barrier fails", async () => {
    const snapshot = beginInvocationReviewDecision(false, payload, ["/notes/after.md"]).snapshot!;
    const order: string[] = [];
    const decide = vi.fn(async () => { order.push("decide"); });

    await runInvocationReviewDecision(snapshot, {
      prepareDocumentsForReview: async (paths) => { order.push(`prepare:${paths.join(",")}`); },
      decide,
    });
    expect(order).toEqual(["prepare:/notes/after.md", "decide"]);

    await expect(runInvocationReviewDecision(snapshot, {
      prepareDocumentsForReview: async () => { throw new Error("save failed"); },
      decide,
    })).rejects.toThrow("save failed");
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("treats a changed workspace generation as stale hydration or payload work", () => {
    const workspaceA = { workspaceGeneration: 5, invocationId: "invocation-a", changeId: "change-a", requestId: 3 };
    const workspaceB = { workspaceGeneration: 6, invocationId: "invocation-a", changeId: "change-a", requestId: 3 };

    expect(invocationReviewPayloadRequestIsCurrent(workspaceA, workspaceB)).toBe(false);
  });
});
