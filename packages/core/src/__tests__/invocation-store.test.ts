import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentCommandSnapshot, createDefaultClaudeAgentCommand, type InvocationRecord } from "../agent-invocation";
import { InvocationStore, invocationRecordPath, resolveInvocationStoreLayout } from "../invocation-store";

function invocationRecord(id: string, createdAt: string): InvocationRecord {
  return {
    id,
    status: "running",
    context: "note",
    taggedDocumentPath: "/tmp/workspace/notes/example.md",
    originalMentionText: "@claude please summarize this",
    mentionProvenance: "human-authored",
    message: "please summarize this",
    promptDelivery: "stdin",
    command: agentCommandSnapshot(createDefaultClaudeAgentCommand()),
    cwd: "/tmp/workspace",
    createdAt,
    startedAt: createdAt,
    terminalSessionId: `terminal-${id}`,
    continuity: { policy: "continuous", outcome: "fresh" },
  };
}

describe("invocation store", () => {
  it("writes records under .exo/invocations/id/record.json", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
    const store = new InvocationStore(workspaceRoot);

    try {
      const record = invocationRecord("invocation/one", "2026-07-08T00:00:00.000Z");
      const target = await store.writeRecord(record);

      expect(target).toBe(invocationRecordPath(resolveInvocationStoreLayout(workspaceRoot), "invocation/one"));
      expect(target).toContain(`${path.sep}.exo${path.sep}invocations${path.sep}`);
      await expect(readFile(target, "utf8")).resolves.toContain("\"promptDelivery\": \"stdin\"");
      await expect(store.readRecord("invocation/one")).resolves.toMatchObject({
        id: "invocation/one",
        status: "running",
        command: { handle: "claude" },
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("lists readable records deterministically by creation time then id", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
    const store = new InvocationStore(workspaceRoot);

    try {
      await store.writeRecord(invocationRecord("b", "2026-07-08T00:00:02.000Z"));
      await store.writeRecord(invocationRecord("c", "2026-07-08T00:00:01.000Z"));
      await store.writeRecord(invocationRecord("a", "2026-07-08T00:00:01.000Z"));

      await expect(store.listRecords()).resolves.toMatchObject([
        { id: "a", createdAt: "2026-07-08T00:00:01.000Z" },
        { id: "c", createdAt: "2026-07-08T00:00:01.000Z" },
        { id: "b", createdAt: "2026-07-08T00:00:02.000Z" },
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("enumerates every durable invocation directory even when its record is missing or invalid", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
    const store = new InvocationStore(workspaceRoot);

    try {
      await store.writeRecord(invocationRecord("valid", "2026-07-08T00:00:00.000Z"));
      const invocationsDir = resolveInvocationStoreLayout(workspaceRoot).invocationsDir;
      await mkdir(path.join(invocationsDir, "missing"), { recursive: true });
      await mkdir(path.join(invocationsDir, "invalid"), { recursive: true });
      await writeFile(path.join(invocationsDir, "invalid", "record.json"), "{}\n", "utf8");

      await expect(store.listInvocationIds()).resolves.toEqual(["invalid", "missing", "valid"]);
      await expect(store.listRecords()).resolves.toMatchObject([{ id: "valid" }]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("durably migrates a pending single-note review once without retaining its legacy model", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
    const store = new InvocationStore(workspaceRoot);

    try {
      const fixture = await writeLegacyReviewFixture(workspaceRoot, {
        id: "legacy-pending",
        status: "pending",
        before: "before\n",
        after: "after\n",
      });

      const migrated = await store.readRecord(fixture.id);

      expect(migrated).toMatchObject({
        id: fixture.id,
        workspaceRoot,
        noteRoots: [fixture.noteRoot],
        changeset: {
          status: "pending-review",
          files: [{
            id: `modified:${fixture.notePath}`,
            operation: "modified",
            decision: { status: "pending" },
            before: { path: fixture.notePath, sha256: fixture.beforeSha256 },
            after: { path: fixture.notePath, sha256: fixture.afterSha256 },
          }],
        },
      });
      const durable = JSON.parse(await readFile(fixture.recordPath, "utf8")) as Record<string, unknown>;
      expect(durable).toHaveProperty("changeset");
      expect(durable).not.toHaveProperty("review");
      expect(durable).not.toHaveProperty("changedFileRefs");
      expect(durable).not.toHaveProperty("diffRefs");
      expect(durable).not.toHaveProperty("attribution");
      await expect(store.readSnapshot(fixture.id, migrated!.changeset!.files[0]!.before!))
        .resolves.toEqual(Buffer.from("before\n"));
      await expect(store.readManifest(fixture.id, "launch")).resolves.toMatchObject({
        noteRoots: [fixture.noteRoot],
        files: { [fixture.notePath]: { sha256: fixture.beforeSha256 } },
      });
      await expect(store.readManifest(fixture.id, "settled")).resolves.toMatchObject({
        files: { [fixture.notePath]: { sha256: fixture.afterSha256 } },
      });
      await expect(store.readCleanBase(fixture.id)).resolves.toMatchObject({
        file: { path: fixture.notePath, sha256: fixture.beforeSha256 },
      });

      // The rewritten exact record is the durable migration marker. Retired
      // artifacts are no longer consulted, even if they later become corrupt.
      await writeFile(path.join(path.dirname(fixture.recordPath), "before.md"), "corrupt legacy bytes\n");
      const secondRead = await new InvocationStore(workspaceRoot).readRecord(fixture.id);
      expect(secondRead).toEqual(migrated);
      expect(JSON.parse(await readFile(fixture.recordPath, "utf8"))).toEqual(durable);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("preserves kept and rejected legacy decisions when listRecords upgrades them", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
    const store = new InvocationStore(workspaceRoot);

    try {
      const kept = await writeLegacyReviewFixture(workspaceRoot, {
        id: "legacy-kept",
        status: "kept",
        reviewedAt: "2026-07-08T00:00:03.000Z",
        before: "kept before\n",
        after: "kept after\n",
        createdAt: "2026-07-08T00:00:01.000Z",
      });
      const rejected = await writeLegacyReviewFixture(workspaceRoot, {
        id: "legacy-rejected",
        status: "rejected",
        reviewedAt: "2026-07-08T00:00:04.000Z",
        before: "rejected before\n",
        after: "rejected after\n",
        createdAt: "2026-07-08T00:00:02.000Z",
      });

      const records = await store.listRecords();

      expect(records.map((record) => record.id)).toEqual([kept.id, rejected.id]);
      expect(records[0]?.changeset).toMatchObject({
        status: "kept",
        resolvedAt: "2026-07-08T00:00:03.000Z",
        files: [{ decision: {
          status: "kept",
          reviewedAt: "2026-07-08T00:00:03.000Z",
          acceptedSha256: kept.afterSha256,
        } }],
      });
      expect(records[1]?.changeset).toMatchObject({
        status: "rejected",
        resolvedAt: "2026-07-08T00:00:04.000Z",
        files: [{ decision: { status: "rejected", reviewedAt: "2026-07-08T00:00:04.000Z" } }],
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it.each(["missing", "mismatched"] as const)(
    "fails closed when a pending legacy review has %s artifacts",
    async (failure) => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocations-"));
      const store = new InvocationStore(workspaceRoot);

      try {
        const fixture = await writeLegacyReviewFixture(workspaceRoot, {
          id: `legacy-${failure}`,
          status: "pending",
          before: "before\n",
          after: "after\n",
        });
        const afterPath = path.join(path.dirname(fixture.recordPath), "after.md");
        if (failure === "missing") await rm(afterPath);
        else await writeFile(afterPath, "different bytes\n");

        await expect(store.readRecord(fixture.id)).rejects.toThrow(/legacy review|legacy after\.md/i);
        await expect(store.listRecords()).rejects.toThrow(/legacy review|legacy after\.md/i);
        const durable = JSON.parse(await readFile(fixture.recordPath, "utf8")) as Record<string, unknown>;
        expect(durable).toMatchObject({ review: { status: "pending" } });
        expect(durable).not.toHaveProperty("changeset");
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps invocation records under the repository gitignored .exo runtime tree", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const result = spawnSync("git", ["check-ignore", "--quiet", ".exo/invocations/invocation-1/record.json"], {
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
  });
});

async function writeLegacyReviewFixture(
  workspaceRoot: string,
  input: {
    id: string;
    status: "pending" | "kept" | "rejected";
    before: string;
    after: string;
    reviewedAt?: string;
    createdAt?: string;
  },
) {
  const noteRoot = path.join(workspaceRoot, "notes");
  const notePath = path.join(noteRoot, `${input.id}.md`);
  await mkdir(noteRoot, { recursive: true });
  await writeFile(notePath, input.status === "rejected" ? input.before : input.after);
  const createdAt = input.createdAt ?? "2026-07-08T00:00:00.000Z";
  const beforeSha256 = sha256(input.before);
  const afterSha256 = sha256(input.after);
  const base = invocationRecord(input.id, createdAt);
  const recordPath = invocationRecordPath(resolveInvocationStoreLayout(workspaceRoot), input.id);
  await mkdir(path.dirname(recordPath), { recursive: true });
  await Promise.all([
    writeFile(path.join(path.dirname(recordPath), "before.md"), input.before),
    writeFile(path.join(path.dirname(recordPath), "after.md"), input.after),
    writeFile(recordPath, `${JSON.stringify({
      ...base,
      status: "process-exited",
      taggedDocumentPath: notePath,
      cwd: workspaceRoot,
      endedAt: "2026-07-08T00:00:02.000Z",
      changedFileRefs: [{ path: notePath, kind: "modified", attribution: "likely", diffRefId: "diff-1" }],
      diffRefs: [{ id: "diff-1", path: notePath, format: "unified", ref: `.exo/invocations/${input.id}/diffs/diff-1.patch` }],
      attribution: { status: "likely" },
      review: {
        status: input.status,
        beforeSha256,
        afterSha256,
        ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
      },
    }, null, 2)}\n`),
  ]);
  return { id: input.id, noteRoot, notePath, recordPath, beforeSha256, afterSha256 };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
