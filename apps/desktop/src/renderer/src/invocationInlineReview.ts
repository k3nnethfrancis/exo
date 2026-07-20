import { unifiedMergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";

import type { InvocationFileReviewPayload } from "../../shared/api";

interface InvocationInlineReviewInput {
  payload: InvocationFileReviewPayload | null;
  documentKind: "markdown" | "text";
  rawMarkdownMode: boolean;
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

function readLine(source: string, from: number): { text: string; next: number } {
  const newline = source.indexOf("\n", from);
  if (newline === -1) {
    const text = source.slice(from).replace(/\r$/, "");
    return { text, next: source.length };
  }
  const text = source.slice(from, newline).replace(/\r$/, "");
  return { text, next: newline + 1 };
}
