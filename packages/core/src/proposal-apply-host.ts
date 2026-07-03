import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import {
  decideProposalBatch,
  decideProposalItem,
  validateProposalBatch,
  type FrontmatterPatchOperation,
  type ProposalBatch,
  type ProposalDecision,
  type ProposalDecisionSurface,
  type ProposalItem,
} from "./proposal-review";

export interface ProposalApplyOptions {
  workspaceRoot: string;
  decision: ProposalDecision;
  surface: Exclude<ProposalDecisionSurface, "mcp">;
  itemId?: string;
  decidedAt?: string;
}

export interface ProposalApplyResult {
  proposal: ProposalBatch;
  appliedItems: ProposalAppliedItem[];
}

export interface ProposalAppliedItem {
  id: string;
  kind: ProposalItem["kind"];
  path: string;
  action: "created" | "patched" | "frontmatterPatched";
}

export async function applyProposalToWorkspace(
  proposal: ProposalBatch,
  options: ProposalApplyOptions,
): Promise<ProposalApplyResult> {
  const current = validateProposalBatch(proposal);
  const currentHashes = await currentHashesForProposal(options.workspaceRoot, current.items);
  const decided = options.itemId
    ? decideProposalItem(current, options.itemId, options.decision, {
      surface: options.surface,
      decidedAt: options.decidedAt,
      currentHashes,
    })
    : decideProposalBatch(current, options.decision, {
      surface: options.surface,
      decidedAt: options.decidedAt,
      currentHashes,
    });

  if (options.decision === "reject") {
    return { proposal: decided, appliedItems: [] };
  }

  const acceptedItems = decided.items.filter((item) => item.itemStatus === "accepted");
  const appliedItems: ProposalAppliedItem[] = [];
  for (const item of acceptedItems) {
    appliedItems.push(await applyAcceptedItem(options.workspaceRoot, item));
  }

  return { proposal: decided, appliedItems };
}

export async function currentHashesForProposal(
  workspaceRoot: string,
  items: readonly ProposalItem[],
): Promise<Record<string, string | null>> {
  const hashes: Record<string, string | null> = {};
  for (const item of items) {
    if (hashes[item.path] !== undefined) {
      continue;
    }
    const target = resolveWorkspaceProposalPath(workspaceRoot, item.path);
    hashes[item.path] = await fileSha256(target);
  }
  return hashes;
}

export function contentSha256(contents: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function applyAcceptedItem(workspaceRoot: string, item: ProposalItem): Promise<ProposalAppliedItem> {
  if (item.kind === "fileMove" || item.kind === "fileDelete") {
    throw new Error(`${item.kind} proposals are not supported by the v1 apply host.`);
  }
  const target = resolveWorkspaceProposalPath(workspaceRoot, item.path);
  if (item.kind === "fileCreate") {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, item.contents, "utf8");
    return { id: item.id, kind: item.kind, path: item.path, action: "created" };
  }
  const existing = await readFile(target, "utf8");
  if (item.kind === "filePatch") {
    await writeFile(target, applyUnifiedDiff(existing, item.unifiedDiff), "utf8");
    return { id: item.id, kind: item.kind, path: item.path, action: "patched" };
  }
  const parsed = matter(existing);
  const data = applyFrontmatterOperations(parsed.data, item.operations);
  await writeFile(target, matter.stringify(parsed.content, data), "utf8");
  return { id: item.id, kind: item.kind, path: item.path, action: "frontmatterPatched" };
}

function resolveWorkspaceProposalPath(workspaceRoot: string, relativePath: string): string {
  const target = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Proposal path escapes workspace root: ${relativePath}`);
  }
  return target;
}

async function fileSha256(target: string): Promise<string | null> {
  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return null;
    }
    return contentSha256(await readFile(target));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function applyUnifiedDiff(original: string, unifiedDiff: string): string {
  const originalLines = splitPatchLines(original);
  const result: string[] = [];
  let cursor = 0;
  const lines = unifiedDiff.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[index]);
    if (!header) {
      continue;
    }
    const oldStart = Number.parseInt(header[1], 10);
    const hunkStart = Math.max(0, oldStart - 1);
    result.push(...originalLines.slice(cursor, hunkStart));
    cursor = hunkStart;
    index += 1;
    while (index < lines.length && !lines[index].startsWith("@@ ")) {
      const line = lines[index];
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        assertOriginalLine(originalLines, cursor, text);
        result.push(text);
        cursor += 1;
      } else if (marker === "-") {
        assertOriginalLine(originalLines, cursor, text);
        cursor += 1;
      } else if (marker === "+") {
        result.push(text);
      } else if (marker !== "\\" && line !== "") {
        throw new Error(`Unsupported unified diff line: ${line}`);
      }
      index += 1;
    }
    index -= 1;
  }
  result.push(...originalLines.slice(cursor));
  const trailingNewline = original.endsWith("\n") || unifiedDiff.includes("\\ No newline at end of file") === false;
  return `${result.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function splitPatchLines(contents: string): string[] {
  const withoutTrailing = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return withoutTrailing.length === 0 ? [] : withoutTrailing.split(/\r?\n/);
}

function assertOriginalLine(originalLines: string[], cursor: number, expected: string): void {
  if (originalLines[cursor] !== expected) {
    throw new Error(`Unified diff context mismatch at original line ${cursor + 1}.`);
  }
}

function applyFrontmatterOperations(
  data: Record<string, unknown>,
  operations: readonly FrontmatterPatchOperation[],
): Record<string, unknown> {
  const next = structuredClone(data) as Record<string, unknown>;
  for (const operation of operations) {
    if (operation.kind === "set") {
      setPath(next, operation.keyPath, operation.value);
    } else if (operation.kind === "remove") {
      removePath(next, operation.keyPath);
    } else {
      appendPath(next, operation.keyPath, operation.value);
    }
  }
  return next;
}

function setPath(target: Record<string, unknown>, keyPath: readonly string[], value: unknown): void {
  const parent = ensureParent(target, keyPath);
  parent[keyPath[keyPath.length - 1]] = value;
}

function removePath(target: Record<string, unknown>, keyPath: readonly string[]): void {
  const parent = getParent(target, keyPath);
  if (parent) {
    delete parent[keyPath[keyPath.length - 1]];
  }
}

function appendPath(target: Record<string, unknown>, keyPath: readonly string[], value: unknown): void {
  const parent = ensureParent(target, keyPath);
  const key = keyPath[keyPath.length - 1];
  const existing = parent[key];
  parent[key] = Array.isArray(existing) ? [...existing, value] : [value];
}

function ensureParent(target: Record<string, unknown>, keyPath: readonly string[]): Record<string, unknown> {
  if (keyPath.length === 0) {
    throw new Error("Frontmatter operation keyPath must not be empty.");
  }
  let current = target;
  for (const segment of keyPath.slice(0, -1)) {
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  return current;
}

function getParent(target: Record<string, unknown>, keyPath: readonly string[]): Record<string, unknown> | null {
  if (keyPath.length === 0) {
    throw new Error("Frontmatter operation keyPath must not be empty.");
  }
  let current: Record<string, unknown> = target;
  for (const segment of keyPath.slice(0, -1)) {
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return null;
    }
    current = child as Record<string, unknown>;
  }
  return current;
}
