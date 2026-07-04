import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import {
  decideProposalBatch,
  decideProposalItem,
  proposalStatusForItems,
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

export const FRONTMATTER_PREVIEW_METADATA_KEY = "exo.frontmatterPreview.v1";

export interface FrontmatterPatchPreviewEvidence {
  format: typeof FRONTMATTER_PREVIEW_METADATA_KEY;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
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

  const prepared = await prepareAcceptedFrontmatterPatches(options.workspaceRoot, decided);
  const acceptedItems = prepared.proposal.items.filter((item) => item.itemStatus === "accepted");
  const appliedItems: ProposalAppliedItem[] = [];
  for (const item of acceptedItems) {
    appliedItems.push(await applyAcceptedItem(options.workspaceRoot, item, prepared.frontmatterPreviews));
  }

  return { proposal: prepared.proposal, appliedItems };
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

export async function enrichProposalFrontmatterPreviews(
  workspaceRoot: string,
  proposal: ProposalBatch,
): Promise<ProposalBatch> {
  const current = validateProposalBatch(proposal);
  const items = await Promise.all(current.items.map(async (item): Promise<ProposalItem> => {
    if (item.kind !== "frontmatterPatch") {
      return item;
    }
    try {
      const existing = await readFile(resolveWorkspaceProposalPath(workspaceRoot, item.path), "utf8");
      return withFrontmatterPatchPreviewEvidence(item, buildFrontmatterPatchPreviewEvidence(existing, item.operations));
    } catch (error) {
      return withFrontmatterPatchPreviewError(item, errorMessage(error));
    }
  }));
  return validateProposalBatch({ ...current, items });
}

export function buildFrontmatterPatchPreviewEvidence(
  existing: string,
  operations: readonly FrontmatterPatchOperation[],
): FrontmatterPatchPreviewEvidence {
  const after = previewFrontmatterPatch(existing, operations);
  return {
    format: FRONTMATTER_PREVIEW_METADATA_KEY,
    before: existing,
    after,
    beforeHash: contentSha256(existing),
    afterHash: contentSha256(after),
  };
}

export function getFrontmatterPatchPreviewEvidence(item: ProposalItem): FrontmatterPatchPreviewEvidence | null {
  if (item.kind !== "frontmatterPatch") {
    return null;
  }
  const evidence = item.metadata?.[FRONTMATTER_PREVIEW_METADATA_KEY];
  if (!isRecord(evidence) || evidence.format !== FRONTMATTER_PREVIEW_METADATA_KEY) {
    return null;
  }
  if (
    typeof evidence.before !== "string"
    || typeof evidence.after !== "string"
    || typeof evidence.beforeHash !== "string"
    || typeof evidence.afterHash !== "string"
  ) {
    return null;
  }
  return {
    format: FRONTMATTER_PREVIEW_METADATA_KEY,
    before: evidence.before,
    after: evidence.after,
    beforeHash: evidence.beforeHash,
    afterHash: evidence.afterHash,
  };
}

export function renderFrontmatterPatchPreviewEvidence(
  evidence: FrontmatterPatchPreviewEvidence,
  options: { baseHash?: string } = {},
): string {
  const lines = [
    "Frontmatter byte preview",
    `Before hash: ${evidence.beforeHash}`,
    `After hash: ${evidence.afterHash}`,
  ];
  if (options.baseHash && options.baseHash !== evidence.beforeHash) {
    lines.push(`Base hash mismatch: proposal base is ${options.baseHash}; current file is ${evidence.beforeHash}.`);
  }
  lines.push(
    "--- before bytes (JSON string) ---",
    JSON.stringify(evidence.before),
    "--- after bytes (JSON string) ---",
    JSON.stringify(evidence.after),
  );
  return lines.join("\n");
}

async function applyAcceptedItem(
  workspaceRoot: string,
  item: ProposalItem,
  frontmatterPreviews: ReadonlyMap<string, string>,
): Promise<ProposalAppliedItem> {
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
  await writeFile(target, frontmatterPreviews.get(item.id) ?? previewFrontmatterPatch(existing, item.operations), "utf8");
  return { id: item.id, kind: item.kind, path: item.path, action: "frontmatterPatched" };
}

async function prepareAcceptedFrontmatterPatches(
  workspaceRoot: string,
  proposal: ProposalBatch,
): Promise<{ proposal: ProposalBatch; frontmatterPreviews: Map<string, string> }> {
  const frontmatterPreviews = new Map<string, string>();
  let changed = false;
  const items = await Promise.all(proposal.items.map(async (item): Promise<ProposalItem> => {
    if (item.itemStatus !== "accepted" || item.kind !== "frontmatterPatch") {
      return item;
    }
    const target = resolveWorkspaceProposalPath(workspaceRoot, item.path);
    const existing = await readFile(target, "utf8");
    try {
      const evidence = buildFrontmatterPatchPreviewEvidence(existing, item.operations);
      frontmatterPreviews.set(item.id, evidence.after);
      return withFrontmatterPatchPreviewEvidence(item, evidence);
    } catch (error) {
      changed = true;
      return {
        ...item,
        itemStatus: "stale",
        statusReason: `frontmatter patch failed: ${errorMessage(error)}`,
      };
    }
  }));
  if (!changed) {
    return { proposal, frontmatterPreviews };
  }
  const resolvedItems = proposal.atomic
    ? items.map((item): ProposalItem => {
      if (item.itemStatus !== "accepted") {
        return item;
      }
      return {
        ...item,
        itemStatus: "stale",
        statusReason: "atomic proposal blocked by a failed frontmatter patch.",
      };
    })
    : items;
  return {
    proposal: validateProposalBatch({
      ...proposal,
      status: proposalStatusForItems(resolvedItems),
      items: resolvedItems,
    }),
    frontmatterPreviews,
  };
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

export function previewFrontmatterPatch(
  existing: string,
  operations: readonly FrontmatterPatchOperation[],
): string {
  const block = splitLeadingFrontmatter(existing);
  const eol = block?.eol ?? inferLineEnding(existing);
  let yamlText = block?.yamlText ?? "";
  for (const operation of operations) {
    yamlText = applyFrontmatterOperation(yamlText, eol, operation);
  }
  if (block) {
    return `${existing.slice(0, block.yamlStart)}${yamlText}${existing.slice(block.yamlEnd)}`;
  }
  return `---${eol}${yamlText}---${eol}${existing}`;
}

function applyFrontmatterOperation(
  yamlText: string,
  eol: "\n" | "\r\n",
  operation: FrontmatterPatchOperation,
): string {
  assertFrontmatterKeyPath(operation.keyPath);
  const document = parseFrontmatterDocument(yamlText);
  if (operation.kind === "set") {
    return setFrontmatterValue(yamlText, eol, document, operation);
  }
  if (operation.kind === "remove") {
    return removeFrontmatterValue(yamlText, document, operation);
  }
  return appendFrontmatterList(yamlText, eol, document, operation);
}

function parseFrontmatterDocument(yamlText: string): ReturnType<typeof parseDocument> {
  const document = parseDocument(yamlText, {
    keepSourceTokens: true,
  });
  const parseFailure = document.errors[0] ?? document.warnings[0];
  if (parseFailure) {
    throw new Error(`invalid frontmatter YAML: ${parseFailure.message}`);
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new Error("frontmatter patch requires a YAML mapping document.");
  }
  return document;
}

function setFrontmatterValue(
  yamlText: string,
  eol: "\n" | "\r\n",
  document: ReturnType<typeof parseDocument>,
  operation: FrontmatterPatchOperation,
): string {
  const pair = findFrontmatterPair(document, operation.keyPath);
  if (!pair) {
    return appendGeneratedYaml(yamlText, eol, operation.keyPath, operation.value);
  }
  const valueRange = nodeValueRange(pair.value);
  if (!valueRange) {
    throw new Error(`frontmatter key has no replaceable value: ${operation.keyPath.join(".")}`);
  }
  return spliceText(yamlText, valueRange[0], valueRange[1], renderYamlValue(operation.value, eol));
}

function removeFrontmatterValue(
  yamlText: string,
  document: ReturnType<typeof parseDocument>,
  operation: FrontmatterPatchOperation,
): string {
  const pair = findFrontmatterPair(document, operation.keyPath);
  if (!pair) {
    return yamlText;
  }
  const start = lineStartForOffset(yamlText, pair.key.range?.[0] ?? 0);
  const end = lineEndForOffset(yamlText, nodeEndOffset(pair.value) ?? pair.key.range?.[2] ?? pair.key.range?.[1] ?? start);
  return spliceText(yamlText, start, end, "");
}

function appendFrontmatterList(
  yamlText: string,
  eol: "\n" | "\r\n",
  document: ReturnType<typeof parseDocument>,
  operation: FrontmatterPatchOperation,
): string {
  const pair = findFrontmatterPair(document, operation.keyPath);
  if (!pair) {
    return appendGeneratedYaml(yamlText, eol, operation.keyPath, [operation.value]);
  }
  const existing = pair.value;
  if (!isSeq(existing)) {
    throw new Error(`frontmatter key is not a YAML sequence: ${operation.keyPath.join(".")}`);
  }
  if (existing.flow) {
    const values = existing.items.map((item) => yamlNodeToJson(item)).concat([operation.value]);
    const valueRange = nodeValueRange(existing);
    if (!valueRange) {
      throw new Error(`frontmatter key has no replaceable value: ${operation.keyPath.join(".")}`);
    }
    return spliceText(yamlText, valueRange[0], valueRange[1], renderYamlValue(values, eol));
  }
  const insertAt = existing.items.length > 0
    ? (nodeEndOffset(existing.items[existing.items.length - 1]) ?? nodeEndOffset(existing) ?? yamlText.length)
    : (nodeEndOffset(existing) ?? lineEndForOffset(yamlText, pair.key.range?.[1] ?? yamlText.length));
  const indent = sequenceItemIndent(yamlText, existing) ?? `${lineIndentAt(yamlText, pair.key.range?.[0] ?? 0)}  `;
  const insertion = `${indent}- ${renderYamlValue(operation.value, eol)}${eol}`;
  return spliceText(yamlText, insertAt, insertAt, insertion);
}

function assertFrontmatterKeyPath(keyPath: readonly string[]): void {
  if (keyPath.length === 0) {
    throw new Error("Frontmatter operation keyPath must not be empty.");
  }
}

interface FrontmatterPair {
  key: { range?: [number, number, number]; value?: unknown };
  value: unknown;
}

function findFrontmatterPair(
  document: ReturnType<typeof parseDocument>,
  keyPath: readonly string[],
): FrontmatterPair | null {
  let map: unknown = document.contents;
  for (const [index, segment] of keyPath.entries()) {
    if (!isMap(map)) {
      return null;
    }
    const pair = map.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === segment) as FrontmatterPair | undefined;
    if (!pair) {
      return null;
    }
    if (index === keyPath.length - 1) {
      return pair;
    }
    map = pair.value;
  }
  return null;
}

function nodeValueRange(node: unknown): [number, number] | null {
  const range = nodeRange(node);
  return range ? [range[0], range[1]] : null;
}

function nodeEndOffset(node: unknown): number | null {
  return nodeRange(node)?.[2] ?? null;
}

function nodeRange(node: unknown): [number, number, number] | null {
  if (node && typeof node === "object" && "range" in node && Array.isArray(node.range)) {
    return node.range as [number, number, number];
  }
  return null;
}

function yamlNodeToJson(node: unknown): unknown {
  return node && typeof node === "object" && "toJSON" in node && typeof node.toJSON === "function"
    ? node.toJSON()
    : undefined;
}

function appendGeneratedYaml(
  yamlText: string,
  eol: "\n" | "\r\n",
  keyPath: readonly string[],
  value: unknown,
): string {
  const document = parseDocument("");
  document.setIn([...keyPath], value);
  return `${yamlText}${yamlText.length > 0 && !yamlText.endsWith(eol) ? eol : ""}${normalizeYamlLineEndings(String(document), eol)}`;
}

function renderYamlValue(value: unknown, eol: "\n" | "\r\n"): string {
  const document = parseDocument("");
  return normalizeYamlLineEndings(String(document.createNode(value)), eol);
}

function spliceText(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function lineStartForOffset(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineEndForOffset(text: string, offset: number): number {
  const next = text.indexOf("\n", offset);
  return next === -1 ? text.length : next + 1;
}

function lineIndentAt(text: string, offset: number): string {
  const start = lineStartForOffset(text, offset);
  const match = /^[ \t]*/.exec(text.slice(start));
  return match?.[0] ?? "";
}

function sequenceItemIndent(yamlText: string, sequence: unknown): string | null {
  if (!isSeq(sequence) || sequence.items.length === 0) {
    return null;
  }
  const firstRange = nodeRange(sequence.items[0]);
  if (!firstRange) {
    return null;
  }
  return lineIndentAt(yamlText, firstRange[0]);
}

interface FrontmatterBlock {
  yamlStart: number;
  yamlEnd: number;
  eol: "\n" | "\r\n";
  yamlText: string;
}

function splitLeadingFrontmatter(existing: string): FrontmatterBlock | null {
  const opener = /^(---)(\r?\n)/.exec(existing);
  if (!opener) {
    return null;
  }
  const eol = opener[2] === "\r\n" ? "\r\n" : "\n";
  let cursor = opener[0].length;
  while (cursor <= existing.length) {
    const nextNewline = existing.indexOf("\n", cursor);
    const lineEnd = nextNewline === -1 ? existing.length : nextNewline + 1;
    const line = existing.slice(cursor, lineEnd);
    const lineWithoutEol = line.endsWith("\r\n")
      ? line.slice(0, -2)
      : line.endsWith("\n")
        ? line.slice(0, -1)
        : line;
    if (lineWithoutEol === "---") {
      return {
        yamlStart: opener[0].length,
        yamlEnd: cursor,
        eol,
        yamlText: existing.slice(opener[0].length, cursor),
      };
    }
    if (nextNewline === -1) {
      break;
    }
    cursor = lineEnd;
  }
  throw new Error("frontmatter block is missing a closing delimiter.");
}

function inferLineEnding(contents: string): "\n" | "\r\n" {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeYamlLineEndings(yaml: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? yaml : yaml.replace(/\n/g, "\r\n");
}

function withFrontmatterPatchPreviewEvidence(
  item: ProposalItem,
  evidence: FrontmatterPatchPreviewEvidence,
): ProposalItem {
  if (item.kind !== "frontmatterPatch") {
    return item;
  }
  return {
    ...item,
    metadata: {
      ...item.metadata,
      [FRONTMATTER_PREVIEW_METADATA_KEY]: evidence,
    },
  };
}

function withFrontmatterPatchPreviewError(item: ProposalItem, error: string): ProposalItem {
  if (item.kind !== "frontmatterPatch") {
    return item;
  }
  return {
    ...item,
    metadata: {
      ...item.metadata,
      "exo.frontmatterPreviewError.v1": error,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
