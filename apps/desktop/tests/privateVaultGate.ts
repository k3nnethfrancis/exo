import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PRIVATE_GRAPH_GATE_CONFIRMATION = "copy-only";

const copyExcludedNames = new Set([".exo", ".git", "node_modules"]);
const fingerprintExcludedNames = new Set([".git"]);

export interface PrivateVaultCopyAggregate {
  directories: number;
  files: number;
  markdownFiles: number;
  bytes: number;
  skippedSymlinks: number;
  skippedSpecialFiles: number;
}

export interface PrivateVaultFingerprint {
  readonly digest: string;
  readonly entries: number;
}

export async function requirePrivateGraphGateSource(environment: NodeJS.ProcessEnv): Promise<string> {
  if (environment.EXO_PRIVATE_GRAPH_GATE !== PRIVATE_GRAPH_GATE_CONFIRMATION) {
    throw new Error("Private graph gate requires the explicit copy-only confirmation token.");
  }
  const configured = environment.EXO_PRIVATE_GRAPH_VAULT_ROOT;
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("Private graph gate requires an absolute configured vault root.");
  }
  let sourceRoot: string;
  try {
    sourceRoot = await realpath(configured);
    if (!(await lstat(sourceRoot)).isDirectory()) throw new Error("not-directory");
  } catch {
    throw new Error("Private graph gate could not validate the configured vault root.");
  }
  return sourceRoot;
}

/**
 * Copies canonical vault files without following symlinks or carrying derived
 * state into the gate. The target must be a fresh OS-temporary directory and
 * must not overlap the source in either direction.
 */
export async function copyPrivateVaultForGraphGate(
  sourceRoot: string,
  targetRoot: string,
): Promise<PrivateVaultCopyAggregate> {
  await assertSafeCopyRoots(sourceRoot, targetRoot);
  const aggregate: PrivateVaultCopyAggregate = {
    directories: 1,
    files: 0,
    markdownFiles: 0,
    bytes: 0,
    skippedSymlinks: 0,
    skippedSpecialFiles: 0,
  };
  await copyDirectory(sourceRoot, targetRoot, aggregate);
  return aggregate;
}

/**
 * Produces one in-memory checksum over source-relative identities, file bytes,
 * and symlink targets. Callers compare only the final digest; identities never
 * need to enter test output or durable evidence.
 */
export async function fingerprintPrivateVault(sourceRoot: string): Promise<PrivateVaultFingerprint> {
  const entries: string[] = [];
  await fingerprintDirectory(sourceRoot, "", entries);
  entries.sort();
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry).update("\0");
  return { digest: hash.digest("hex"), entries: entries.length };
}

export function privateVaultFingerprintsMatch(
  before: PrivateVaultFingerprint,
  after: PrivateVaultFingerprint,
): boolean {
  return before.entries === after.entries && before.digest === after.digest;
}

async function assertSafeCopyRoots(sourceRoot: string, targetRoot: string): Promise<void> {
  const source = await realpath(sourceRoot);
  const temporaryRoot = await realpath(os.tmpdir());
  await mkdir(targetRoot, { recursive: true });
  const target = await realpath(targetRoot);
  if (!isWithin(temporaryRoot, target) || source === target || isWithin(source, target) || isWithin(target, source)) {
    throw new Error("Private graph gate refused an unsafe copy target.");
  }
  if ((await readdir(target)).length !== 0) {
    throw new Error("Private graph gate requires an empty copy target.");
  }
}

async function copyDirectory(
  sourceRoot: string,
  targetRoot: string,
  aggregate: PrivateVaultCopyAggregate,
): Promise<void> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (copyExcludedNames.has(entry.name)) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    const stats = await lstat(source);
    if (stats.isSymbolicLink()) {
      aggregate.skippedSymlinks += 1;
      continue;
    }
    if (stats.isDirectory()) {
      await mkdir(target);
      aggregate.directories += 1;
      await copyDirectory(source, target, aggregate);
      continue;
    }
    if (!stats.isFile()) {
      aggregate.skippedSpecialFiles += 1;
      continue;
    }
    await copyFile(source, target);
    aggregate.files += 1;
    aggregate.bytes += stats.size;
    if (entry.name.toLowerCase().endsWith(".md")) aggregate.markdownFiles += 1;
  }
}

async function fingerprintDirectory(root: string, relativeRoot: string, entries: string[]): Promise<void> {
  const absoluteRoot = path.join(root, relativeRoot);
  const children = await readdir(absoluteRoot, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    if (!relativeRoot && fingerprintExcludedNames.has(child.name)) continue;
    const relative = path.join(relativeRoot, child.name);
    const absolute = path.join(root, relative);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      entries.push(`l:${relative}:${await readlink(absolute)}`);
      continue;
    }
    if (stats.isDirectory()) {
      entries.push(`d:${relative}`);
      await fingerprintDirectory(root, relative, entries);
      continue;
    }
    if (stats.isFile()) {
      const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
      entries.push(`f:${relative}:${stats.size}:${digest}`);
      continue;
    }
    entries.push(`s:${relative}:${stats.mode}:${stats.size}`);
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
