import { describe, expect, it } from "vitest";
import type { InvocationFileReviewPayload, InvocationHistoryItem, InvocationReviewListItem } from "../../shared/api";
import type { InvocationRecord } from "@exo/core";

import {
  activeInvocationReviewChangeId,
  applyInvocationReviewRecord,
  beginInvocationReviewHydration,
  cacheInvocationFileReview,
  closeInvocationHistoryReview,
  hydrateInvocationReviewQueue,
  invocationReviewProjection,
  invocationReviewMatchesPath,
  invocationReviewNavigablePath,
  invocationHistoryLoadDecision,
  invocationReviewAffectedOpenPaths,
  invocationReviewVirtualPath,
  mergeInvocationReviewHydration,
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

  it("does not let a stale startup snapshot erase a newer live settlement", () => {
    const live = applyInvocationReviewRecord(
      hydrateInvocationReviewQueue([]),
      record("live", [["change", "pending"]]),
    );
    expect(mergeInvocationReviewHydration(live, [])).toEqual(live);
    expect(mergeInvocationReviewHydration(live, [listItem("older", ["old-change"])]).entries.map((entry) => entry.invocationId))
      .toEqual(["live", "older"]);
    expect(mergeInvocationReviewHydration(live, [listItem("live", ["stale-change"])]))
      .toEqual(live);
  });

  it("does not resurrect a review settled before stale startup hydration returns", () => {
    const requestStarted = beginInvocationReviewHydration();
    const afterSettlement = applyInvocationReviewRecord(
      requestStarted,
      record("settled-while-loading", [["change", "kept"]]),
    );

    const afterStaleResponse = mergeInvocationReviewHydration(afterSettlement, [
      listItem("settled-while-loading", ["change"]),
    ]);

    expect(afterStaleResponse.entries).toEqual([]);
    expect(afterStaleResponse.activeInvocationId).toBeNull();
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

  it("activates an existing pending review instead of replacing it with read-only History", () => {
    const pending = hydrateInvocationReviewQueue([listItem("live", ["a"]), listItem("other", ["b"])]);
    const history: InvocationHistoryItem = {
      invocationId: "other",
      createdAt: "2026-07-20T00:00:00.000Z",
      command,
      outcome: "pending",
      changedFileCount: 1,
      changeIds: ["b"],
    };

    const opened = openInvocationHistoryReview(pending, history);
    expect(opened.activeInvocationId).toBe("other");
    expect(opened.entries.find((entry) => entry.invocationId === "other")?.source).toBe("pending");
  });

  it("does not create a dead review entry for zero-change History", () => {
    const state = hydrateInvocationReviewQueue([]);
    const history: InvocationHistoryItem = {
      invocationId: "failed",
      createdAt: "2026-07-20T00:00:00.000Z",
      command,
      outcome: "failed",
      changedFileCount: 0,
      changeIds: [],
    };
    expect(openInvocationHistoryReview(state, history)).toEqual(state);
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

  it("matches canonical macOS paths to an already-open editor alias", () => {
    const invocation = record("mac-path", [["modified", "pending"]]);
    const change = {
      ...invocation.changeset!.files[0]!,
      operation: "modified" as const,
      before: {
        ...invocation.changeset!.files[0]!.before!,
        path: "/private/var/folders/workspace/note.md",
      },
      after: {
        ...invocation.changeset!.files[0]!.after!,
        path: "/private/var/folders/workspace/note.md",
      },
    };
    const payload = {
      invocation,
      change,
      beforeText: "old",
      afterText: "new",
      canKeep: true,
      canReject: true,
    } as InvocationFileReviewPayload;

    expect(invocationReviewMatchesPath(payload, "/var/folders/workspace/note.md", "pending")).toBe(true);
    payload.invocation.noteRoots = ["/var/folders/workspace"];
    expect(invocationReviewNavigablePath(payload)).toBe("/var/folders/workspace/note.md");
  });

  it("finds every open before/after path affected by a bulk review", () => {
    const invocation = record("bulk", [["rename", "pending"], ["modify", "pending"]]);
    invocation.changeset!.files[0] = {
      ...invocation.changeset!.files[0]!,
      operation: "renamed",
      before: { ...invocation.changeset!.files[0]!.before!, path: "/private/var/notes/before.md" },
      after: { ...invocation.changeset!.files[0]!.after!, path: "/private/var/notes/after.md" },
    };
    invocation.changeset!.files[1] = {
      ...invocation.changeset!.files[1]!,
      operation: "modified",
      before: { ...invocation.changeset!.files[1]!.before!, path: "/notes/second.md" },
      after: { ...invocation.changeset!.files[1]!.after!, path: "/notes/second.md" },
    };
    const payloads = invocation.changeset!.files.map((change) => ({
      invocation,
      change,
      beforeText: "before",
      afterText: "after",
      canKeep: true,
      canReject: true,
    })) as InvocationFileReviewPayload[];

    expect(invocationReviewAffectedOpenPaths(payloads, [
      "/var/notes/before.md",
      "/var/notes/after.md",
      "/notes/second.md",
      "/notes/unrelated.md",
    ])).toEqual(["/var/notes/before.md", "/var/notes/after.md", "/notes/second.md"]);
  });
});
