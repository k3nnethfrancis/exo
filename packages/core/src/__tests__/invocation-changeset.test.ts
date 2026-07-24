import { describe, expect, it } from "vitest";

import {
  buildInvocationChangeset,
  deriveInvocationChangesetStatus,
  normalizeInvocationChangeset,
  resolveInvocationFileChange,
  type InvocationFileState,
  type InvocationWorkspaceManifest,
} from "../invocation-changeset";

const capturedAt = "2026-07-20T20:00:00.000Z";

describe("invocation changesets", () => {
  it("derives modified, created, deleted, and uniquely proven renamed files", () => {
    const launch = manifest([
      state("/notes/modified.md", "a"),
      state("/notes/deleted.md", "b"),
      state("/notes/old-name.md", "c"),
      state("/notes/untouched.md", "d"),
    ]);
    const settled = manifest([
      state("/notes/modified.md", "changed"),
      state("/notes/created.md", "new"),
      state("/notes/new-name.md", "c"),
      state("/notes/untouched.md", "d"),
    ]);

    const changeset = buildInvocationChangeset(launch, settled);

    expect(changeset.status).toBe("pending-review");
    expect(changeset.files.map((file) => ({
      operation: file.operation,
      before: file.before?.path,
      after: file.after?.path,
    }))).toEqual([
      { operation: "created", before: undefined, after: "/notes/created.md" },
      { operation: "modified", before: "/notes/modified.md", after: "/notes/modified.md" },
      { operation: "renamed", before: "/notes/old-name.md", after: "/notes/new-name.md" },
      { operation: "deleted", before: "/notes/deleted.md", after: undefined },
    ].sort((left, right) => (left.after ?? left.before!).localeCompare(right.after ?? right.before!)));
  });

  it("does not guess a rename when content identity is ambiguous", () => {
    const launch = manifest([
      state("/notes/a.md", "same"),
      state("/notes/b.md", "same"),
    ]);
    const settled = manifest([
      state("/notes/c.md", "same"),
      state("/notes/d.md", "same"),
    ]);

    const changeset = buildInvocationChangeset(launch, settled);

    expect(changeset.files.filter((file) => file.operation === "renamed")).toHaveLength(0);
    expect(changeset.files.filter((file) => file.operation === "deleted")).toHaveLength(2);
    expect(changeset.files.filter((file) => file.operation === "created")).toHaveLength(2);
  });

  it("treats a mode-only change as a modified file", () => {
    const before = state("/notes/script.md", "same", 0o644);
    const after = state("/notes/script.md", "same", 0o755);

    const changeset = buildInvocationChangeset(manifest([before]), manifest([after]));

    expect(changeset.files).toHaveLength(1);
    expect(changeset.files[0]).toMatchObject({ operation: "modified", before, after });
  });

  it("derives aggregate review state from exact per-file decisions", () => {
    expect(deriveInvocationChangesetStatus([])).toBe("no-change");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "pending" } }])).toBe("pending-review");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "kept", reviewedAt: capturedAt, acceptedSha256: null } }])).toBe("kept");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "rejected", reviewedAt: capturedAt } }])).toBe("rejected");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "kept", reviewedAt: capturedAt, acceptedSha256: null } }, { decision: { status: "pending" } }])).toBe("partially-resolved");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "kept", reviewedAt: capturedAt, acceptedSha256: null } }, { decision: { status: "rejected", reviewedAt: capturedAt } }])).toBe("resolved");
    expect(deriveInvocationChangesetStatus([{ decision: { status: "conflict", reason: "drift", currentSha256: null } }, { decision: { status: "pending" } }])).toBe("conflict");
  });

  it("normalizes exact persisted changesets and rejects malformed file states", () => {
    const changeset = buildInvocationChangeset(
      manifest([state("/notes/a.md", "a")]),
      manifest([state("/notes/a.md", "b")]),
    );
    expect(normalizeInvocationChangeset(changeset)).toEqual(changeset);
    expect(normalizeInvocationChangeset({
      ...changeset,
      files: [{ ...changeset.files[0], after: { ...changeset.files[0]?.after, snapshotRef: "../../escape" } }],
    })).toBeNull();
  });

  it("resolves one file without inventing a batch decision", () => {
    const changeset = buildInvocationChangeset(
      manifest([state("/notes/a.md", "a"), state("/notes/b.md", "b")]),
      manifest([state("/notes/a.md", "changed-a"), state("/notes/b.md", "changed-b")]),
    );
    const first = changeset.files[0]!;

    const resolved = resolveInvocationFileChange(changeset, first.id, {
      status: "kept",
      reviewedAt: "2026-07-20T20:01:00.000Z",
      acceptedSha256: first.after?.sha256 ?? null,
    });

    expect(resolved.status).toBe("partially-resolved");
    expect(resolved.files.find((file) => file.id === first.id)?.decision.status).toBe("kept");
    expect(resolved.files.find((file) => file.id !== first.id)?.decision.status).toBe("pending");
  });
});

function manifest(files: InvocationFileState[]): InvocationWorkspaceManifest {
  return {
    version: 1,
    capturedAt,
    noteRoots: ["/notes"],
    files: Object.fromEntries(files.map((file) => [file.path, file])),
    directories: ["/notes"],
  };
}

function state(filePath: string, sha256: string, mode?: number): InvocationFileState {
  return {
    path: filePath,
    sha256: sha256.padEnd(64, "0"),
    byteLength: 1,
    snapshotRef: `files/objects/${sha256.padEnd(64, "0")}`,
    mediaType: "text",
    ...(mode === undefined ? {} : { mode }),
  };
}
