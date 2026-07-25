import { describe, expect, it, vi } from "vitest";
import type { InvocationFileReviewPayload } from "../../../shared/api";

import {
  beginInvocationReviewDecision,
  captureInvocationReviewWorkspaceIdentity,
  invocationReviewPayloadRequestIsCurrent,
  invocationReviewWorkspaceIdentityIsCurrent,
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
  it("rejects delayed payload cache and projection as soon as Workspace B renders, before passive effects flush", async () => {
    const workspaceA = captureInvocationReviewWorkspaceIdentity(null, "/workspace-a");
    let renderedWorkspace = workspaceA;
    const payloadResponse = deferred<InvocationFileReviewPayload>();
    const cached: string[] = [];
    const opened: string[] = [];

    const completion = payloadResponse.promise.then((resolved) => {
      if (!invocationReviewWorkspaceIdentityIsCurrent(workspaceA, renderedWorkspace)) return;
      cached.push(resolved.change.id);
      opened.push(resolved.change.id);
    });
    renderedWorkspace = captureInvocationReviewWorkspaceIdentity(renderedWorkspace, "/workspace-b");
    payloadResponse.resolve(payload);
    await completion;

    expect(cached).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("does not let an old decision completion clear Workspace B pending or frozen projection", async () => {
    const workspaceA = captureInvocationReviewWorkspaceIdentity(null, "/workspace-a");
    let renderedWorkspace = workspaceA;
    const durableDecision = deferred<void>();
    const workspaceBDecision = { pending: true, frozenPaths: ["/workspace-b/note.md"] };

    const completion = durableDecision.promise.finally(() => {
      if (!invocationReviewWorkspaceIdentityIsCurrent(workspaceA, renderedWorkspace)) return;
      workspaceBDecision.pending = false;
      workspaceBDecision.frozenPaths = [];
    });
    renderedWorkspace = captureInvocationReviewWorkspaceIdentity(renderedWorkspace, "/workspace-b");
    durableDecision.resolve();
    await completion;

    expect(workspaceBDecision).toEqual({ pending: true, frozenPaths: ["/workspace-b/note.md"] });
  });

  it("rejects stale history and post-reload projection continuations", async () => {
    const workspaceA = captureInvocationReviewWorkspaceIdentity(null, "/workspace-a");
    let renderedWorkspace = workspaceA;
    const historyResponse = deferred<string[]>();
    const reloadTrees = deferred<void>();
    const projected: string[] = [];

    const historyCompletion = historyResponse.promise.then((items) => {
      if (invocationReviewWorkspaceIdentityIsCurrent(workspaceA, renderedWorkspace)) projected.push(...items);
    });
    const reloadCompletion = reloadTrees.promise.then(() => {
      if (invocationReviewWorkspaceIdentityIsCurrent(workspaceA, renderedWorkspace)) projected.push("resolved");
    });
    renderedWorkspace = captureInvocationReviewWorkspaceIdentity(renderedWorkspace, "/workspace-b");
    historyResponse.resolve(["history-a"]);
    reloadTrees.resolve();
    await Promise.all([historyCompletion, reloadCompletion]);

    expect(projected).toEqual([]);
  });

  it("rejects an older delayed payload request after a newer review becomes active", () => {
    const workspaceIdentity = captureInvocationReviewWorkspaceIdentity(null, "/workspace-a");
    const newer = { workspaceIdentity, invocationId: "invocation-b", changeId: "change-b", requestId: 2 };
    const older = { workspaceIdentity, invocationId: "invocation-a", changeId: "change-a", requestId: 1 };

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

  it("treats a changed rendered Workspace identity as stale hydration or payload work", () => {
    const identityA = captureInvocationReviewWorkspaceIdentity(null, "/workspace-a");
    const identityB = captureInvocationReviewWorkspaceIdentity(identityA, "/workspace-b");
    const workspaceA = { workspaceIdentity: identityA, invocationId: "invocation-a", changeId: "change-a", requestId: 3 };
    const workspaceB = { workspaceIdentity: identityB, invocationId: "invocation-a", changeId: "change-a", requestId: 3 };

    expect(invocationReviewPayloadRequestIsCurrent(workspaceA, workspaceB)).toBe(false);
  });
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
