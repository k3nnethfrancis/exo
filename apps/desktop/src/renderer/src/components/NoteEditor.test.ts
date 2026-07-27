import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";

import {
  firstChangedOffset,
  initialMarkdownAuthoringPosition,
  nextSuggestionIndex,
  normalizeFrontmatterPropertyKey,
  shouldUseMarkdownRenderer,
} from "./NoteEditor";

describe("invocation review positioning", () => {
  it("anchors at the first changed character, including append-only changes", () => {
    expect(firstChangedOffset("alpha beta", "alpha zeta")).toBe(6);
    expect(firstChangedOffset("alpha", "alpha beta")).toBe(5);
    expect(firstChangedOffset("former", "")).toBe(0);
  });
});

describe("editor document mode", () => {
  it("places generated-title authoring at the blank line after the H1", () => {
    const generatedBody = "\n# New note\n";
    expect(initialMarkdownAuthoringPosition(generatedBody)).toBe(generatedBody.length);
    expect(initialMarkdownAuthoringPosition("# Explicit title\n\nAuthored content.\n")).toBeNull();
    expect(initialMarkdownAuthoringPosition("Explicit non-H1 content\n")).toBeNull();
  });

  it("uses the markdown renderer for markdown documents from any root", () => {
    expect(shouldUseMarkdownRenderer({ kind: "markdown" })).toBe(true);
    expect(shouldUseMarkdownRenderer({ kind: "text" })).toBe(false);
    expect(shouldUseMarkdownRenderer(null)).toBe(false);
  });

  it("keeps new graph property keys within simple frontmatter field names", () => {
    expect(normalizeFrontmatterPropertyKey(" status ")).toBe("status");
    expect(normalizeFrontmatterPropertyKey("branch_state")).toBe("branch_state");
    expect(normalizeFrontmatterPropertyKey("needs-review")).toBe("needs-review");
    expect(normalizeFrontmatterPropertyKey("bad key")).toBe("");
    expect(normalizeFrontmatterPropertyKey("1bad")).toBe("");
    expect(normalizeFrontmatterPropertyKey("nested.value")).toBe("");
  });

  it("wraps agent completion selection with arrow-key navigation", () => {
    expect(nextSuggestionIndex(0, 3, 1)).toBe(1);
    expect(nextSuggestionIndex(2, 3, 1)).toBe(0);
    expect(nextSuggestionIndex(0, 3, -1)).toBe(2);
  });
});
