import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  InvocationStore,
  resolveInvocationFileChange,
  type InvocationChangeset,
  type InvocationCleanBaseRef,
  type InvocationFileChange,
  type InvocationFileState,
  type InvocationRecord,
  type InvocationReviewAction,
} from "@exo/core";

export interface InvocationFileReviewPayload {
  invocation: InvocationRecord;
  change: InvocationFileChange;
  beforeText: string | null;
  afterText: string | null;
  canKeep: boolean;
  canReject: boolean;
}

export class InvocationReviewError extends Error {
  constructor(readonly code: "review-unavailable" | "review-drift", message: string) {
    super(message);
  }
}

interface ReviewResolution {
  changeId: string;
  action: InvocationReviewAction;
}

const IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID = "implicit:tagged-clean-base";

interface ImplicitTaggedRestore {
  cleanBase: InvocationFileState;
  proposal: InvocationFileState;
}

interface FileProbe {
  exists: boolean;
  sha256: string | null;
  mode?: number;
}

type ReviewPreflight =
  | { state: "proposal" | "resolved" | "partial"; currentSha256: string | null }
  | { state: "conflict"; currentSha256: string | null; reason: string };

/** Owns exact, crash-recoverable changeset review over one InvocationStore. */
export class InvocationReviewService {
  private readonly store: InvocationStore;

  constructor(private readonly workspaceRoot: string) {
    this.store = new InvocationStore(workspaceRoot);
  }

  async getFilePayload(record: InvocationRecord, changeId: string): Promise<InvocationFileReviewPayload> {
    const change = record.changeset?.files.find((entry) => entry.id === changeId);
    if (!change) throw new InvocationReviewError("review-unavailable", `Invocation change ${changeId} was not found.`);
    const cleanBase = await this.store.readCleanBase(record.id);
    const reviewBefore = rejectionBeforeState(record, change, cleanBase);
    const [before, after] = await Promise.all([
      reviewBefore ? this.store.readSnapshot(record.id, reviewBefore) : null,
      change.after ? this.store.readSnapshot(record.id, change.after) : null,
    ]);
    return {
      invocation: record,
      change,
      beforeText: reviewBefore?.mediaType === "text" && before ? before.toString("utf8") : null,
      afterText: change.after?.mediaType === "text" && after ? after.toString("utf8") : null,
      canKeep: change.decision.status === "pending" || change.decision.status === "conflict",
      canReject: change.decision.status === "pending",
    };
  }

  async resolve(record: InvocationRecord, resolutions: readonly ReviewResolution[]): Promise<InvocationRecord> {
    if (!record.changeset || record.changeset.files.length === 0) {
      throw new InvocationReviewError("review-unavailable", "This invocation has no reviewable changes.");
    }
    const unique = new Map<string, InvocationReviewAction>();
    for (const resolution of resolutions) {
      if (unique.has(resolution.changeId)) throw new InvocationReviewError("review-unavailable", "A file cannot have two review decisions.");
      unique.set(resolution.changeId, resolution.action);
    }
    const plan = [...unique].map(([changeId, action]) => ({ changeId, action }));
    if (plan.length === 0) return record;
    const changes = plan.map(({ changeId, action }) => {
      const change = record.changeset!.files.find((entry) => entry.id === changeId);
      const reviewable = change?.decision.status === "pending" ||
        change?.decision.status === "conflict" && action === "keep";
      if (!change || !reviewable) {
        throw new InvocationReviewError("review-unavailable", `Invocation change ${changeId} is not pending.`);
      }
      return change;
    });

    const cleanBase = await this.store.readCleanBase(record.id);
    const implicitTaggedRestore = willRejectEntireChangeset(record.changeset, plan)
      ? await this.getImplicitTaggedRestore(record, cleanBase)
      : null;
    assertTaggedCleanBase(
      record,
      changes.filter((_change, index) => plan[index]!.action === "reject"),
      cleanBase,
    );
    const existingJournal = await this.store.readReviewJournal(record.id);
    const resumedJournal = existingJournal !== null;
    await this.store.beginReviewJournal(record.id, implicitTaggedRestore
      ? [...plan, { changeId: IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, action: "reject" }]
      : plan);

    const checks = await Promise.all(changes.map((change, index) =>
      preflightChange(change, plan[index]!.action, rejectionBeforeState(record, change, cleanBase))));
    const conflicts = checks.map((check, index) => ({ check, change: changes[index]! }))
      .filter(({ check }) => check.state === "conflict" || check.state === "partial" && !resumedJournal);
    if (conflicts.length > 0) {
      let changeset = record.changeset;
      const now = new Date().toISOString();
      for (const { check, change } of conflicts) {
        const reason = check.state === "conflict" ? check.reason : "The rename no longer has one exact current state.";
        const currentSha256 = check.currentSha256;
        changeset = resolveInvocationFileChange(changeset, change.id, { status: "conflict", reason, currentSha256 });
        await this.store.updateReviewJournalEntry(record.id, change.id, { status: "conflict", reason, completedAt: now });
      }
      const next = withCompatibilityReview({ ...record, changeset });
      await this.store.writeRecord(next);
      await this.store.clearReviewJournal(record.id);
      return next;
    }
    const implicitCheck = implicitTaggedRestore
      ? await preflightImplicitTaggedRestore(implicitTaggedRestore)
      : null;
    if (implicitCheck?.state === "conflict") {
      const changeset = withImplicitTaggedConflict(record.changeset, implicitTaggedRestore!, implicitCheck);
      const next = withCompatibilityReview({ ...record, changeset });
      await this.store.writeRecord(next);
      await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
        status: "conflict",
        reason: implicitCheck.reason,
      });
      await this.store.clearReviewJournal(record.id);
      return next;
    }

    let changeset: InvocationChangeset = record.changeset;
    const reviewedAt = new Date().toISOString();
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!;
      const action = plan[index]!.action;
      const check = checks[index]!;
      if (action === "reject" && check.state !== "resolved") {
        await rejectChange(
          this.store,
          record.id,
          change,
          rejectionBeforeState(record, change, cleanBase),
          check.state === "partial",
        );
      }
      const decision = action === "keep"
        ? {
            status: "kept" as const,
            reviewedAt,
            acceptedSha256: change.decision.status === "conflict"
              ? check.currentSha256
              : change.after?.sha256 ?? null,
          }
        : { status: "rejected" as const, reviewedAt };
      await this.store.updateReviewJournalEntry(record.id, change.id, {
        status: "applied",
        completedAt: reviewedAt,
        ...(decision.status === "kept" ? { acceptedSha256: decision.acceptedSha256 } : {}),
      });
      changeset = resolveInvocationFileChange(changeset, change.id, decision);
    }
    if (implicitTaggedRestore && implicitCheck) {
      try {
        if (implicitCheck.state === "proposal") {
          await restoreImplicitTaggedCleanBase(this.store, record.id, implicitTaggedRestore);
        }
        await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
          status: "applied",
          completedAt: reviewedAt,
        });
      } catch (error) {
        const check = await implicitConflictFromError(implicitTaggedRestore, error);
        changeset = withImplicitTaggedConflict(changeset, implicitTaggedRestore, check);
        await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
          status: "conflict",
          reason: check.reason,
          completedAt: reviewedAt,
        });
      }
    }
    const next = withCompatibilityReview({ ...record, changeset });
    await this.store.writeRecord(next);
    await this.store.clearReviewJournal(record.id);
    return next;
  }

  async recoverJournal(record: InvocationRecord): Promise<InvocationRecord> {
    const journal = await this.store.readReviewJournal(record.id);
    if (!journal || !record.changeset) return record;
    const cleanBase = await this.store.readCleanBase(record.id);
    const implicitEntry = journal.entries.find((entry) => entry.changeId === IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID);
    const implicitTaggedRestore = implicitEntry
      ? await this.getImplicitTaggedRestore(record, cleanBase)
      : null;
    const implicitCheck = implicitEntry?.status === "pending" && implicitTaggedRestore
      ? await preflightImplicitTaggedRestore(implicitTaggedRestore)
      : null;
    const persistedImplicitConflict = implicitEntry?.status === "conflict" && implicitTaggedRestore
      ? await implicitConflict(
          implicitTaggedRestore,
          implicitEntry.reason ?? "The invocation request could not be removed safely.",
        )
      : null;
    let changeset = record.changeset;
    const completedAt = journal.updatedAt;
    let changed = false;
    let hasConflict = false;
    for (const entry of journal.entries) {
      if (entry.changeId === IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID) continue;
      const change = changeset.files.find((candidate) => candidate.id === entry.changeId);
      const reviewable = change?.decision.status === "pending" ||
        change?.decision.status === "conflict" && entry.action === "keep";
      if (!change || !reviewable) continue;
      if (entry.action === "keep" && entry.status === "applied" && entry.acceptedSha256 !== undefined) {
        changeset = resolveInvocationFileChange(changeset, change.id, {
          status: "kept",
          reviewedAt: entry.completedAt ?? completedAt,
          acceptedSha256: entry.acceptedSha256,
        });
        changed = true;
        continue;
      }
      const reviewBefore = rejectionBeforeState(record, change, cleanBase);
      const check = await preflightChange(change, entry.action, reviewBefore);
      if (entry.status === "conflict") {
        changeset = resolveInvocationFileChange(changeset, change.id, {
          status: "conflict",
          reason: entry.reason ?? "The review encountered a file conflict before Exo could persist it.",
          currentSha256: check.currentSha256,
        });
        changed = true;
        hasConflict = true;
        continue;
      }
      if (entry.action === "reject" && check.state === "partial") {
        await rejectChange(this.store, record.id, change, reviewBefore, true);
        await this.store.updateReviewJournalEntry(record.id, change.id, { status: "applied", completedAt });
        changeset = resolveInvocationFileChange(changeset, change.id, { status: "rejected", reviewedAt: completedAt });
        changed = true;
        continue;
      }
      if (check.state === "resolved" || entry.action === "keep" && check.state === "proposal") {
        if (entry.status !== "applied") {
          await this.store.updateReviewJournalEntry(record.id, change.id, {
            status: "applied",
            completedAt,
            ...(entry.action === "keep" ? { acceptedSha256: check.currentSha256 } : {}),
          });
        }
        changeset = resolveInvocationFileChange(changeset, change.id, entry.action === "keep"
          ? {
              status: "kept",
              reviewedAt: completedAt,
              acceptedSha256: entry.acceptedSha256 !== undefined ? entry.acceptedSha256 : check.currentSha256,
            }
          : { status: "rejected", reviewedAt: completedAt });
        changed = true;
        continue;
      }
      if (check.state === "conflict") {
        changeset = resolveInvocationFileChange(changeset, change.id, {
          status: "conflict",
          reason: check.reason,
          currentSha256: check.currentSha256,
        });
        changed = true;
        hasConflict = true;
      }
    }
    if (!hasConflict && implicitEntry?.status === "pending" && implicitTaggedRestore && implicitCheck) {
      if (implicitCheck.state === "conflict") {
        changeset = withImplicitTaggedConflict(changeset, implicitTaggedRestore, implicitCheck);
        await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
          status: "conflict",
          reason: implicitCheck.reason,
          completedAt,
        });
        changed = true;
      } else {
        try {
          if (implicitCheck.state === "proposal") {
            await restoreImplicitTaggedCleanBase(this.store, record.id, implicitTaggedRestore);
          }
          await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
            status: "applied",
            completedAt,
          });
        } catch (error) {
          const check = await implicitConflictFromError(implicitTaggedRestore, error);
          changeset = withImplicitTaggedConflict(changeset, implicitTaggedRestore, check);
          await this.store.updateReviewJournalEntry(record.id, IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID, {
            status: "conflict",
            reason: check.reason,
            completedAt,
          });
          changed = true;
        }
      }
    }
    if (!hasConflict && persistedImplicitConflict && implicitTaggedRestore) {
      changeset = withImplicitTaggedConflict(changeset, implicitTaggedRestore, persistedImplicitConflict);
      changed = true;
    }
    if (!changed) {
      const unresolvedJournalConflict = journal.entries.some((entry) =>
        entry.status === "conflict" && !hasDurableConflict(record, entry.changeId));
      if (unresolvedJournalConflict) return record;
      await this.store.clearReviewJournal(record.id);
      return record;
    }
    const next = withCompatibilityReview({ ...record, changeset });
    await this.store.writeRecord(next);
    await this.store.clearReviewJournal(record.id);
    return next;
  }

  private async getImplicitTaggedRestore(
    record: InvocationRecord,
    cleanBase: InvocationCleanBaseRef | null,
  ): Promise<ImplicitTaggedRestore | null> {
    if (!record.taggedDocumentPath) return null;
    if (!cleanBase) {
      throw new InvocationReviewError("review-unavailable", "The exact clean invocation base is unavailable.");
    }
    const taggedIsVisibleChange = record.changeset?.files.some((change) =>
      change.before?.path === cleanBase.file.path || change.after?.path === cleanBase.file.path ||
      change.before?.path === record.taggedDocumentPath || change.after?.path === record.taggedDocumentPath);
    if (taggedIsVisibleChange) return null;
    const settled = await this.store.readManifest(record.id, "settled");
    const proposal = settled?.files[cleanBase.file.path];
    if (!proposal) {
      throw new InvocationReviewError("review-unavailable", "The settled invocation document snapshot is unavailable.");
    }
    return { cleanBase: cleanBase.file, proposal };
  }
}

function hasDurableConflict(record: InvocationRecord, changeId: string): boolean {
  if (changeId === IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID) {
    return Boolean(record.changeset?.files.some((change) =>
      change.id.startsWith(`${IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID}:`) && change.decision.status === "conflict"));
  }
  return record.changeset?.files.find((change) => change.id === changeId)?.decision.status === "conflict";
}

function willRejectEntireChangeset(
  changeset: InvocationChangeset,
  plan: readonly ReviewResolution[],
): boolean {
  const planned = new Map(plan.map((entry) => [entry.changeId, entry.action]));
  return changeset.files.every((change) =>
    change.decision.status === "rejected" ||
    change.decision.status === "pending" && planned.get(change.id) === "reject");
}

async function preflightImplicitTaggedRestore(restore: ImplicitTaggedRestore): Promise<ReviewPreflight> {
  const current = await probeFile(restore.proposal.path);
  if (matchesState(current, restore.cleanBase)) return { state: "resolved", currentSha256: current.sha256 };
  if (matchesState(current, restore.proposal)) return { state: "proposal", currentSha256: current.sha256 };
  return drift(current.sha256);
}

async function restoreImplicitTaggedCleanBase(
  store: InvocationStore,
  invocationId: string,
  restore: ImplicitTaggedRestore,
): Promise<void> {
  const bytes = await requiredSnapshot(store, invocationId, restore.cleanBase);
  await replaceVerifiedProposal(restore.proposal, restore.cleanBase, bytes);
}

async function implicitConflictFromError(
  restore: ImplicitTaggedRestore,
  error: unknown,
): Promise<Extract<ReviewPreflight, { state: "conflict" }>> {
  const detail = error instanceof Error ? error.message : String(error);
  return implicitConflict(restore, `The invocation request could not be removed safely. ${detail}`);
}

async function implicitConflict(
  restore: ImplicitTaggedRestore,
  reason: string,
): Promise<Extract<ReviewPreflight, { state: "conflict" }>> {
  let currentSha256: string | null = null;
  try {
    currentSha256 = (await probeFile(restore.proposal.path)).sha256;
  } catch {
    // The conflict remains reachable even when probing the current file is
    // itself what failed; Keep-current can probe again at decision time.
  }
  return {
    state: "conflict",
    currentSha256,
    reason,
  };
}

function withImplicitTaggedConflict(
  changeset: InvocationChangeset,
  restore: ImplicitTaggedRestore,
  conflict: Extract<ReviewPreflight, { state: "conflict" }>,
): InvocationChangeset {
  const id = `${IMPLICIT_TAGGED_CLEAN_BASE_CHANGE_ID}:${restore.proposal.path}`;
  const synthetic: InvocationFileChange = {
    id,
    operation: "modified",
    before: restore.cleanBase,
    after: restore.proposal,
    decision: {
      status: "conflict",
      reason: conflict.reason,
      currentSha256: conflict.currentSha256,
    },
  };
  const { resolvedAt: _resolvedAt, ...unresolved } = changeset;
  return {
    ...unresolved,
    status: "conflict",
    files: [...changeset.files.filter((change) => change.id !== id), synthetic],
  };
}

export function withCompatibilityReview(record: InvocationRecord): InvocationRecord {
  const changeset = record.changeset;
  if (!changeset || changeset.files.length === 0) return { ...record, review: undefined };
  const tagged = record.taggedDocumentPath
    ? changeset.files.find((change) => change.before?.path === record.taggedDocumentPath || change.after?.path === record.taggedDocumentPath)
    : undefined;
  const representative = tagged ?? changeset.files[0]!;
  const terminal = changeset.files.every((change) =>
    change.decision.status === "kept" || change.decision.status === "rejected");
  const allRejected = changeset.files.every((change) => change.decision.status === "rejected");
  const reviewedAt = changeset.resolvedAt ?? changeset.files
    .map((change) => "reviewedAt" in change.decision ? change.decision.reviewedAt : undefined)
    .filter((value): value is string => Boolean(value))
    .sort().at(-1);
  return {
    ...record,
    review: {
      status: terminal ? allRejected ? "rejected" : "kept" : "pending",
      beforeSha256: representative.before?.sha256 ?? null,
      afterSha256: representative.after?.sha256 ?? null,
      ...(reviewedAt ? { reviewedAt } : {}),
    },
  };
}

async function preflightChange(
  change: InvocationFileChange,
  action: InvocationReviewAction,
  rejectionBefore: InvocationFileState | undefined,
): Promise<ReviewPreflight> {
  if (action === "keep") {
    const currentSha256 = change.decision.status === "conflict"
      ? (await probeFile(change.after?.path ?? change.before!.path)).sha256
      : change.after?.sha256 ?? null;
    return { state: "proposal", currentSha256 };
  }
  const beforePath = change.before?.path;
  const afterPath = change.after?.path;
  const beforeCurrent = beforePath ? await probeFile(beforePath) : absentProbe();
  const afterCurrent = afterPath && afterPath !== beforePath ? await probeFile(afterPath) : beforeCurrent;
  const proposal = matchesProposal(change, beforeCurrent, afterCurrent);
  const resolved = matchesRejected(change, beforeCurrent, afterCurrent, rejectionBefore);
  if (resolved) return { state: "resolved", currentSha256: beforeCurrent.sha256 };
  if (proposal) return { state: "proposal", currentSha256: afterCurrent.sha256 };
  if (change.operation === "renamed" && matchesState(beforeCurrent, rejectionBefore) && matchesState(afterCurrent, change.after)) {
    return { state: "partial", currentSha256: afterCurrent.sha256 };
  }
  return drift(afterCurrent.sha256 ?? beforeCurrent.sha256);
}

function matchesProposal(change: InvocationFileChange, before: FileProbe, after: FileProbe): boolean {
  if (change.operation === "created" || change.operation === "modified") return matchesState(after, change.after);
  if (change.operation === "deleted") return !before.exists;
  return !before.exists && matchesState(after, change.after);
}

function matchesRejected(
  change: InvocationFileChange,
  before: FileProbe,
  after: FileProbe,
  rejectionBefore: InvocationFileState | undefined,
): boolean {
  if (change.operation === "created") return !after.exists;
  if (change.operation === "modified" || change.operation === "deleted") return matchesState(before, rejectionBefore);
  return matchesState(before, rejectionBefore) && !after.exists;
}

function matchesState(current: FileProbe, expected: InvocationFileState | undefined): boolean {
  return Boolean(expected && current.exists && current.sha256 === expected.sha256 &&
    (expected.mode === undefined || current.mode === expected.mode));
}

function drift(currentSha256: string | null): ReviewPreflight {
  return {
    state: "conflict",
    currentSha256,
    reason: "The file changed after this proposal. Exo did not overwrite newer work.",
  };
}

async function rejectChange(
  store: InvocationStore,
  invocationId: string,
  change: InvocationFileChange,
  rejectionBefore: InvocationFileState | undefined,
  finishPartialRename: boolean,
): Promise<void> {
  if (change.operation === "created") {
    await removeVerifiedProposal(change.after!);
    return;
  }
  if (change.operation === "modified" || change.operation === "deleted") {
    if (!rejectionBefore) throw new InvocationReviewError("review-unavailable", "The rejection base is unavailable.");
    const bytes = await requiredSnapshot(store, invocationId, rejectionBefore);
    if (change.operation === "modified") {
      await replaceVerifiedProposal(change.after!, rejectionBefore, bytes);
    } else {
      await installSnapshotNoClobber(rejectionBefore, bytes);
    }
    return;
  }
  if (!finishPartialRename) {
    if (!rejectionBefore) throw new InvocationReviewError("review-unavailable", "The rejection base is unavailable.");
    const bytes = await requiredSnapshot(store, invocationId, rejectionBefore);
    const quarantine = await quarantineVerifiedProposal(change.after!);
    try {
      await installSnapshotNoClobber(rejectionBefore, bytes);
      await rm(quarantine);
    } catch (error) {
      await restoreQuarantine(quarantine, change.after!.path);
      throw error;
    }
    return;
  }
  await removeVerifiedProposal(change.after!);
}

async function requiredSnapshot(store: InvocationStore, invocationId: string, state: InvocationFileState): Promise<Buffer> {
  const bytes = await store.readSnapshot(invocationId, state);
  if (!bytes) throw new InvocationReviewError("review-unavailable", `Snapshot ${state.sha256} is unavailable.`);
  return bytes;
}

async function installSnapshotNoClobber(state: InvocationFileState, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(state.path), { recursive: true });
  const temporaryPath = path.join(path.dirname(state.path), `.${path.basename(state.path)}.exo-review-${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", state.mode ?? 0o666);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();
  if (state.mode !== undefined) await chmod(temporaryPath, state.mode);
  try {
    await link(temporaryPath, state.path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (isNodeErrorCode(error, "EEXIST")) {
      throw new InvocationReviewError("review-drift", "The file changed during review. Exo did not overwrite it.");
    }
    throw error;
  }
  await rm(temporaryPath);
}

async function replaceVerifiedProposal(
  proposal: InvocationFileState,
  replacement: InvocationFileState,
  replacementBytes: Buffer,
): Promise<void> {
  const quarantine = await quarantineVerifiedProposal(proposal);
  try {
    await installSnapshotNoClobber(replacement, replacementBytes);
    await rm(quarantine);
  } catch (error) {
    await restoreQuarantine(quarantine, proposal.path);
    throw error;
  }
}

async function removeVerifiedProposal(proposal: InvocationFileState): Promise<void> {
  const quarantine = await quarantineVerifiedProposal(proposal);
  await rm(quarantine);
}

async function quarantineVerifiedProposal(proposal: InvocationFileState): Promise<string> {
  const quarantine = path.join(path.dirname(proposal.path), `.${path.basename(proposal.path)}.exo-review-${randomUUID()}.quarantine`);
  try {
    await rename(proposal.path, quarantine);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new InvocationReviewError("review-drift", "The file changed during review. Exo did not delete it.");
    }
    throw error;
  }
  const moved = await probeFile(quarantine);
  if (!matchesState(moved, proposal)) {
    await restoreQuarantine(quarantine, proposal.path);
    throw new InvocationReviewError("review-drift", "The file changed during review. Exo restored it without applying Reject.");
  }
  return quarantine;
}

async function restoreQuarantine(quarantine: string, target: string): Promise<void> {
  try {
    await link(quarantine, target);
    await rm(quarantine);
  } catch (error) {
    if (isNodeErrorCode(error, "EEXIST")) {
      throw new InvocationReviewError(
        "review-drift",
        `The file changed during review. The newer file was preserved and the proposal remains at ${quarantine}.`,
      );
    }
    throw error;
  }
}

function rejectionBeforeState(
  record: InvocationRecord,
  change: InvocationFileChange,
  cleanBase: InvocationCleanBaseRef | null,
): InvocationFileState | undefined {
  return record.taggedDocumentPath && cleanBase?.file.path === change.before?.path
    ? cleanBase?.file
    : change.before;
}

function assertTaggedCleanBase(
  record: InvocationRecord,
  changes: readonly InvocationFileChange[],
  cleanBase: InvocationCleanBaseRef | null,
): void {
  if (!record.taggedDocumentPath) return;
  const tagged = changes.find((change) =>
    cleanBase?.file.path === change.before?.path || change.before?.path === record.taggedDocumentPath || change.after?.path === record.taggedDocumentPath);
  if (!tagged) return;
  if (tagged.operation === "created" || !cleanBase || tagged.before?.path !== cleanBase.file.path) {
    throw new InvocationReviewError("review-unavailable", "The exact clean invocation base is unavailable.");
  }
}

async function probeFile(filePath: string): Promise<FileProbe> {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return absentProbe();
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) return { exists: true, sha256: null, mode: before.mode & 0o777 };
    const digest = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
    const after = await handle.stat();
    const current = await lstat(filePath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      after.dev !== current.dev || after.ino !== current.ino || after.size !== current.size || after.mtimeMs !== current.mtimeMs) {
      return { exists: true, sha256: null, mode: current.mode & 0o777 };
    }
    return { exists: true, sha256: digest.digest("hex"), mode: after.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

function absentProbe(): FileProbe {
  return { exists: false, sha256: null };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
