import { cp, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
    await expect(service.getFilePayload(resolved, modified.id)).resolves.toMatchObject({ canKeep: true, canReject: false });

    const acceptedCurrent = "newest human work\n";
    await writeFile(fixture.paths.modified, acceptedCurrent, "utf8");
    const kept = await service.resolve(resolved, [{ changeId: modified.id, action: "keep" }]);
    expect(kept.changeset?.files.find((change) => change.id === modified.id)?.decision).toMatchObject({
      status: "kept",
      acceptedSha256: createHash("sha256").update(acceptedCurrent).digest("hex"),
    });
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe(acceptedCurrent);
  });

  it("recovers a journaled Keep-current conflict with its decision-time hash", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const store = new InvocationStore(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    await writeFile(fixture.paths.modified, "conflicting work\n");
    const conflicted = await service.resolve(fixture.record, [{ changeId: modified.id, action: "reject" }]);
    const acceptedAtClick = "accepted at click\n";
    const acceptedSha256 = createHash("sha256").update(acceptedAtClick).digest("hex");
    await writeFile(fixture.paths.modified, acceptedAtClick);
    await store.beginReviewJournal(conflicted.id, [{ changeId: modified.id, action: "keep" }]);
    await store.updateReviewJournalEntry(conflicted.id, modified.id, { status: "applied", acceptedSha256 });
    await writeFile(fixture.paths.modified, "edited after click\n");

    const recovered = await service.recoverJournal(conflicted);

    expect(recovered.changeset?.files.find((change) => change.id === modified.id)?.decision).toMatchObject({
      status: "kept",
      acceptedSha256,
    });
    await expect(readFile(fixture.paths.modified, "utf8")).resolves.toBe("edited after click\n");
    await expect(store.readReviewJournal(conflicted.id)).resolves.toBeNull();
  });

  it("resolves a drift conflict by keeping the exact current file without mutating it", async () => {
    const fixture = await changesetFixture();
    const service = new InvocationReviewService(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    await writeFile(fixture.paths.modified, "newer human work\n", "utf8");
    const conflicted = await service.resolve(fixture.record, [{ changeId: modified.id, action: "reject" }]);

    const resolved = await service.resolve(conflicted, [{ changeId: modified.id, action: "keep" }]);

    expect(resolved.changeset?.files.find((change) => change.id === modified.id)?.decision.status).toBe("kept");
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

  it("removes the unchanged tagged invocation envelope when every visible change is rejected", async () => {
    const fixture = await unchangedTaggedFixture(1);
    const resolved = await new InvocationReviewService(fixture.workspaceRoot).resolve(
      fixture.record,
      fixture.record.changeset!.files.map((change) => ({ changeId: change.id, action: "reject" as const })),
    );

    expect(resolved.changeset?.status).toBe("rejected");
    expect(resolved.changeset?.files).toHaveLength(1);
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(fixture.clean);
    await expect(stat(fixture.createdPaths[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the unchanged tagged invocation envelope when every visible change is kept", async () => {
    const fixture = await unchangedTaggedFixture(1);
    const resolved = await new InvocationReviewService(fixture.workspaceRoot).resolve(
      fixture.record,
      fixture.record.changeset!.files.map((change) => ({ changeId: change.id, action: "keep" as const })),
    );

    expect(resolved.changeset?.status).toBe("kept");
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(fixture.launchText);
    await expect(readFile(fixture.createdPaths[0]!, "utf8")).resolves.toBe("created 0\n");
  });

  it("preserves the unchanged tagged invocation envelope for mixed review decisions", async () => {
    const fixture = await unchangedTaggedFixture(2);
    const [first, second] = fixture.record.changeset!.files;
    const resolved = await new InvocationReviewService(fixture.workspaceRoot).resolve(fixture.record, [
      { changeId: first!.id, action: "reject" },
      { changeId: second!.id, action: "keep" },
    ]);

    expect(resolved.changeset?.status).toBe("resolved");
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(fixture.launchText);
  });

  it("blocks final all-Reject when the unchanged tagged note drifted after settlement", async () => {
    const fixture = await unchangedTaggedFixture(1);
    const drifted = `${fixture.launchText}\nNewer human work.\n`;
    await writeFile(fixture.notePath, drifted);
    const service = new InvocationReviewService(fixture.workspaceRoot);

    const blocked = await service.resolve(
      fixture.record,
      fixture.record.changeset!.files.map((change) => ({ changeId: change.id, action: "reject" as const })),
    );

    expect(blocked.changeset?.status).toBe("conflict");
    expect(blocked.review?.status).toBe("pending");
    const taggedConflict = blocked.changeset!.files.find((change) => change.decision.status === "conflict")!;
    await expect(service.getFilePayload(blocked, taggedConflict.id)).resolves.toMatchObject({
      canKeep: true,
      canReject: false,
    });
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(drifted);
    await expect(readFile(fixture.createdPaths[0]!, "utf8")).resolves.toBe("created 0\n");
    await expect(new InvocationStore(fixture.workspaceRoot).readReviewJournal(fixture.record.id)).resolves.toBeNull();
  });

  it("finishes the implicit tagged clean-base restore from a review journal after restart", async () => {
    const fixture = await unchangedTaggedFixture(1);
    const store = new InvocationStore(fixture.workspaceRoot);
    const change = fixture.record.changeset!.files[0]!;
    await store.beginReviewJournal(fixture.record.id, [
      { changeId: change.id, action: "reject" },
      { changeId: "implicit:tagged-clean-base", action: "reject" },
    ]);
    await rm(fixture.createdPaths[0]!);
    await store.updateReviewJournalEntry(fixture.record.id, change.id, { status: "applied" });

    const recovered = await new InvocationReviewService(fixture.workspaceRoot).recoverJournal(fixture.record);

    expect(recovered.changeset?.status).toBe("rejected");
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(fixture.clean);
    await expect(store.readReviewJournal(fixture.record.id)).resolves.toBeNull();
  });

  it("reconciles applied visible Rejects and exposes tagged drift after restart", async () => {
    const fixture = await unchangedTaggedFixture(1);
    const store = new InvocationStore(fixture.workspaceRoot);
    const change = fixture.record.changeset!.files[0]!;
    await store.beginReviewJournal(fixture.record.id, [
      { changeId: change.id, action: "reject" },
      { changeId: "implicit:tagged-clean-base", action: "reject" },
    ]);
    await rm(fixture.createdPaths[0]!);
    await store.updateReviewJournalEntry(fixture.record.id, change.id, { status: "applied" });
    const drifted = `${fixture.launchText}\nNewer human work.\n`;
    await writeFile(fixture.notePath, drifted);

    const service = new InvocationReviewService(fixture.workspaceRoot);
    const recovered = await service.recoverJournal(fixture.record);

    expect(recovered.changeset?.status).toBe("conflict");
    expect(recovered.changeset?.files.find((entry) => entry.id === change.id)?.decision.status).toBe("rejected");
    const conflict = recovered.changeset!.files.find((entry) => entry.decision.status === "conflict")!;
    await expect(service.getFilePayload(recovered, conflict.id)).resolves.toMatchObject({ canKeep: true, canReject: false });
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(drifted);
    await expect(store.readReviewJournal(fixture.record.id)).resolves.toBeNull();

    const resolved = await service.resolve(recovered, [{ changeId: conflict.id, action: "keep" }]);
    expect(resolved.changeset?.status).toBe("resolved");
    await expect(readFile(fixture.notePath, "utf8")).resolves.toBe(drifted);
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

  it("materializes a journaled conflict instead of clearing an unresolved decision", async () => {
    const fixture = await changesetFixture();
    const store = new InvocationStore(fixture.workspaceRoot);
    const modified = fixture.record.changeset!.files.find((change) => change.operation === "modified")!;
    await store.beginReviewJournal(fixture.record.id, [{ changeId: modified.id, action: "reject" }]);
    await store.updateReviewJournalEntry(fixture.record.id, modified.id, {
      status: "conflict",
      reason: "Simulated crash after conflict journaling.",
    });

    const recovered = await new InvocationReviewService(fixture.workspaceRoot).recoverJournal(fixture.record);

    expect(recovered.changeset?.files.find((change) => change.id === modified.id)?.decision).toMatchObject({
      status: "conflict",
      reason: "Simulated crash after conflict journaling.",
    });
    expect(recovered.review?.status).toBe("pending");
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

async function unchangedTaggedFixture(createdCount: number) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-unchanged-tagged-"));
  temporaryRoots.push(workspaceRoot);
  const noteRoot = path.join(workspaceRoot, "notes");
  const notePath = path.join(noteRoot, "note.md");
  await mkdir(noteRoot);
  const clean = "Human text before request.\n\n";
  const launchText = `${clean}<exo-invocation id="11111111-1111-4111-8111-111111111111" agent="claude" status="sent">\n@claude create files\n</exo-invocation>\n`;
  await writeFile(notePath, launchText);
  const store = new InvocationStore(workspaceRoot);
  const id = `unchanged-tagged-${createdCount}`;
  await store.captureCleanBase(id, { path: notePath, content: clean });
  const launch = await store.captureManifest(id, "launch", [noteRoot]);
  const createdPaths = Array.from({ length: createdCount }, (_value, index) => path.join(noteRoot, `created-${index}.md`));
  await Promise.all(createdPaths.map((createdPath, index) => writeFile(createdPath, `created ${index}\n`)));
  const settled = await store.captureManifest(id, "settled", [noteRoot]);
  const record = invocationRecord(id, workspaceRoot, noteRoot, notePath, buildInvocationChangeset(launch, settled));
  await store.writeRecord(record);
  return { workspaceRoot, notePath, clean, launchText, createdPaths, record };
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
