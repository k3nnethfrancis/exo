import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

import type { ExoSyntaxTheme, ExoThemeVariant } from "./types";

export function exoEditorTheme(theme: ExoThemeVariant, fontSize: number): Extension {
  return EditorView.theme(
    {
      "&": {
        color: "var(--text)",
        backgroundColor: "transparent",
        fontSize: `${fontSize}px`,
      },
      ".cm-content": {
        caretColor: "var(--accent)",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--accent)",
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--muted)",
        border: "none",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--surface-2)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
    },
    { dark: theme.appearance === "dark" },
  );
}

export function exoSyntaxHighlighting(theme: ExoThemeVariant): Extension {
  return syntaxHighlighting(exoSyntaxHighlightStyle(theme.syntax));
}

function exoSyntaxHighlightStyle(color: ExoSyntaxTheme): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: color.keyword },
    { tag: [tags.atom, tags.bool, tags.null], color: color.atom },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: color.string },
    { tag: [tags.number, tags.integer, tags.float], color: color.number },
    { tag: [tags.variableName, tags.self, tags.standard(tags.variableName)], color: color.variable },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: color.functionName },
    { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName), tags.className], color: color.definition },
    { tag: [tags.propertyName, tags.attributeName, tags.tagName], color: color.property },
    { tag: [tags.operator, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator], color: color.operator },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: color.comment, fontStyle: "italic" },
    { tag: [tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.squareBracket, tags.brace], color: color.punctuation },
    { tag: [tags.meta, tags.processingInstruction, tags.moduleKeyword], color: color.meta },
    { tag: tags.invalid, color: color.invalid },
  ]);
}
