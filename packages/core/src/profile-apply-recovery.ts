import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  contentSha256,
  PROFILE_APPLY_RECOVERY_FORMAT,
  type ProfileApplyRecoveryItem,
  type ProfileApplyRecoveryManifest,
} from "./proposal-apply-host";
import type { ProposalItemKind } from "./proposal-review";

export interface ProfileApplyRecoveryManifestSummary {
  path: string;
  fileName: string;
  proposalId: string;
  createdAt: string;
  profileId?: string;
  profileLabel?: string;
  itemCount: number;
}

export interface ProfileApplyRecoveryRestoreOptions {
  itemId?: string;
}

export interface ProfileApplyRecoveryRestoreResult {
  manifest: ProfileApplyRecoveryManifestSummary;
  restoredItems: ProfileApplyRecoveryRestoredItem[];
}

export class ProfileApplyRecoveryRestoreError extends Error {
  readonly result: ProfileApplyRecoveryRestoreResult;
  readonly cause: unknown;

  constructor(message: string, result: ProfileApplyRecoveryRestoreResult, cause: unknown) {
    super(message);
    this.name = "ProfileApplyRecoveryRestoreError";
    this.result = result;
    this.cause = cause;
  }
}

export interface ProfileApplyRecoveryRestoredItem {
  id: string;
  kind: ProfileApplyRecoveryItem["kind"];
  path: string;
  action: "restored" | "deleted";
}

const PROFILE_APPLY_RECOVERY_DIR = path.join(".exo", "proposal-recovery", "profile-apply");

export function profileApplyRecoveryDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, PROFILE_APPLY_RECOVERY_DIR);
}

export async function listProfileApplyRecoveryManifests(workspaceRoot: string): Promise<ProfileApplyRecoveryManifestSummary[]> {
  let entries: string[];
  try {
    entries = (await readdir(profileApplyRecoveryDirectory(workspaceRoot), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(entries.map(async (entry) => {
    const manifestPath = path.join(profileApplyRecoveryDirectory(workspaceRoot), entry);
    return summarizeProfileApplyRecoveryManifest(workspaceRoot, manifestPath, await readProfileApplyRecoveryManifestFile(manifestPath));
  }));
  return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.fileName.localeCompare(right.fileName));
}

export async function readProfileApplyRecoveryManifest(
  workspaceRoot: string,
  manifestRef: string,
): Promise<ProfileApplyRecoveryManifest> {
  return readProfileApplyRecoveryManifestFile(resolveProfileApplyRecoveryManifestPath(workspaceRoot, manifestRef));
}

export async function inspectProfileApplyRecoveryManifest(
  workspaceRoot: string,
  manifestRef: string,
): Promise<{ summary: ProfileApplyRecoveryManifestSummary; manifest: ProfileApplyRecoveryManifest }> {
  const manifestPath = resolveProfileApplyRecoveryManifestPath(workspaceRoot, manifestRef);
  const manifest = await readProfileApplyRecoveryManifestFile(manifestPath);
  return { summary: summarizeProfileApplyRecoveryManifest(workspaceRoot, manifestPath, manifest), manifest };
}

export async function restoreProfileApplyRecoveryManifest(
  workspaceRoot: string,
  manifestRef: string,
  options: ProfileApplyRecoveryRestoreOptions = {},
): Promise<ProfileApplyRecoveryRestoreResult> {
  const manifestPath = resolveProfileApplyRecoveryManifestPath(workspaceRoot, manifestRef);
  const manifest = await readProfileApplyRecoveryManifestFile(manifestPath);
  const items = options.itemId ? manifest.items.filter((item) => item.id === options.itemId) : manifest.items;
  if (options.itemId && items.length === 0) {
    throw new Error(`Profile apply recovery item not found: ${options.itemId}`);
  }

  const restorePlans = await Promise.all(items.map(async (item) => {
    const target = resolveWorkspaceRecoveryPath(workspaceRoot, item.path);
    const currentHash = await fileSha256(target);
    if (currentHash !== item.afterHash) {
      throw new Error(`Profile apply recovery blocked for ${item.path}: current hash ${currentHash ?? "absent"} does not match expected post-apply hash ${item.afterHash}.`);
    }
    return { item, target };
  }));
  assertUniqueRecoveryPaths(restorePlans.map((plan) => plan.item.path));

  const restoredItems: ProfileApplyRecoveryRestoredItem[] = [];
  const manifestSummary = summarizeProfileApplyRecoveryManifest(workspaceRoot, manifestPath, manifest);
  try {
    for (const { item, target } of restorePlans) {
      if (item.before.exists) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, item.before.contents, "utf8");
        restoredItems.push({ id: item.id, kind: item.kind, path: item.path, action: "restored" });
      } else {
        await rm(target);
        restoredItems.push({ id: item.id, kind: item.kind, path: item.path, action: "deleted" });
      }
    }
  } catch (error) {
    throw new ProfileApplyRecoveryRestoreError(
      `Profile apply recovery restore failed after ${restoredItems.length} item${restoredItems.length === 1 ? "" : "s"}: ${error instanceof Error ? error.message : String(error)}`,
      { manifest: manifestSummary, restoredItems },
      error,
    );
  }

  return {
    manifest: manifestSummary,
    restoredItems,
  };
}

function resolveProfileApplyRecoveryManifestPath(workspaceRoot: string, manifestRef: string): string {
  if (!manifestRef || manifestRef.trim().length === 0) {
    throw new Error("Expected a profile apply recovery manifest path or file name.");
  }
  const candidate = manifestRef.includes("/") || manifestRef.includes(path.sep)
    ? path.resolve(workspaceRoot, manifestRef)
    : path.join(profileApplyRecoveryDirectory(workspaceRoot), manifestRef);
  const relative = path.relative(workspaceRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Profile apply recovery manifest path escapes workspace root: ${manifestRef}`);
  }
  return candidate;
}

async function readProfileApplyRecoveryManifestFile(manifestPath: string): Promise<ProfileApplyRecoveryManifest> {
  return validateProfileApplyRecoveryManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

function validateProfileApplyRecoveryManifest(value: unknown): ProfileApplyRecoveryManifest {
  if (!isRecord(value) || value.format !== PROFILE_APPLY_RECOVERY_FORMAT) {
    throw new Error("Invalid profile apply recovery manifest format.");
  }
  if (
    typeof value.proposalId !== "string"
    || typeof value.createdAt !== "string"
    || value.source !== "profileApply"
    || value.profileApplyTarget !== "realVault"
    || !Array.isArray(value.items)
  ) {
    throw new Error("Invalid profile apply recovery manifest shape.");
  }
  const items = value.items.map(validateProfileApplyRecoveryItem);
  return {
    format: PROFILE_APPLY_RECOVERY_FORMAT,
    proposalId: value.proposalId,
    createdAt: value.createdAt,
    source: "profileApply",
    profileId: typeof value.profileId === "string" ? value.profileId : undefined,
    profileLabel: typeof value.profileLabel === "string" ? value.profileLabel : undefined,
    profileApplyTarget: "realVault",
    items,
  };
}

function validateProfileApplyRecoveryItem(value: unknown): ProfileApplyRecoveryItem {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string" || typeof value.path !== "string" || typeof value.afterHash !== "string") {
    throw new Error("Invalid profile apply recovery item shape.");
  }
  if (!isProposalItemKind(value.kind)) {
    throw new Error(`Invalid profile apply recovery item kind: ${value.kind}`);
  }
  const before = value.before;
  if (!isRecord(before) || typeof before.exists !== "boolean") {
    throw new Error("Invalid profile apply recovery before-state shape.");
  }
  if (before.exists === false) {
    return { id: value.id, kind: value.kind, path: value.path, before: { exists: false }, afterHash: value.afterHash };
  }
  if (typeof before.hash !== "string" || typeof before.contents !== "string") {
    throw new Error("Invalid profile apply recovery existing before-state shape.");
  }
  return {
    id: value.id,
    kind: value.kind,
    path: value.path,
    before: { exists: true, hash: before.hash, contents: before.contents },
    afterHash: value.afterHash,
  };
}

function summarizeProfileApplyRecoveryManifest(
  workspaceRoot: string,
  manifestPath: string,
  manifest: ProfileApplyRecoveryManifest,
): ProfileApplyRecoveryManifestSummary {
  return {
    path: path.relative(workspaceRoot, manifestPath),
    fileName: path.basename(manifestPath),
    proposalId: manifest.proposalId,
    createdAt: manifest.createdAt,
    profileId: manifest.profileId,
    profileLabel: manifest.profileLabel,
    itemCount: manifest.items.length,
  };
}

function resolveWorkspaceRecoveryPath(workspaceRoot: string, relativePath: string): string {
  const target = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Profile apply recovery path escapes workspace root: ${relativePath}`);
  }
  return target;
}

function assertUniqueRecoveryPaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const targetPath of paths) {
    if (seen.has(targetPath)) {
      throw new Error(`Profile apply recovery manifest has duplicate item path: ${targetPath}`);
    }
    seen.add(targetPath);
  }
}

async function fileSha256(target: string): Promise<string | null> {
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return null;
    }
    return contentSha256(await readFile(target));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProposalItemKind(value: string): value is ProposalItemKind {
  return value === "fileCreate"
    || value === "filePatch"
    || value === "frontmatterPatch"
    || value === "fileMove"
    || value === "fileDelete";
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
