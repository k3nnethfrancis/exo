import { describe, expect, it } from "vitest";
import type { InvocationRecord } from "@exo/core";
import type { InvocationActivityEvent } from "@exo/core/invocation-activity";

import {
  acknowledgeInvocationActivity,
  applyInvocationActivityEvent,
  applyInvocationRecord,
  bindInvocationActivity,
  bufferEarlyInvocationActivityEvent,
  beginInvocationActivity,
  boundedInvocationErrorDetail,
  failActiveInvocationActivity,
  failInvocationActivity,
  takeEarlyInvocationActivityEvents,
} from "./invocationActivityState";

const command = { handle: "claude", label: "Claude" };

function record(status: InvocationRecord["status"]): InvocationRecord {
  return {
    id: "invocation-1",
    status,
    context: "note",
    mentionProvenance: "human-authored",
    message: "Review this",
    promptDelivery: "stdin",
    command: {
      id: "claude",
      handle: "claude",
      label: "Claude",
      command: "claude -p",
      adapter: "claude-code",
      continuityPolicy: "continuous",
      cwdPolicy: "workspace_root",
      promptDelivery: "stdin",
      version: 1,
      enabled: true,
      executableFingerprint: "sha256:test",
    },
    cwd: "/private/wiki",
    createdAt: "2026-07-20T00:00:00.000Z",
    continuity: { policy: "continuous", outcome: "fresh" },
  };
}

describe("invocation activity state", () => {
  it("acknowledges a send synchronously without claiming provider work began", () => {
    expect(acknowledgeInvocationActivity(command)).toEqual({
      invocationId: null,
      kind: "checking",
      commandHandle: "claude",
      commandLabel: "Claude",
    });
  });

  it("moves through bounded activity and terminal states", () => {
    const started = applyInvocationRecord(beginInvocationActivity(command), record("running"));
    const reading = applyInvocationActivityEvent(started, {
      invocationId: "invocation-1",
      kind: "reading",
      label: "/private/wiki/essay.md",
      emittedAt: "2026-07-20T00:00:01.000Z",
    });

    expect(reading).toMatchObject({ invocationId: "invocation-1", kind: "reading", label: "essay.md" });
    expect(applyInvocationRecord(reading, record("running"))).toMatchObject({ kind: "reading", label: "essay.md" });
    expect(applyInvocationRecord(reading, record("process-exited"))).toMatchObject({ kind: "done" });
    expect(applyInvocationRecord(reading, record("failed"))).toMatchObject({ kind: "failed" });
  });

  it("ignores unrelated invocation events", () => {
    const current = applyInvocationRecord(beginInvocationActivity(command), record("running"));
    expect(applyInvocationActivityEvent(current, {
      invocationId: "other",
      kind: "editing",
      label: "other.md",
      emittedAt: "2026-07-20T00:00:01.000Z",
    })).toBe(current);
    expect(applyInvocationRecord(current, { ...record("process-exited"), id: "other" })).toBe(current);
  });

  it("does not let a delayed old event claim a new launch before its record returns", () => {
    const waiting = beginInvocationActivity(command);
    const oldEvent: InvocationActivityEvent = {
      invocationId: "old-invocation",
      kind: "editing",
      label: "old.md",
      emittedAt: "2026-07-20T00:00:01.000Z",
    };
    const nextEvent: InvocationActivityEvent = {
      invocationId: "invocation-1",
      kind: "reading",
      label: "new.md",
      emittedAt: "2026-07-20T00:00:02.000Z",
    };
    const buffered = new Map<string, InvocationActivityEvent[]>();
    bufferEarlyInvocationActivityEvent(buffered, oldEvent);
    bufferEarlyInvocationActivityEvent(buffered, nextEvent);

    expect(applyInvocationActivityEvent(waiting, oldEvent)).toBe(waiting);
    expect(bindInvocationActivity(
      waiting,
      record("running"),
      takeEarlyInvocationActivityEvents(buffered, "invocation-1"),
    )).toMatchObject({
      invocationId: "invocation-1",
      kind: "reading",
      label: "new.md",
    });
    expect(buffered.size).toBe(0);
  });

  it("never retains raw provider output, reasoning, or full paths", () => {
    const untrustedEvent = {
      invocationId: "invocation-1",
      kind: "editing",
      label: "/private/wiki/secret.md",
      emittedAt: "2026-07-20T00:00:01.000Z",
      rawOutput: "chain of thought",
      reasoning: "private reasoning",
    } as InvocationActivityEvent & { rawOutput: string; reasoning: string };
    const next = applyInvocationActivityEvent(
      applyInvocationRecord(beginInvocationActivity(command), record("running")),
      untrustedEvent,
    );

    expect(next).toEqual({
      invocationId: "invocation-1",
      kind: "editing",
      commandHandle: "claude",
      commandLabel: "Claude",
      label: "secret.md",
    });
    expect(JSON.stringify(next)).not.toContain("chain of thought");
    expect(JSON.stringify(next)).not.toContain("private/wiki");
  });

  it("keeps actionable failures bounded and removes local paths", () => {
    expect(failInvocationActivity(command, new Error("Executable was not found: claude"))).toMatchObject({
      kind: "failed",
      errorDetail: "Executable was not found: claude",
    });
    expect(failInvocationActivity(command, "The configured working directory /Users/kenneth/private/wiki is unavailable.")).toMatchObject({
      errorDetail: "The configured working directory this folder is unavailable.",
    });
    expect(failInvocationActivity(command, "Command fingerprint changed. Review and authorize Claude again.")).toMatchObject({
      errorDetail: "Command fingerprint changed. Review and authorize Claude again.",
    });
    expect(boundedInvocationErrorDetail(`Failed ${"x".repeat(300)}`)).toHaveLength(180);
  });

  it("preserves invocation identity when an active stop or resume fails", () => {
    const current = applyInvocationRecord(beginInvocationActivity(command), record("running"));
    expect(failActiveInvocationActivity(current, "Unable to stop the process.")).toMatchObject({
      invocationId: "invocation-1",
      commandHandle: "claude",
      kind: "failed",
      errorDetail: "Unable to stop the process.",
    });
  });

  it("retains Resume for failed invocations without reviewable file changes", () => {
    const failed = { ...record("failed"), providerSessionId: "session-1", failureReason: "Provider exited." };
    expect(applyInvocationRecord(beginInvocationActivity(command), failed)).toMatchObject({
      invocationId: "invocation-1",
      kind: "failed",
      providerSessionId: "session-1",
    });
  });
});
