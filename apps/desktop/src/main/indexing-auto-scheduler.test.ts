import { describe, expect, it } from "vitest";

import {
  createAutoEmbeddingSchedulerState,
  decideAutoEmbedding,
  disposeAutoEmbeddingScheduler,
  recordAutoEmbeddingActivity,
  recordAutoEmbeddingFailure,
  recordAutoEmbeddingSave,
  recordAutoEmbeddingSuccess,
  type AutoEmbeddingContext,
  type AutoEmbeddingPolicy,
} from "./indexing-auto-scheduler";

const policy: AutoEmbeddingPolicy = {
  quietPeriodMs: 30_000,
  idlePeriodMs: 10_000,
  maxPendingEmbeddings: 20,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 4_000,
  maxRetryAttempts: 5,
};

describe("automatic embedding scheduler policy", () => {
  it("defers until the latest save and activity have both become quiet", () => {
    let state = createAutoEmbeddingSchedulerState();
    state = recordAutoEmbeddingSave(state, 1_000);
    state = recordAutoEmbeddingActivity(state, 20_000);

    expect(decideAutoEmbedding(state, context(29_999), policy)).toEqual({
      action: "wait",
      reason: "quiet-period",
      reconsiderAtMs: 31_000,
    });

    state = recordAutoEmbeddingSave(state, 30_000);
    state = recordAutoEmbeddingActivity(state, 55_000);
    expect(decideAutoEmbedding(state, context(59_999), policy)).toEqual({
      action: "wait",
      reason: "quiet-period",
      reconsiderAtMs: 60_000,
    });
    expect(decideAutoEmbedding(state, context(60_000), policy)).toEqual({
      action: "wait",
      reason: "idle-period",
      reconsiderAtMs: 65_000,
    });
    expect(decideAutoEmbedding(state, context(65_000), policy)).toEqual({ action: "run" });
  });

  it.each([
    [{ indexMode: "lexical" as const }, "semantic-disabled"],
    [{ indexMode: "off" as const }, "semantic-disabled"],
    [{ updateStrategy: "manual" as const }, "manual-pause"],
    [{ pendingEmbeddings: 0 }, "nothing-pending"],
  ])("skips when automatic semantic work is inapplicable: %s", (overrides, reason) => {
    expect(decideAutoEmbedding(createAutoEmbeddingSchedulerState(), context(60_000, overrides), policy)).toEqual({
      action: "skip",
      reason,
    });
  });

  it.each(["semantic", "hybrid"] as const)("runs an eligible small %s backlog", (indexMode) => {
    expect(decideAutoEmbedding(
      createAutoEmbeddingSchedulerState(),
      context(60_000, { indexMode, pendingEmbeddings: policy.maxPendingEmbeddings }),
      policy,
    )).toEqual({ action: "run" });
  });

  it("never automatically runs a backlog above the configured cap", () => {
    expect(decideAutoEmbedding(
      createAutoEmbeddingSchedulerState(),
      context(60_000, { pendingEmbeddings: policy.maxPendingEmbeddings + 1 }),
      policy,
    )).toEqual({ action: "skip", reason: "backlog-too-large" });
  });

  it("does not start while foreground or scheduler-owned maintenance work is active", () => {
    expect(decideAutoEmbedding(
      createAutoEmbeddingSchedulerState(),
      context(60_000, { foregroundWorkActive: true }),
      policy,
    )).toEqual({ action: "wait", reason: "foreground-work" });
    expect(decideAutoEmbedding(
      createAutoEmbeddingSchedulerState(),
      context(60_000, { maintenanceActive: true }),
      policy,
    )).toEqual({ action: "wait", reason: "maintenance-active" });
  });

  it("applies bounded exponential backoff and resets after success", () => {
    let state = createAutoEmbeddingSchedulerState();
    const expectedDelays = [1_000, 2_000, 4_000, 4_000, 4_000];

    for (const delayMs of expectedDelays) {
      state = recordAutoEmbeddingFailure(state, 10_000, policy);
      expect(state.retryNotBeforeMs).toBe(10_000 + delayMs);
    }
    expect(decideAutoEmbedding(state, context(13_999), policy)).toEqual({
      action: "wait",
      reason: "retry-backoff",
      reconsiderAtMs: 14_000,
    });

    expect(decideAutoEmbedding(state, context(14_000), policy)).toEqual({ action: "run" });

    state = recordAutoEmbeddingFailure(state, 14_000, policy);
    expect(decideAutoEmbedding(state, context(20_000), policy)).toEqual({
      action: "skip",
      reason: "retries-exhausted",
    });

    state = recordAutoEmbeddingSuccess(state);
    expect(state).toMatchObject({ failureCount: 0, retryNotBeforeMs: 0 });
    expect(decideAutoEmbedding(state, context(20_000), policy)).toEqual({ action: "run" });
  });

  it("pauses future work without cancelling an active slice and reserves cancellation for disposal", () => {
    const state = createAutoEmbeddingSchedulerState();
    expect(decideAutoEmbedding(
      state,
      context(60_000, { updateStrategy: "manual", maintenanceActive: true }),
      policy,
    )).toEqual({ action: "skip", reason: "manual-pause" });

    const disposed = disposeAutoEmbeddingScheduler(state);
    expect(decideAutoEmbedding(disposed, context(60_000, { maintenanceActive: true }), policy)).toEqual({
      action: "cancel",
      reason: "disposed",
    });
    expect(recordAutoEmbeddingSave(disposed, 70_000)).toBe(disposed);
    expect(recordAutoEmbeddingActivity(disposed, 70_000)).toBe(disposed);
    expect(recordAutoEmbeddingFailure(disposed, 70_000, policy)).toBe(disposed);
    expect(recordAutoEmbeddingSuccess(disposed)).toBe(disposed);
  });
});

function context(nowMs: number, overrides: Partial<AutoEmbeddingContext> = {}): AutoEmbeddingContext {
  return {
    nowMs,
    indexMode: "hybrid",
    updateStrategy: "on-save",
    pendingEmbeddings: 1,
    foregroundWorkActive: false,
    maintenanceActive: false,
    ...overrides,
  };
}
