import type { IndexMode, IndexUpdateStrategy } from "@exo/core";

export interface AutoEmbeddingPolicy {
  quietPeriodMs: number;
  idlePeriodMs: number;
  maxPendingEmbeddings: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  maxRetryAttempts: number;
}

export interface AutoEmbeddingSchedulerState {
  lastSaveAtMs: number | null;
  lastActivityAtMs: number | null;
  failureCount: number;
  retryNotBeforeMs: number;
  disposed: boolean;
}

export interface AutoEmbeddingContext {
  nowMs: number;
  indexMode: IndexMode;
  updateStrategy: IndexUpdateStrategy;
  pendingEmbeddings: number;
  foregroundWorkActive: boolean;
  /** Maintenance started by this scheduler, not a user-requested index operation. */
  maintenanceActive: boolean;
}

export type AutoEmbeddingDecision =
  | { action: "run" }
  | { action: "cancel"; reason: "disposed" }
  | {
      action: "skip";
      reason: "disposed" | "manual-pause" | "semantic-disabled" | "nothing-pending" | "backlog-too-large" | "retries-exhausted";
    }
  | {
      action: "wait";
      reason: "foreground-work" | "maintenance-active" | "quiet-period" | "idle-period" | "retry-backoff";
      reconsiderAtMs?: number;
    };

export function createAutoEmbeddingSchedulerState(): AutoEmbeddingSchedulerState {
  return {
    lastSaveAtMs: null,
    lastActivityAtMs: null,
    failureCount: 0,
    retryNotBeforeMs: 0,
    disposed: false,
  };
}

export function recordAutoEmbeddingSave(
  state: AutoEmbeddingSchedulerState,
  nowMs: number,
): AutoEmbeddingSchedulerState {
  if (state.disposed) return state;
  return { ...state, lastSaveAtMs: latestTimestamp(state.lastSaveAtMs, nowMs) };
}

export function recordAutoEmbeddingActivity(
  state: AutoEmbeddingSchedulerState,
  nowMs: number,
): AutoEmbeddingSchedulerState {
  if (state.disposed) return state;
  return { ...state, lastActivityAtMs: latestTimestamp(state.lastActivityAtMs, nowMs) };
}

export function recordAutoEmbeddingFailure(
  state: AutoEmbeddingSchedulerState,
  nowMs: number,
  policy: AutoEmbeddingPolicy,
): AutoEmbeddingSchedulerState {
  if (state.disposed) return state;
  const failureCount = Math.min(state.failureCount + 1, nonNegativeInteger(policy.maxRetryAttempts) + 1);
  return {
    ...state,
    failureCount,
    retryNotBeforeMs: nowMs + retryDelayMs(failureCount, policy),
  };
}

export function recordAutoEmbeddingSuccess(
  state: AutoEmbeddingSchedulerState,
): AutoEmbeddingSchedulerState {
  if (state.disposed) return state;
  return { ...state, failureCount: 0, retryNotBeforeMs: 0 };
}

export function disposeAutoEmbeddingScheduler(
  state: AutoEmbeddingSchedulerState,
): AutoEmbeddingSchedulerState {
  return { ...state, disposed: true };
}

export function decideAutoEmbedding(
  state: AutoEmbeddingSchedulerState,
  context: AutoEmbeddingContext,
  policy: AutoEmbeddingPolicy,
): AutoEmbeddingDecision {
  if (state.disposed) {
    return context.maintenanceActive
      ? { action: "cancel", reason: "disposed" }
      : { action: "skip", reason: "disposed" };
  }
  if (context.updateStrategy === "manual") {
    return { action: "skip", reason: "manual-pause" };
  }
  if (context.indexMode !== "semantic" && context.indexMode !== "hybrid") {
    return { action: "skip", reason: "semantic-disabled" };
  }
  if (context.maintenanceActive) {
    return { action: "wait", reason: "maintenance-active" };
  }
  if (context.pendingEmbeddings <= 0) {
    return { action: "skip", reason: "nothing-pending" };
  }
  if (context.pendingEmbeddings > nonNegativeInteger(policy.maxPendingEmbeddings)) {
    return { action: "skip", reason: "backlog-too-large" };
  }
  if (context.foregroundWorkActive) {
    return { action: "wait", reason: "foreground-work" };
  }
  if (state.failureCount > nonNegativeInteger(policy.maxRetryAttempts)) {
    return { action: "skip", reason: "retries-exhausted" };
  }
  if (context.nowMs < state.retryNotBeforeMs) {
    return { action: "wait", reason: "retry-backoff", reconsiderAtMs: state.retryNotBeforeMs };
  }

  const quietUntilMs = deadline(state.lastSaveAtMs, policy.quietPeriodMs);
  if (quietUntilMs !== null && context.nowMs < quietUntilMs) {
    return { action: "wait", reason: "quiet-period", reconsiderAtMs: quietUntilMs };
  }

  const idleUntilMs = deadline(state.lastActivityAtMs, policy.idlePeriodMs);
  if (idleUntilMs !== null && context.nowMs < idleUntilMs) {
    return { action: "wait", reason: "idle-period", reconsiderAtMs: idleUntilMs };
  }

  return { action: "run" };
}

function latestTimestamp(previous: number | null, next: number): number {
  return previous === null ? next : Math.max(previous, next);
}

function deadline(timestamp: number | null, delayMs: number): number | null {
  return timestamp === null ? null : timestamp + Math.max(0, delayMs);
}

function retryDelayMs(failureCount: number, policy: AutoEmbeddingPolicy): number {
  const base = Math.max(0, policy.retryBaseDelayMs);
  const maximum = Math.max(base, policy.retryMaxDelayMs);
  let delay = base;
  for (let attempt = 1; attempt < failureCount && delay < maximum; attempt += 1) {
    delay = Math.min(delay * 2, maximum);
  }
  return delay;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(value));
}
