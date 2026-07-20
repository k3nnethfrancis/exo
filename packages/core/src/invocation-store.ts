import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { normalizeInvocationRecord, type InvocationRecord } from "./agent-invocation";
import {
  InvocationArtifactStore,
  type InvocationArtifactRecovery,
  type InvocationArtifactCompactionReport,
  type InvocationCleanBaseInput,
  type InvocationCleanBaseRef,
  type InvocationManifestCaptureOptions,
  type InvocationManifestPhase,
  type InvocationLaunchArtifactInput,
  type InvocationLaunchArtifacts,
  type InvocationProcessOwnership,
  type InvocationReviewJournal,
  type InvocationReviewJournalInput,
  type InvocationReviewMutation,
} from "./invocation-artifacts";
import {
  deriveInvocationChangesetStatus,
  type InvocationChangeset,
  type InvocationFileReviewDecision,
  type InvocationFileState,
  type InvocationWorkspaceManifest,
} from "./invocation-changeset";
import { safeStoreSegment } from "./store-paths";

export interface InvocationStoreLayout {
  workspaceRoot: string;
  runtimeRoot: string;
  invocationsDir: string;
}

export function resolveInvocationStoreLayout(workspaceRoot: string): InvocationStoreLayout {
  const runtimeRoot = path.join(workspaceRoot, ".exo");
  return {
    workspaceRoot,
    runtimeRoot,
    invocationsDir: path.join(runtimeRoot, "invocations"),
  };
}

export function invocationRecordPath(layout: InvocationStoreLayout, invocationId: string): string {
  return path.join(layout.invocationsDir, safeStoreSegment(invocationId), "record.json");
}

export class InvocationStore {
  readonly layout: InvocationStoreLayout;
  private readonly artifacts: InvocationArtifactStore;

  constructor(workspaceRoot: string) {
    this.layout = resolveInvocationStoreLayout(workspaceRoot);
    this.artifacts = new InvocationArtifactStore(this.layout.invocationsDir);
  }

  async writeRecord(record: InvocationRecord): Promise<string> {
    const normalized = normalizeInvocationRecord(record);
    if (!normalized) {
      throw new Error("Invocation record is incomplete.");
    }

    const target = invocationRecordPath(this.layout, normalized.id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeJsonAtomically(target, normalized);
    return target;
  }

  async readRecord(invocationId: string): Promise<InvocationRecord | null> {
    const artifactId = safeStoreSegment(invocationId);
    const raw = await readJsonOrNull(invocationRecordPath(this.layout, invocationId));
    return this.normalizeStoredRecord(raw, artifactId);
  }

  async listRecords(): Promise<InvocationRecord[]> {
    const entries = await this.listInvocationIds();

    const records = await Promise.all(entries.map(async (entry) => {
      const raw = await readJsonOrNull(path.join(this.layout.invocationsDir, entry, "record.json"));
      return this.normalizeStoredRecord(raw, entry);
    }));
    return records
      .filter((record): record is InvocationRecord => Boolean(record))
      .sort((left, right) => {
        const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
        return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
      });
  }

  /** Enumerate the durable boundary, not just records that still normalize.
   * Recovery uses this so a missing or damaged record cannot hide process
   * ownership or other invocation artifacts. */
  async listInvocationIds(): Promise<string[]> {
    try {
      const dirents = await readdir(this.layout.invocationsDir, { withFileTypes: true });
      return dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) return [];
      throw error;
    }
  }

  captureManifest(
    invocationId: string,
    phase: InvocationManifestPhase,
    noteRoots: readonly string[],
    options?: InvocationManifestCaptureOptions,
  ): Promise<InvocationWorkspaceManifest> {
    return this.artifacts.captureManifest(invocationId, phase, noteRoots, options);
  }

  captureLaunchArtifacts(invocationId: string, input: InvocationLaunchArtifactInput): Promise<InvocationLaunchArtifacts> {
    return this.artifacts.captureLaunchArtifacts(invocationId, input);
  }

  readManifest(invocationId: string, phase: InvocationManifestPhase): Promise<InvocationWorkspaceManifest | null> {
    return this.artifacts.readManifest(invocationId, phase);
  }

  captureCleanBase(invocationId: string, input: InvocationCleanBaseInput): Promise<InvocationCleanBaseRef> {
    return this.artifacts.captureCleanBase(invocationId, input);
  }

  readCleanBase(invocationId: string): Promise<InvocationCleanBaseRef | null> {
    return this.artifacts.readCleanBase(invocationId);
  }

  readSnapshot(invocationId: string, state: InvocationFileState): Promise<Buffer | null> {
    return this.artifacts.readSnapshot(invocationId, state);
  }

  beginReviewJournal(
    invocationId: string,
    inputs: readonly InvocationReviewJournalInput[],
    createdAt?: string,
  ): Promise<InvocationReviewJournal> {
    return this.artifacts.beginReviewJournal(invocationId, inputs, createdAt);
  }

  updateReviewJournalEntry(
    invocationId: string,
    changeId: string,
    outcome: { status: "applied"; completedAt?: string; acceptedSha256?: string | null } | { status: "conflict"; reason: string; completedAt?: string },
  ): Promise<InvocationReviewJournal> {
    return this.artifacts.updateReviewJournalEntry(invocationId, changeId, outcome);
  }

  updateReviewJournalMutation(
    invocationId: string,
    changeId: string,
    mutation: InvocationReviewMutation,
    updatedAt?: string,
  ): Promise<InvocationReviewJournal> {
    return this.artifacts.updateReviewJournalMutation(invocationId, changeId, mutation, updatedAt);
  }

  readReviewJournal(invocationId: string): Promise<InvocationReviewJournal | null> {
    return this.artifacts.readReviewJournal(invocationId);
  }

  clearReviewJournal(invocationId: string): Promise<void> {
    return this.artifacts.clearReviewJournal(invocationId);
  }

  writeProcessOwnership(invocationId: string, ownership: InvocationProcessOwnership): Promise<void> {
    return this.artifacts.writeProcessOwnership(invocationId, ownership);
  }

  readProcessOwnership(invocationId: string): Promise<InvocationProcessOwnership | null> {
    return this.artifacts.readProcessOwnership(invocationId);
  }

  clearProcessOwnership(invocationId: string): Promise<void> {
    return this.artifacts.clearProcessOwnership(invocationId);
  }

  readArtifactRecovery(invocationId: string): Promise<InvocationArtifactRecovery> {
    return this.artifacts.readRecovery(invocationId);
  }

  listArtifactRecoveries(): Promise<InvocationArtifactRecovery[]> {
    return this.artifacts.listRecoverable();
  }

  compactArtifacts(invocationId: string, changeset: InvocationChangeset): Promise<InvocationArtifactCompactionReport> {
    return this.artifacts.compact(invocationId, changeset);
  }

  private async normalizeStoredRecord(raw: unknown, artifactId: string): Promise<InvocationRecord | null> {
    const normalized = normalizeInvocationRecord(raw);
    if (!normalized) return null;
    // Exact records keep the existing normalization path. A malformed current
    // Changeset never falls back to retired evidence.
    if (hasOwn(raw, "changeset")) return normalized;
    if (!hasOwn(raw, "review")) return normalized;
    if (safeStoreSegment(normalized.id) !== artifactId) {
      throw new Error(`Invocation ${artifactId} cannot migrate because record.json names a different invocation.`);
    }
    return this.migrateLegacyReview(raw, normalized, artifactId);
  }

  private async migrateLegacyReview(
    raw: unknown,
    record: InvocationRecord,
    artifactId: string,
  ): Promise<InvocationRecord> {
    const review = parseLegacyReview((raw as Record<string, unknown>).review, record.id);
    if (record.context !== "note" || !record.taggedDocumentPath || !path.isAbsolute(record.taggedDocumentPath) ||
      path.resolve(record.taggedDocumentPath) !== record.taggedDocumentPath) {
      throw new Error(`Invocation ${record.id} cannot migrate its legacy review without one exact tagged document path.`);
    }
    const taggedDocumentPath = record.taggedDocumentPath;
    if (record.workspaceRoot && path.resolve(record.workspaceRoot) !== path.resolve(this.layout.workspaceRoot)) {
      throw new Error(`Invocation ${record.id} cannot migrate from a different Workspace.`);
    }

    const invocationDir = path.join(this.layout.invocationsDir, artifactId);
    const [beforeBytes, afterBytes] = await Promise.all([
      readRequiredLegacyArtifact(path.join(invocationDir, "before.md"), record.id),
      readRequiredLegacyArtifact(path.join(invocationDir, "after.md"), record.id),
    ]);
    assertLegacyArtifactHash(record.id, "before.md", beforeBytes, review.beforeSha256);
    assertLegacyArtifactHash(record.id, "after.md", afterBytes, review.afterSha256);
    if (review.beforeSha256 === null) {
      throw new Error(`Invocation ${record.id} cannot migrate a legacy review without an original tagged document.`);
    }
    if (review.afterSha256 === review.beforeSha256) {
      throw new Error(`Invocation ${record.id} legacy review does not describe a document change.`);
    }

    const inferredRoot = path.dirname(taggedDocumentPath);
    const noteRoots = record.noteRoots?.length ? record.noteRoots : [inferredRoot];
    if (!noteRoots.some((root) => isWithin(root, taggedDocumentPath))) {
      throw new Error(`Invocation ${record.id} legacy review path is outside its recorded Note Roots.`);
    }
    const settledAt = record.endedAt ?? record.createdAt;
    const artifacts = await this.artifacts.migrateLegacySingleFileReview(record.id, {
      filePath: taggedDocumentPath,
      noteRoots,
      before: beforeBytes,
      beforeSha256: review.beforeSha256,
      after: review.afterSha256 === null ? null : afterBytes,
      afterSha256: review.afterSha256,
      capturedAt: record.startedAt ?? record.createdAt,
      settledAt,
    });
    const operation = artifacts.after ? "modified" as const : "deleted" as const;
    const decision = legacyReviewDecision(review, artifacts.after?.sha256 ?? null);
    const changeset: InvocationChangeset = {
      version: 1,
      status: deriveInvocationChangesetStatus([{ decision }]),
      files: [{
        id: `${operation}:${taggedDocumentPath}`,
        operation,
        decision,
        before: artifacts.before,
        ...(artifacts.after ? { after: artifacts.after } : {}),
      }],
      settledAt,
      ...(review.status === "pending" ? {} : { resolvedAt: review.reviewedAt }),
    };
    const migrated: InvocationRecord = {
      ...record,
      workspaceRoot: this.layout.workspaceRoot,
      noteRoots: artifacts.noteRoots,
      changeset,
    };
    await this.writeRecord(migrated);
    return migrated;
  }
}

interface LegacyReview {
  status: "pending" | "kept" | "rejected";
  beforeSha256: string | null;
  afterSha256: string | null;
  reviewedAt?: string;
}

function parseLegacyReview(value: unknown, invocationId: string): LegacyReview {
  if (!value || typeof value !== "object") {
    throw new Error(`Invocation ${invocationId} has an invalid legacy review.`);
  }
  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  const beforeSha256 = nullableSha256(candidate.beforeSha256);
  const afterSha256 = nullableSha256(candidate.afterSha256);
  if ((status !== "pending" && status !== "kept" && status !== "rejected") ||
    beforeSha256 === undefined || afterSha256 === undefined) {
    throw new Error(`Invocation ${invocationId} has an invalid legacy review.`);
  }
  if (status !== "pending" && (typeof candidate.reviewedAt !== "string" || !candidate.reviewedAt.trim())) {
    throw new Error(`Invocation ${invocationId} legacy ${status} review has no durable decision time.`);
  }
  return {
    status,
    beforeSha256,
    afterSha256,
    ...(status === "pending" ? {} : { reviewedAt: candidate.reviewedAt as string }),
  };
}

function legacyReviewDecision(
  review: LegacyReview,
  acceptedSha256: string | null,
): InvocationFileReviewDecision {
  if (review.status === "pending") return { status: "pending" };
  if (review.status === "kept") {
    return { status: "kept", reviewedAt: review.reviewedAt!, acceptedSha256 };
  }
  return { status: "rejected", reviewedAt: review.reviewedAt! };
}

function nullableSha256(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

async function readRequiredLegacyArtifact(target: string, invocationId: string): Promise<Buffer> {
  try {
    return await readFile(target);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new Error(`Invocation ${invocationId} legacy review artifact is unavailable: ${path.basename(target)}.`);
    }
    throw error;
  }
}

function assertLegacyArtifactHash(
  invocationId: string,
  name: string,
  bytes: Buffer,
  expected: string | null,
): void {
  if (expected === null) {
    if (bytes.byteLength !== 0) {
      throw new Error(`Invocation ${invocationId} legacy ${name} claims an absent file but contains data.`);
    }
    return;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Invocation ${invocationId} legacy ${name} failed integrity validation.`);
  }
}

function hasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  const temporaryPath = path.join(path.dirname(target), `.record-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, target);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJsonOrNull(pathname: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as unknown;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
