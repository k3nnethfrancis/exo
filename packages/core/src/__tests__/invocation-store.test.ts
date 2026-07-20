import { spawnSync } from "node:child_process";
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
    changedFileRefs: [],
    diffRefs: [],
    attribution: { status: "pending" },
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

  it("keeps invocation records under the repository gitignored .exo runtime tree", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const result = spawnSync("git", ["check-ignore", "--quiet", ".exo/invocations/invocation-1/record.json"], {
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
  });
});
