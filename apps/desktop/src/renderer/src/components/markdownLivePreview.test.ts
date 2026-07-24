import { EditorState, StateField } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  collectListMetadata,
  markdownImageTarget,
  markdownLivePreview,
  markdownPreviewMetadata,
  shouldSuppressGeneratedTitleLine,
  updateMarkdownPreviewMetadataForChanges,
  updateListMetadataForChanges,
  visibleLineNumbers,
} from "./markdownLivePreview";
import {
  clampSelectionToRenderedListText,
  listEnterEdit,
  slashDateCommandEdit,
  wikilinkExitEdit,
} from "./markdown-live-preview/commands";

function foldedListParentAnchorsField() {
  const field = markdownLivePreview({
    onOpenTarget: () => {},
    onOpenTag: () => {},
    onResolveImage: async () => ({ url: "" }),
  }).find((extension): extension is StateField<Set<number>> => extension instanceof StateField);
  if (!field) throw new Error("markdown live preview must include folded-list state");
  return field;
}

function stateWithFoldedParent(doc: string, lineNumber: number) {
  const field = foldedListParentAnchorsField();
  const state = EditorState.create({
    doc,
    extensions: field.init((initialState) => new Set([initialState.doc.line(lineNumber).from])),
  });
  return { field, state };
}

describe("markdown live preview title suppression", () => {
  it("only suppresses exact generated daily-title H1 lines", () => {
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", "2026-06-14")).toBe(true);
    expect(shouldSuppressGeneratedTitleLine("# Daily Review", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("## 2026-06-14", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", null)).toBe(false);
  });

  it("keeps spaces in Markdown image filenames while removing an optional title", () => {
    expect(markdownImageTarget("attachments/chart one.png")).toBe("attachments/chart one.png");
    expect(markdownImageTarget('attachments/chart one.png "Quarterly chart"')).toBe("attachments/chart one.png");
    expect(markdownImageTarget("  attachments/chart%20one.png  ")).toBe("attachments/chart%20one.png");
  });
});

describe("markdown live preview viewport work", () => {
  it("limits decoration work to the visible editor lines", () => {
    const state = EditorState.create({ doc: Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`).join("\n") });

    expect(visibleLineNumbers(state.doc, [{ from: 0, to: 20 }])).toEqual([1, 2, 3]);
    expect(visibleLineNumbers(state.doc, [{ from: state.doc.length - 20, to: state.doc.length }])).toEqual([4_998, 4_999, 5_000]);
  });

  it("repairs list metadata locally across line joins and line-number shifts", () => {
    const initial = EditorState.create({
      doc: ["# Before", "", "- first", "  - nested", "", "Paragraph", "", "- distant"].join("\n"),
    });
    const joinAt = initial.doc.line(3).to;
    const transaction = initial.update({ changes: { from: joinAt, to: joinAt + 1, insert: " " } });

    const repaired = updateListMetadataForChanges(initial.doc, transaction.newDoc, transaction.changes, collectListMetadata(initial.doc));

    expect([...repaired].sort(([left], [right]) => left - right)).toEqual([...collectListMetadata(transaction.newDoc)]);
    expect(repaired.get(7)).toMatchObject({ marker: "-", isListStart: true });
  });

  it("repairs both list blocks when deleting their blank-line boundary", () => {
    const initial = EditorState.create({ doc: "- first\n\n  - second\ncontinuation" });
    const boundary = initial.doc.line(1).to;
    const transaction = initial.update({ changes: { from: boundary, to: boundary + 1 } });

    const repaired = updateListMetadataForChanges(initial.doc, transaction.newDoc, transaction.changes, collectListMetadata(initial.doc));

    expect([...repaired].sort(([left], [right]) => left - right)).toEqual([...collectListMetadata(transaction.newDoc)]);
  });

  it("remaps distant table and fence metadata without changing full-collection results", () => {
    const initial = EditorState.create({
      doc: ["# Before", "", "Paragraph above structures.", "", "| Name | Value |", "| --- | ---: |", "| alpha | 1 |", "", "```ts", "const answer = 42;", "```", "", "- item"].join("\n"),
    });
    const transaction = initial.update({ changes: { from: initial.doc.line(2).from, insert: "A new line.\n" } });

    const repaired = updateMarkdownPreviewMetadataForChanges(initial.doc, transaction.newDoc, transaction.changes, markdownPreviewMetadata(initial.doc));

    expect(repaired).toEqual(markdownPreviewMetadata(transaction.newDoc));
  });

  it("recollects table and fence metadata when their structure changes", () => {
    const tableInitial = EditorState.create({ doc: "# Tables\n\n| Name | Value |\n| --- | ---: |\n| alpha | 1 |\n" });
    const separator = tableInitial.doc.line(4);
    const tableTransaction = tableInitial.update({ changes: { from: separator.from, to: separator.to, insert: "not a table" } });
    const tableRepaired = updateMarkdownPreviewMetadataForChanges(tableInitial.doc, tableTransaction.newDoc, tableTransaction.changes, markdownPreviewMetadata(tableInitial.doc));
    expect(tableRepaired).toEqual(markdownPreviewMetadata(tableTransaction.newDoc));

    const fenceInitial = EditorState.create({ doc: "# Fence\n\n```ts\nconst answer = 42;\n```\n" });
    const closingFence = fenceInitial.doc.line(5);
    const fenceTransaction = fenceInitial.update({ changes: { from: closingFence.from, to: closingFence.to, insert: "plain text" } });
    const fenceRepaired = updateMarkdownPreviewMetadataForChanges(fenceInitial.doc, fenceTransaction.newDoc, fenceTransaction.changes, markdownPreviewMetadata(fenceInitial.doc));
    expect(fenceRepaired).toEqual(markdownPreviewMetadata(fenceTransaction.newDoc));
  });

  it("updates table content and remaps fence content without rescanning unrelated lines", () => {
    const initial = EditorState.create({
      doc: ["# Structured edits", "", "| Name | Value |", "| --- | ---: |", "| alpha | 1 |", "", "```ts", "const answer = 42;", "```"].join("\n"),
    });
    const tableCell = initial.doc.line(5);
    const fenceBody = initial.doc.line(8);
    const transaction = initial.update({ changes: [
      { from: tableCell.from + tableCell.text.indexOf("alpha"), to: tableCell.from + tableCell.text.indexOf("alpha") + 5, insert: "beta" },
      { from: fenceBody.from + fenceBody.text.indexOf("42"), to: fenceBody.from + fenceBody.text.indexOf("42") + 2, insert: "43" },
    ] });

    const repaired = updateMarkdownPreviewMetadataForChanges(initial.doc, transaction.newDoc, transaction.changes, markdownPreviewMetadata(initial.doc));

    expect(repaired).toEqual(markdownPreviewMetadata(transaction.newDoc));
    expect(repaired.tableContexts.get(5)?.rows).toEqual([["beta", "1"]]);
  });
});

describe("markdown editor list behavior", () => {
  it("continues unordered lists on Enter", () => {
    const state = EditorState.create({ doc: "- account strategy" });
    expect(listEnterEdit(state, state.doc.length)).toEqual({ from: state.doc.length, to: state.doc.length, insert: "\n- ", selection: state.doc.length + 3, exitList: false });
  });

  it("increments ordered lists on Enter", () => {
    const state = EditorState.create({ doc: "  9. account strategy" });
    expect(listEnterEdit(state, state.doc.length)).toEqual({ from: state.doc.length, to: state.doc.length, insert: "\n  10. ", selection: state.doc.length + 7, exitList: false });
  });

  it("continues task lists as unchecked task items on Enter", () => {
    const state = EditorState.create({ doc: "- [x] follow up" });
    expect(listEnterEdit(state, state.doc.length)).toEqual({ from: state.doc.length, to: state.doc.length, insert: "\n- [ ] ", selection: state.doc.length + 7, exitList: false });
  });

  it("exits empty list items on Enter", () => {
    const state = EditorState.create({ doc: "  - " });
    expect(listEnterEdit(state, state.doc.length)).toEqual({ from: 0, to: state.doc.length, insert: "", selection: 0, exitList: true });
  });

  it("exits empty task list items on Enter", () => {
    const state = EditorState.create({ doc: "  - [ ] " });
    expect(listEnterEdit(state, state.doc.length)).toEqual({ from: 0, to: state.doc.length, insert: "", selection: 0, exitList: true });
  });

  it("clamps shortcut selections to rendered list text", () => {
    const state = EditorState.create({ doc: "- some important text" });
    const anchor = state.doc.length;
    const selection = clampSelectionToRenderedListText(state, anchor, 0);
    expect(selection?.anchor).toBe(anchor);
    expect(selection?.head).toBe("- ".length);
  });
});

describe("markdown editor slash date commands", () => {
  const now = new Date(2026, 6, 21, 23, 30);

  it("turns /today into a normal date wikilink", () => {
    const state = EditorState.create({ doc: "Plan /today" });
    expect(slashDateCommandEdit(state, state.doc.length, now)).toEqual({ from: "Plan ".length, to: state.doc.length, insert: "[[2026-07-21]]", selection: "Plan [[2026-07-21]]".length });
  });

  it("uses calendar-day arithmetic for /tomorrow", () => {
    const state = EditorState.create({ doc: "/tomorrow" });
    expect(slashDateCommandEdit(state, state.doc.length, now)).toEqual({ from: 0, to: state.doc.length, insert: "[[2026-07-22]]", selection: "[[2026-07-22]]".length });
  });

  it("does not expand partial commands or commands inside words", () => {
    expect(slashDateCommandEdit(EditorState.create({ doc: "/tod" }), 4, now)).toBeNull();
    expect(slashDateCommandEdit(EditorState.create({ doc: "not/today" }), 9, now)).toBeNull();
  });
});

describe("markdown editor wikilink behavior", () => {
  it("exits a wikilink without inserting trailing whitespace", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]]today" });
    const pos = "Discuss [[customer-name".length;
    expect(wikilinkExitEdit(state, pos)).toEqual({ insertAt: "Discuss [[customer-name]]".length, insert: "", selection: "Discuss [[customer-name]]".length });
  });

  it("does not treat the closing edge of a wikilink as editable interior", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]] today" });
    expect(wikilinkExitEdit(state, "Discuss [[customer-name]]".length)).toBeNull();
  });

  it("does not handle Tab or Enter outside wikilinks", () => {
    const state = EditorState.create({ doc: "Discuss customer-name" });
    expect(wikilinkExitEdit(state, state.doc.length)).toBeNull();
  });
});

describe("markdown live preview folded-list identity", () => {
  it("keeps a nested parent folded when sibling lines are inserted and deleted before it", () => {
    const { field, state } = stateWithFoldedParent(["- outer", "  - nested parent", "    - child", "  - sibling", "- after"].join("\n"), 2);
    const parent = state.doc.line(2);
    const inserted = state.update({ changes: { from: parent.from, insert: "  - before\n" } }).state;
    expect(inserted.field(field)).toEqual(new Set([inserted.doc.line(3).from]));

    const before = inserted.doc.line(2);
    const deleted = inserted.update({ changes: { from: before.from, to: before.to + 1 } }).state;
    expect(deleted.field(field)).toEqual(new Set([deleted.doc.line(2).from]));
  });

  it("clears a fold when its parent list line is replaced", () => {
    const { field, state } = stateWithFoldedParent(["- parent", "  - child", "- successor"].join("\n"), 1);
    const parent = state.doc.line(1);
    const replaced = state.update({ changes: { from: parent.from, to: parent.to, insert: "- replacement" } }).state;
    expect(replaced.field(field)).toEqual(new Set());
  });

  it("clears a fold when its parent list line is deleted", () => {
    const { field, state } = stateWithFoldedParent(["- parent", "  - child", "- successor"].join("\n"), 1);
    const parent = state.doc.line(1);
    const deleted = state.update({ changes: { from: parent.from, to: parent.to + 1 } }).state;
    expect(deleted.field(field)).toEqual(new Set());
  });

  it("retains a folded parent through a nested task checkbox edit", () => {
    const { field, state } = stateWithFoldedParent(["- parent", "  - [ ] child", "- successor"].join("\n"), 1);
    const task = state.doc.line(2);
    const checkbox = task.from + task.text.indexOf(" ", task.text.indexOf("[") + 1);
    const edited = state.update({ changes: { from: checkbox, to: checkbox + 1, insert: "x" } }).state;
    expect(edited.field(field)).toEqual(new Set([0]));
  });

  it("retains a fold through parent indent and outdent", () => {
    const { field, state } = stateWithFoldedParent(["- parent", "  - child", "- successor"].join("\n"), 1);
    const child = state.doc.line(2);
    const indented = state.update({ changes: [{ from: 0, insert: "  " }, { from: child.from, insert: "  " }] }).state;
    expect(indented.field(field)).toEqual(new Set([0]));

    const indentedChild = indented.doc.line(2);
    const outdented = indented.update({ changes: [{ from: 0, to: 2 }, { from: indentedChild.from, to: indentedChild.from + 2 }] }).state;
    expect(outdented.field(field)).toEqual(new Set([0]));
  });

  it("retains the parent fold across a multi-change transaction", () => {
    const { field, state } = stateWithFoldedParent(["- parent", "  - [ ] child", "- successor"].join("\n"), 1);
    const task = state.doc.line(2);
    const checkbox = task.from + task.text.indexOf(" ", task.text.indexOf("[") + 1);
    const changed = state.update({ changes: [
      { from: 0, insert: "- before\n" },
      { from: checkbox, to: checkbox + 1, insert: "x" },
    ] }).state;
    expect(changed.field(field)).toEqual(new Set([changed.doc.line(2).from]));
  });
});
