import { describe, expect, it } from "vitest";
import type { InvocationFileReviewPayload, InvocationHistoryItem, InvocationReviewListItem } from "../../shared/api";
import type { InvocationRecord } from "@exo/core";

import {
  activeInvocationReviewChangeId,
  applyInvocationReviewRecord,
  cacheInvocationFileReview,
  closeInvocationHistoryReview,
  hydrateInvocationReviewQueue,
  invocationReviewProjection,
  invocationReviewMatchesPath,
  invocationHistoryLoadDecision,
  invocationReviewVirtualPath,
  navigateInvocationReview,
  openInvocationHistoryReview,
} from "./invocationReviewQueue";

const command = { handle: "claude", label: "Claude" };

function listItem(invocationId: string, changeIds: string[]): InvocationReviewListItem {
  return {
    invocationId,
    createdAt: "2026-07-20T00:00:00.000Z",
    command,
    changedFileCount: changeIds.length,
    pendingFileCount: changeIds.length,
    pendingChangeIds: changeIds,
    status: "process-exited",
  };
}

function record(invocationId: string, decisions: Array<[string, "pending" | "kept" | "conflict"]>): InvocationRecord {
  return {
    id: invocationId,
    status: "process-exited",
    context: "note",
    mentionProvenance: "human-authored",
    message: "Review",
    promptDelivery: "stdin",
    command: { id: "claude", ...command, command: "claude -p", adapter: "claude-code", continuityPolicy: "fresh", cwdPolicy: "workspace_root", promptDelivery: "stdin", version: 1, enabled: true, executableFingerprint: "sha256:test" },
    cwd: "/notes",
    createdAt: "2026-07-20T00:00:00.000Z",
    continuity: { policy: "fresh", outcome: "fresh" },
    changedFileRefs: [],
    diffRefs: [],
    attribution: { status: "pending" },
    changeset: {
      version: 1,
      status: decisions.some(([, status]) => status === "conflict") ? "conflict" : "pending-review",
      settledAt: "2026-07-20T00:01:00.000Z",
      files: decisions.map(([id, status], index) => ({
        id,
        operation: index === 0 ? "deleted" : "renamed",
        decision: status === "pending" ? { status } : status === "kept"
          ? { status, reviewedAt: "2026-07-20T00:02:00.000Z", acceptedSha256: null }
          : { status, reason: "The file changed after settlement.", currentSha256: null },
        before: { path: `/notes/old-${index}.md`, sha256: "a".repeat(64), byteLength: 3, snapshotRef: `files/objects/${"a".repeat(64)}`, mediaType: "text" },
        ...(index === 0 ? {} : { after: { path: `/notes/new-${index}.md`, sha256: "b".repeat(64), byteLength: 3, snapshotRef: `files/objects/${"b".repeat(64)}`, mediaType: "text" as const } }),
      })),
    },
  };
}

describe("invocation review queue", () => {
  it("preserves the originating note History while its read-only retained diff is open", () => {
    expect(invocationHistoryLoadDecision({ filePath: "exo-review://old/a/note.md", readOnly: true })).toEqual({ kind: "preserve" });
    expect(invocationHistoryLoadDecision({ filePath: "/notes/note.md" })).toEqual({ kind: "load", filePath: "/notes/note.md" });
    expect(invocationHistoryLoadDecision(null)).toEqual({ kind: "clear" });
  });

  it("hydrates and navigates multiple non-overlapping pending changesets", () => {
    let state = hydrateInvocationReviewQueue([listItem("one", ["a", "b"]), listItem("two", ["c"])]);
    expect(activeInvocationReviewChangeId(state)).toBe("a");
    state = navigateInvocationReview(state, 1);
    expect(activeInvocationReviewChangeId(state)).toBe("b");
    expect(state.entries).toHaveLength(2);
  });

  it("advances after resolution and preserves a drift conflict", () => {
    let state = navigateInvocationReview(hydrateInvocationReviewQueue([listItem("one", ["a", "b"])]), 1);
    const pending = record("one", [["a", "pending"], ["b", "kept"]]);
    state = cacheInvocationFileReview(state, { invocation: pending, change: pending.changeset!.files[0]!, beforeText: "before", afterText: null, canKeep: true, canReject: true });
    state = applyInvocationReviewRecord(state, pending);
    expect(activeInvocationReviewChangeId(state)).toBe("a");
    state = applyInvocationReviewRecord(state, record("one", [["a", "conflict"], ["b", "kept"]]));
    expect(activeInvocationReviewChangeId(state)).toBe("a");
    expect(state.entries[0]!.payloads.a?.canKeep).toBe(true);
  });

  it("projects deleted former content and exact rename paths", () => {
    let state = hydrateInvocationReviewQueue([listItem("one", ["deleted", "renamed"])]);
    const base = record("one", [["deleted", "pending"], ["renamed", "pending"]]);
    for (const change of base.changeset!.files) {
      state = cacheInvocationFileReview(state, { invocation: base, change, beforeText: "old", afterText: change.after ? "new" : null, canKeep: true, canReject: true });
    }
    expect(invocationReviewProjection(state.entries[0]!)).toMatchObject([
      { operation: "deleted", path: "/notes/old-0.md", summary: "Former content · empty after invocation" },
      { operation: "renamed", previousPath: "/notes/old-1.md", path: "/notes/new-1.md" },
    ]);
  });

  it("opens retained History with read-only resolved decisions", () => {
    const history: InvocationHistoryItem = { invocationId: "old", createdAt: "2026-07-20T00:00:00.000Z", command, outcome: "kept", changedFileCount: 1, changeIds: ["a"] };
    let state = openInvocationHistoryReview(hydrateInvocationReviewQueue([]), history);
    const oldRecord = record("old", [["a", "kept"]]);
    const change = oldRecord.changeset!.files[0]!;
    state = cacheInvocationFileReview(state, { invocation: oldRecord, change, beforeText: "before", afterText: null, canKeep: false, canReject: false } as InvocationFileReviewPayload);
    expect(invocationReviewProjection(state.entries[0]!)[0]).toMatchObject({ resolved: "kept" });
    state = closeInvocationHistoryReview(state);
    expect(state.activeInvocationId).toBeNull();
  });

  it("uses one exact virtual identity for created and renamed History files", () => {
    const historical = record("old", [["created", "kept"], ["renamed", "kept"]]);
    historical.changeset!.files[0] = {
      ...historical.changeset!.files[0]!,
      operation: "created",
      before: undefined,
      after: { path: "/notes/created.md", sha256: "b".repeat(64), byteLength: 3, snapshotRef: `files/objects/${"b".repeat(64)}`, mediaType: "text" },
    };
    for (const change of historical.changeset!.files) {
      const payload = { invocation: historical, change, beforeText: change.before ? "old" : null, afterText: "new", canKeep: false, canReject: false } as InvocationFileReviewPayload;
      const virtualPath = invocationReviewVirtualPath(payload);
      expect(virtualPath).toBeTruthy();
      expect(invocationReviewMatchesPath(payload, virtualPath!, "history")).toBe(true);
    }
  });
});
