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
    .filter((filePath) => launch.files[filePath]!.sha256 !== settled.files[filePath]!.sha256)
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
    ...(status === "kept" || status === "rejected"
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
