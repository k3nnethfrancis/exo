import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { shouldSuppressGeneratedTitleLine, visibleLineNumbers } from "./decorations";

describe("markdown live preview title suppression", () => {
  it("only suppresses exact generated daily-title H1 lines", () => {
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", "2026-06-14")).toBe(true);
    expect(shouldSuppressGeneratedTitleLine("# Daily Review", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("## 2026-06-14", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", null)).toBe(false);
  });
});

describe("markdown live preview viewport work", () => {
  it("limits decoration work to the visible editor lines", () => {
    const state = EditorState.create({ doc: Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`).join("\n") });

    expect(visibleLineNumbers(state.doc, [{ from: 0, to: 20 }])).toEqual([1, 2, 3]);
    expect(visibleLineNumbers(state.doc, [{ from: state.doc.length - 20, to: state.doc.length }])).toEqual([4_998, 4_999, 5_000]);
  });
});
