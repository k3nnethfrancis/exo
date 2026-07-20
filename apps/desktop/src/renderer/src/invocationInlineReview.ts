import { unifiedMergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";

import type { InvocationFileReviewPayload } from "../../shared/api";

interface InvocationInlineReviewInput {
  payload: InvocationFileReviewPayload | null;
  documentKind: "markdown" | "text";
  rawMarkdownMode: boolean;
}

export interface InvocationReviewMetadataChange {
  key: string;
  before?: string;
  after?: string;
}

export interface InvocationReviewMetadataProjection {
  frontmatter: InvocationReviewMetadataChange[];
  permission?: { before: string; after: string };
}

/**
 * Compare the current editor buffer to the invocation's pre-run snapshot.
 * The current buffer deliberately remains CodeMirror's canonical document;
 * this extension only projects the invocation diff over it.
 */
export function invocationInlineReviewExtension(input: InvocationInlineReviewInput): Extension[] {
  const { payload } = input;
  if (
    input.rawMarkdownMode ||
    !payload ||
    (payload.change.after?.mediaType ?? payload.change.before?.mediaType) === "binary" ||
    payload.change.decision.status === "rejected"
  ) {
    return [];
  }

  return unifiedMergeView({
    original: invocationReviewOriginal(payload, input.documentKind),
    allowInlineDiffs: true,
    gutter: false,
    highlightChanges: true,
    mergeControls: false,
    syntaxHighlightDeletions: false,
  });
}

export function invocationReviewOriginal(
  payload: InvocationFileReviewPayload,
  documentKind: "markdown" | "text",
): string {
  return invocationSnapshotBody(payload.beforeText ?? "", documentKind);
}

/**
 * Invocation artifacts preserve the complete on-disk Markdown file while the
 * note editor owns only its body. Match gray-matter's ordinary `---` envelope
 * without parsing or reserializing user YAML in the renderer.
 */
export function invocationSnapshotBody(snapshot: string, documentKind: "markdown" | "text"): string {
  if (documentKind !== "markdown") {
    return snapshot;
  }

  const start = snapshot.startsWith("\uFEFF") ? 1 : 0;
  const opening = readLine(snapshot, start);
  if (opening.text !== "---") {
    return snapshot;
  }

  let position = opening.next;
  while (position <= snapshot.length) {
    const line = readLine(snapshot, position);
    if (line.text === "---") {
      return snapshot.slice(line.next);
    }
    if (line.next <= position) {
      break;
    }
    position = line.next;
  }

  // An unterminated delimiter is body text, not frontmatter.
  return snapshot;
}

/** Project exact non-body changes that CodeMirror's page-native body diff cannot show. */
export function invocationReviewMetadata(payload: InvocationFileReviewPayload): InvocationReviewMetadataProjection {
  const beforeFrontmatter = invocationSnapshotFrontmatter(payload.beforeText);
  const afterFrontmatter = invocationSnapshotFrontmatter(payload.afterText);
  const frontmatter = diffFrontmatter(beforeFrontmatter, afterFrontmatter);
  const beforeMode = payload.change.before?.mode;
  const afterMode = payload.change.after?.mode;
  const permission = beforeMode !== undefined && afterMode !== undefined && beforeMode !== afterMode
    ? { before: formatUnixMode(beforeMode), after: formatUnixMode(afterMode) }
    : undefined;
  return { frontmatter, ...(permission ? { permission } : {}) };
}

export function invocationSnapshotFrontmatter(snapshot: string | null): string | null {
  if (!snapshot) return null;
  const start = snapshot.startsWith("\uFEFF") ? 1 : 0;
  const opening = readLine(snapshot, start);
  if (opening.text !== "---") return null;
  const contentStart = opening.next;
  let position = contentStart;
  while (position <= snapshot.length) {
    const line = readLine(snapshot, position);
    if (line.text === "---") return snapshot.slice(contentStart, position);
    if (line.next <= position) break;
    position = line.next;
  }
  return null;
}

function diffFrontmatter(before: string | null, after: string | null): InvocationReviewMetadataChange[] {
  if (before === after) return [];
  const beforeProjection = frontmatterFields(before);
  const afterProjection = frontmatterFields(after);
  if (!beforeProjection.complete || !afterProjection.complete) {
    return [{
      key: "Frontmatter",
      ...(before === null ? {} : { before: before.trim() }),
      ...(after === null ? {} : { after: after.trim() }),
    }];
  }
  const beforeFields = beforeProjection.fields;
  const afterFields = afterProjection.fields;
  const keys = [...new Set([...beforeFields.keys(), ...afterFields.keys()])].sort((left, right) => left.localeCompare(right));
  const changes = keys.flatMap((key): InvocationReviewMetadataChange[] => {
    const previous = beforeFields.get(key);
    const next = afterFields.get(key);
    if (previous === next) return [];
    return [{ key, ...(previous === undefined ? {} : { before: previous }), ...(next === undefined ? {} : { after: next }) }];
  });
  if (changes.length > 0) return changes;
  return [{
    key: "Frontmatter",
    ...(before === null ? {} : { before: before.trim() }),
    ...(after === null ? {} : { after: after.trim() }),
  }];
}

/**
 * Preserve each top-level YAML field as an immutable source slice. Nested
 * values remain exact without teaching the renderer a second YAML serializer.
 */
function frontmatterFields(source: string | null): { fields: Map<string, string>; complete: boolean } {
  if (source === null) return { fields: new Map(), complete: true };
  const fields = new Map<string, string>();
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let complete = true;
  const commit = () => {
    if (currentKey) fields.set(currentKey, currentValue.join("\n").trimEnd());
  };
  for (const line of lines) {
    const field = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (field) {
      commit();
      currentKey = field[1]!;
      currentValue = [field[2] ?? ""];
    } else if (/^[^\s#][^:]*:/.test(line) || /^\?\s/.test(line) || /^-\s/.test(line)) {
      complete = false;
      if (currentKey) currentValue.push(line);
    } else if (currentKey) {
      currentValue.push(line);
    } else if (line.trim() !== "") {
      // Leading comments/directives and other YAML forms are not represented by
      // the structured rows, so review the exact block rather than concealing them.
      complete = false;
    }
  }
  commit();
  return { fields, complete };
}

function formatUnixMode(mode: number): string {
  return mode.toString(8).padStart(4, "0");
}

function readLine(source: string, from: number): { text: string; next: number } {
  const newline = source.indexOf("\n", from);
  if (newline === -1) {
    const text = source.slice(from).replace(/\r$/, "");
    return { text, next: source.length };
  }
  const text = source.slice(from, newline).replace(/\r$/, "");
  return { text, next: newline + 1 };
}
