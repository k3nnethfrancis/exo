import path from "node:path";

export const INVOCATION_MANIFEST_VERSION = 1 as const;

export type InvocationFileOperation = "modified" | "created" | "deleted" | "renamed";
export type InvocationFileReviewDecision =
  | { status: "pending" }
  | { status: "kept"; reviewedAt: string; acceptedSha256: string | null }
  | { status: "rejected"; reviewedAt: string }
  | { status: "conflict"; reason: string; currentSha256: string | null };
export type InvocationChangesetStatus =
  | "no-change"
  | "pending-review"
  | "partially-resolved"
  | "resolved"
  | "kept"
  | "rejected"
  | "conflict";

export interface InvocationFileState {
  /** Absolute path inside one of the invocation's authorized Note Roots. */
  path: string;
  sha256: string;
  byteLength: number;
  snapshotRef: string;
  mediaType: "text" | "binary";
  /** POSIX permission bits retained so a deleted file can be recreated faithfully. */
  mode?: number;
}

export interface InvocationWorkspaceManifest {
  version: typeof INVOCATION_MANIFEST_VERSION;
  capturedAt: string;
  noteRoots: string[];
  files: Record<string, InvocationFileState>;
  directories: string[];
}

export interface InvocationFileChange {
  id: string;
  operation: InvocationFileOperation;
  decision: InvocationFileReviewDecision;
  before?: InvocationFileState;
  after?: InvocationFileState;
  diffRef?: string;
}

export interface InvocationChangeset {
  version: 1;
  status: InvocationChangesetStatus;
  files: InvocationFileChange[];
  settledAt: string;
  resolvedAt?: string;
}

export function normalizeInvocationChangeset(value: unknown): InvocationChangeset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InvocationChangeset>;
  if (candidate.version !== 1 || typeof candidate.settledAt !== "string" || !Array.isArray(candidate.files)) return null;
  const seen = new Set<string>();
  const files: InvocationFileChange[] = [];
  for (const raw of candidate.files) {
    const change = normalizeInvocationFileChange(raw);
    if (!change || seen.has(change.id)) return null;
    seen.add(change.id);
    files.push(change);
  }
  files.sort(compareChanges);
  const status = deriveInvocationChangesetStatus(files);
  const resolvedAt = typeof candidate.resolvedAt === "string" && candidate.resolvedAt.trim()
    ? candidate.resolvedAt
    : undefined;
  return {
    version: 1,
    status,
    files,
    settledAt: candidate.settledAt,
    ...(resolvedAt ? { resolvedAt } : {}),
  };
}

export function normalizeInvocationFileState(value: unknown): InvocationFileState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InvocationFileState>;
  if (typeof candidate.path !== "string" || !path.isAbsolute(candidate.path)) return null;
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.sha256)) return null;
  if (!Number.isSafeInteger(candidate.byteLength) || candidate.byteLength! < 0) return null;
  if (candidate.snapshotRef !== path.posix.join("files", "objects", candidate.sha256.toLowerCase())) return null;
  if (candidate.mediaType !== "text" && candidate.mediaType !== "binary") return null;
  if (candidate.mode !== undefined && (!Number.isInteger(candidate.mode) || candidate.mode < 0 || candidate.mode > 0o777)) return null;
  return {
    path: path.resolve(candidate.path),
    sha256: candidate.sha256.toLowerCase(),
    byteLength: candidate.byteLength!,
    snapshotRef: candidate.snapshotRef,
    mediaType: candidate.mediaType,
    ...(candidate.mode === undefined ? {} : { mode: candidate.mode }),
  };
}

/**
 * Compare two exact workspace manifests. Rename is intentionally conservative:
 * a deleted and created path become a rename only when their shared content
 * hash occurs exactly once on each side of the unmatched set.
 */
export function buildInvocationChangeset(
  launch: InvocationWorkspaceManifest,
  settled: InvocationWorkspaceManifest,
): InvocationChangeset {
  const beforePaths = Object.keys(launch.files).sort();
  const afterPaths = Object.keys(settled.files).sort();
  const sharedPaths = beforePaths.filter((filePath) => settled.files[filePath]);
  const deletedPaths = beforePaths.filter((filePath) => !settled.files[filePath]);
  const createdPaths = afterPaths.filter((filePath) => !launch.files[filePath]);

  const changes: InvocationFileChange[] = sharedPaths
    .filter((filePath) => launch.files[filePath]!.sha256 !== settled.files[filePath]!.sha256 ||
      launch.files[filePath]!.mode !== settled.files[filePath]!.mode)
    .map((filePath) => ({
      id: changeId("modified", filePath),
      operation: "modified",
      decision: { status: "pending" },
      before: launch.files[filePath],
      after: settled.files[filePath],
    }));

  const deletedByHash = groupPathsByHash(deletedPaths, launch.files);
  const createdByHash = groupPathsByHash(createdPaths, settled.files);
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();

  for (const [sha256, fromPaths] of deletedByHash) {
    const toPaths = createdByHash.get(sha256);
    if (fromPaths.length !== 1 || toPaths?.length !== 1) {
      continue;
    }
    const [fromPath] = fromPaths;
    const [toPath] = toPaths;
    renamedFrom.add(fromPath!);
    renamedTo.add(toPath!);
    changes.push({
      id: changeId("renamed", fromPath!, toPath!),
      operation: "renamed",
      decision: { status: "pending" },
      before: launch.files[fromPath!],
      after: settled.files[toPath!],
    });
  }

  for (const filePath of deletedPaths) {
    if (renamedFrom.has(filePath)) continue;
    changes.push({
      id: changeId("deleted", filePath),
      operation: "deleted",
      decision: { status: "pending" },
      before: launch.files[filePath],
    });
  }
  for (const filePath of createdPaths) {
    if (renamedTo.has(filePath)) continue;
    changes.push({
      id: changeId("created", filePath),
      operation: "created",
      decision: { status: "pending" },
      after: settled.files[filePath],
    });
  }

  changes.sort(compareChanges);
  return {
    version: 1,
    status: deriveInvocationChangesetStatus(changes),
    files: changes,
    settledAt: settled.capturedAt,
  };
}

export function deriveInvocationChangesetStatus(
  files: readonly Pick<InvocationFileChange, "decision">[],
): InvocationChangesetStatus {
  if (files.length === 0) return "no-change";
  const decisions = new Set(files.map((file) => file.decision.status));
  if (decisions.has("conflict")) return "conflict";
  if (decisions.size === 1 && decisions.has("pending")) return "pending-review";
  if (decisions.size === 1 && decisions.has("kept")) return "kept";
  if (decisions.size === 1 && decisions.has("rejected")) return "rejected";
  if (!decisions.has("pending")) return "resolved";
  return "partially-resolved";
}

export function resolveInvocationFileChange(
  changeset: InvocationChangeset,
  changeIdValue: string,
  decision: Exclude<InvocationFileReviewDecision, { status: "pending" }>,
): InvocationChangeset {
  let found = false;
  const files = changeset.files.map((file) => {
    if (file.id !== changeIdValue) return file;
    found = true;
    return { ...file, decision };
  });
  if (!found) throw new Error(`Invocation change ${changeIdValue} was not found.`);
  const status = deriveInvocationChangesetStatus(files);
  return {
    ...changeset,
    files,
    status,
    ...(status === "kept" || status === "rejected" || status === "resolved"
      ? { resolvedAt: decision.status === "kept" || decision.status === "rejected" ? decision.reviewedAt : undefined }
      : {}),
  };
}

function groupPathsByHash(
  paths: readonly string[],
  files: InvocationWorkspaceManifest["files"],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const filePath of paths) {
    const state = files[filePath];
    if (!state) continue;
    const entries = grouped.get(state.sha256) ?? [];
    entries.push(filePath);
    grouped.set(state.sha256, entries);
  }
  return grouped;
}

function changeId(operation: InvocationFileOperation, ...paths: string[]): string {
  return [operation, ...paths.map((filePath) => path.resolve(filePath))].join(":");
}

function compareChanges(left: InvocationFileChange, right: InvocationFileChange): number {
  const leftPath = left.after?.path ?? left.before?.path ?? left.id;
  const rightPath = right.after?.path ?? right.before?.path ?? right.id;
  return leftPath.localeCompare(rightPath) || left.operation.localeCompare(right.operation);
}

function normalizeInvocationFileChange(value: unknown): InvocationFileChange | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InvocationFileChange>;
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : null;
  const operation = candidate.operation;
  const before = normalizeInvocationFileState(candidate.before);
  const after = normalizeInvocationFileState(candidate.after);
  const decision = normalizeReviewDecision(candidate.decision);
  if (!id || !decision || (operation !== "modified" && operation !== "created" && operation !== "deleted" && operation !== "renamed")) {
    return null;
  }
  if (operation === "created" && (before || !after)) return null;
  if (operation === "deleted" && (!before || after)) return null;
  if (operation === "modified" && (!before || !after || before.path !== after.path)) return null;
  if (operation === "renamed" && (!before || !after || before.path === after.path || before.sha256 !== after.sha256)) return null;
  return {
    id,
    operation,
    decision,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(typeof candidate.diffRef === "string" && candidate.diffRef.trim() ? { diffRef: candidate.diffRef } : {}),
  };
}

function normalizeReviewDecision(value: unknown): InvocationFileReviewDecision | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<InvocationFileReviewDecision> & {
    acceptedSha256?: unknown;
    currentSha256?: unknown;
    reason?: unknown;
    reviewedAt?: unknown;
  };
  if (candidate.status === "pending") return { status: "pending" };
  if (candidate.status === "kept" && typeof candidate.reviewedAt === "string" &&
    (candidate.acceptedSha256 === null || isSha256(candidate.acceptedSha256))) {
    return { status: "kept", reviewedAt: candidate.reviewedAt, acceptedSha256: candidate.acceptedSha256 };
  }
  if (candidate.status === "rejected" && typeof candidate.reviewedAt === "string") {
    return { status: "rejected", reviewedAt: candidate.reviewedAt };
  }
  if (candidate.status === "conflict" && typeof candidate.reason === "string" &&
    (candidate.currentSha256 === null || isSha256(candidate.currentSha256))) {
    return { status: "conflict", reason: candidate.reason, currentSha256: candidate.currentSha256 };
  }
  return null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
