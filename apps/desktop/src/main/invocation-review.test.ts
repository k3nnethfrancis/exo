import { cp, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildInvocationChangeset,
  createDefaultClaudeAgentCommand,
  agentCommandSnapshot,
  InvocationStore,
  type InvocationRecord,
} from "@exo/core";

import { InvocationReviewService } from "./invocation-review";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("InvocationReviewService", () => {
  it("reverses multi-file create, modify, delete, and pure rename exactly", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const resolutions = fixture.record.changeset!.files.map((change) => ({ changeId: change.id, action: "reject" as const }));

    const resolved = await service.resolve(fixture.record, resolutions);

    expect(resolved.changeset?.status).toBe("rejected");
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("before\n");
    await expect(readFile(fixture.paths.deleted, "utf8")).resolves.toBe("delete\n");
    await expect(readFile(fixture.paths.renamedFrom, "utf8")).resolves.toBe("rename\n");
    await expect(stat(fixture.paths.created)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(fixture.paths.renamedTo)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(fixture.paths.modified)).mode & 0o777).toBe(0o640);
    await expect(new InvocationStore(fixture.workspaceRoot).readReviewJournal(fixture.record.id)).resolves.toBeNull();
  });

  it("supports mixed per-file decisions without leaving the changeset pending", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    const created = fixture.record.changeset!.files.find((change) => change.operation === "created")!;

    let record = await service.resolve(fixture.record, [{ changeId: modified.id, action: "reject" }]);
    record = await service.resolve(record, [{ changeId: created.id, action: "keep" }]);
    const remaining = record.changeset!.files
      .filter((change) => change.decision.status === "pending")
      .map((change) => ({ changeId: change.id, action: "keep" as const }));
    record = await service.resolve(record, remaining);

    expect(record.changeset?.status).toBe("resolved");
    expect(record.changeset?.files.map((change) => change.decision.status).sort()).toEqual([
      "kept", "kept", "kept", "rejected",
    ]);
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("before\n");
    await expect(readFile(fixture.paths.created, "utf8")).resolves.toBe("created\n");
  });

  it("records Keep without touching or blocking on newer file edits", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    await writeFile(fixture.paths.modified, "newer human work\n", "utf8");

    const resolved = await service.resolve(fixture.record, [{ changeId: modified.id, action: "keep" }]);

    expect(resolved.changeset?.files.find((change) => change.id === modified.id)?.decision.status).toBe("kept");
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("newer human work\n");
  });

  it("marks Reject drift as conflict without mutating the file", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    await writeFile(fixture.paths.modified, "newer human work\n", "utf8");

    const resolved = await service.resolve(fixture.record, [{ changeId: modified.id, action: "reject" }]);

    expect(resolved.changeset?.files.find((change) => change.id === modified.id)?.decision.status).toBe("conflict");
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("newer human work\n");
  });

  it("uses the clean protocol base for Reject and preserves frontmatter bytes", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-envelope-review-"));
    temporaryRoots.push(workspaceRoot);
    const noteRoot = path.join(workspaceRoot, "notes");
    const notePath = path.join(noteRoot, "note.md");
    await mkdir(noteRoot);
    const clean = "---\ntitle: Exact\ntags: [one, two]\n---\nHuman text before request.\n\n";
    const launchText = `${clean}<exo-invocation id=\"11111111-1111-4111-8111-111111111111\" agent=\"claude\" status=\"sent\">\n@claude edit\n</exo-invocation>\n`;
    await writeFile(notePath, launchText);
    const store = new InvocationStore(workspaceRoot);
    const id = "envelope-review";
    await store.captureCleanBase(id, { path: notePath, content: clean });
    const launch = await store.captureManifest(id, "launch", [noteRoot]);
    await writeFile(notePath, `${launchText}\nAgent edit.\n`);
    const settled = await store.captureManifest(id, "settled", [noteRoot]);
    const record = invocationRecord(id, workspaceRoot, noteRoot, notePath, buildInvocationChangeset(launch, settled));
    await store.writeRecord(record);

    const change = record.changeset!.files[0]!;
    const resolved = await new InvocationReviewService(workspaceRoot).resolve(record, [{ changeId: change.id, action: "reject" }]);

    expect(resolved.changeset?.status).toBe("rejected");
    await expect(readFile(notePath, "utf8")).resolves.toBe(clean);
  });

  it.each(["deleted", "renamed"] as const)("restores the clean tagged note when the proposal %s it", async (operation) => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-tagged-path-review-"));
    temporaryRoots.push(workspaceRoot);
    const noteRoot = path.join(workspaceRoot, "notes");
    const notePath = path.join(noteRoot, "note.md");
    const renamedPath = path.join(noteRoot, "renamed.md");
    await mkdir(noteRoot);
    const clean = "Human text before request.\n\n";
    const launchText = `${clean}<exo-invocation id=\"11111111-1111-4111-8111-111111111111\" agent=\"claude\" status=\"sent\">\n@claude organize\n</exo-invocation>\n`;
    await writeFile(notePath, launchText);
    const store = new InvocationStore(workspaceRoot);
    const id = `tagged-${operation}`;
    await store.captureCleanBase(id, { path: notePath, content: clean });
    const launch = await store.captureManifest(id, "launch", [noteRoot]);
    if (operation === "deleted") await rm(notePath);
    else await cp(notePath, renamedPath).then(() => rm(notePath));
    const settled = await store.captureManifest(id, "settled", [noteRoot]);
    const record = invocationRecord(id, workspaceRoot, noteRoot, notePath, buildInvocationChangeset(launch, settled));
    await store.writeRecord(record);

    const change = record.changeset!.files.find((entry) => entry.operation === operation)!;
    await new InvocationReviewService(workspaceRoot).resolve(record, [{ changeId: change.id, action: "reject" }]);

    await expect(readFile(notePath, "utf8")).resolves.toBe(clean);
    if (operation === "renamed") await expect(stat(renamedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preflights the full batch before writing any rejection", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    const created = fixture.record.changeset!.files.find((change) => change.operation === "created")!;
    await writeFile(fixture.paths.created, "drift\n", "utf8");

    const resolved = await service.resolve(fixture.record, [
      { changeId: modified.id, action: "reject" },
      { changeId: created.id, action: "reject" },
    ]);

    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("after\n");
    await expect(readFile(fixture.paths.created, "utf8")).resolves.toBe("drift\n");
    expect(resolved.changeset?.files.find((change) => change.id === modified.id)?.decision.status).toBe("pending");
    expect(resolved.changeset?.files.find((change) => change.id === created.id)?.decision.status).toBe("conflict");
  });

  it("finishes a journaled partial rename after restart", async () => {
    const fixture = await changesetFixture();
    const store = new InvocationStore(fixture.workspaceRoot);
    const rename = fixture.record.changeset!.files.find((change) => change.operation === "renamed")!;
    await store.beginReviewJournal(fixture.record.id, [{ changeId: rename.id, action: "reject" }], "2026-07-20T12:00:00.000Z");
    await cp(fixture.paths.renamedTo, fixture.paths.renamedFrom);

    const recovered = await new InvocationReviewService(fixture.workspaceRoot).recoverJournal(fixture.record);

    expect(recovered.changeset?.files.find((change) => change.id === rename.id)?.decision.status).toBe("rejected");
    await expect(readFile(fixture.paths.renamedFrom, "utf8")).resolves.toBe("rename\n");
    await expect(stat(fixture.paths.renamedTo)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.readReviewJournal(fixture.record.id)).resolves.toBeNull();
  });
});

async function changesetFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-review-"));
  temporaryRoots.push(workspaceRoot);
  const noteRoot = path.join(workspaceRoot, "notes");
  const paths = {
    modified: path.join(noteRoot, "modified.md"),
    deleted: path.join(noteRoot, "deleted.md"),
    renamedFrom: path.join(noteRoot, "old.md"),
    renamedTo: path.join(noteRoot, "new.md"),
    created: path.join(noteRoot, "created.md"),
  };
  await mkdir(noteRoot);
  await Promise.all([
    writeFile(paths.modified, "before\n"),
    writeFile(paths.deleted, "delete\n"),
    writeFile(paths.renamedFrom, "rename\n"),
  ]);
  await chmod(paths.modified, 0o640);
  const id = "review-fixture";
  const store = new InvocationStore(workspaceRoot);
  await store.captureCleanBase(id, { path: paths.modified, content: "before\n" });
  const launch = await store.captureManifest(id, "launch", [noteRoot], { capturedAt: "2026-07-20T10:00:00.000Z" });
  await Promise.all([
    writeFile(paths.modified, "after\n"),
    rm(paths.deleted),
    cp(paths.renamedFrom, paths.renamedTo).then(() => rm(paths.renamedFrom)),
    writeFile(paths.created, "created\n"),
  ]);
  const settled = await store.captureManifest(id, "settled", [noteRoot], { capturedAt: "2026-07-20T10:01:00.000Z" });
  const changeset = buildInvocationChangeset(launch, settled);
  const record = invocationRecord(id, workspaceRoot, noteRoot, paths.modified, changeset);
  await store.writeRecord(record);
  return { workspaceRoot, noteRoot, paths, record };
}

function invocationRecord(
  id: string,
  workspaceRoot: string,
  noteRoot: string,
  taggedDocumentPath: string,
  changeset: ReturnType<typeof buildInvocationChangeset>,
): InvocationRecord {
  return {
    id,
    workspaceRoot,
    noteRoots: [noteRoot],
    status: "process-exited",
    context: "note",
    taggedDocumentPath,
    originalMentionText: "@claude",
    mentionProvenance: "human-authored",
    message: "change files",
    promptDelivery: "stdin",
    command: agentCommandSnapshot(createDefaultClaudeAgentCommand()),
    cwd: noteRoot,
    createdAt: "2026-07-20T10:00:00.000Z",
    endedAt: "2026-07-20T10:01:00.000Z",
    continuity: { policy: "fresh", outcome: "fresh" },
    changedFileRefs: [],
    diffRefs: [],
    attribution: { status: "likely" },
    changeset,
  };
}
