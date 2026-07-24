import type { EditorState } from "@codemirror/state";

export type MarkdownInlineFormat = "bold" | "italic";

const markers: Record<MarkdownInlineFormat, string> = {
  bold: "**",
  italic: "*",
};

export function markdownInlineFormattingEdit(state: EditorState, format: MarkdownInlineFormat) {
  const marker = markers[format];
  const range = state.selection.main;
  const from = range.from;
  const to = range.to;
  const selectedText = state.sliceDoc(from, to);
  const contentFrom = from + marker.length;
  const contentTo = contentFrom + selectedText.length;

  return {
    changes: { from, to, insert: `${marker}${selectedText}${marker}` },
    selection: range.empty
      ? { anchor: contentFrom }
      : range.anchor <= range.head
        ? { anchor: contentFrom, head: contentTo }
        : { anchor: contentTo, head: contentFrom },
  };
}
