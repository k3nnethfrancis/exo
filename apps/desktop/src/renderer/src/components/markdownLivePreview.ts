import { type Extension, RangeSetBuilder, StateEffect, StateField, type Text, Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LIST_GEOMETRY, listGeometryStyleVariables } from "./listGeometry";
import {
  listContinuationOutdentKeymap,
  listPrefixAtomicRanges,
  listPrefixNavigationKeymap,
  listPrefixSelectionFilter,
  toggleTaskCheckboxAt,
  wikilinkExitKeymap,
} from "./markdown-live-preview/commands";
import {
  type ListContext,
  markdownPreviewMetadata,
  type MarkdownPreviewMetadata,
  type TableContext,
  updateMarkdownPreviewMetadataForChanges,
} from "./markdown-live-preview/metadata";

const toggleFoldEffect = StateEffect.define<number>();

const foldedListParentAnchorsField = StateField.define<Set<number>>({
  create() {
    return new Set();
  },
  update(folded, tr) {
    let next = folded;
    for (const effect of tr.effects) {
      if (effect.is(toggleFoldEffect)) {
        next = new Set(next);
        if (next.has(effect.value)) {
          next.delete(effect.value);
        } else {
          next.add(effect.value);
        }
      }
    }
    if (tr.docChanged) {
      // A fold follows its parent line-start anchor, never a raw line number.
      const remapped = new Set<number>();
      for (const anchor of next) {
        const mappedAnchor = remapFoldParentAnchor(anchor, tr);
        if (mappedAnchor !== null) {
          remapped.add(mappedAnchor);
        }
      }
      return remapped;
    }
    return next;
  },
});

function remapFoldParentAnchor(anchor: number, tr: Transaction): number | null {
  let parentDeleted = false;
  let insertedLineBeforeParent = false;
  const parentLineEnd = tr.startState.doc.lineAt(anchor).to;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (fromA <= anchor && toA >= parentLineEnd) {
      parentDeleted = true;
    }
    if (fromA === anchor && toA === anchor && inserted.toString().includes("\n")) {
      insertedLineBeforeParent = true;
    }
  }, true);
  if (parentDeleted) {
    return null;
  }

  const mappedAnchor = tr.changes.mapPos(anchor, insertedLineBeforeParent ? 1 : -1);
  return isListParentAnchor(tr.state.doc, mappedAnchor) ? mappedAnchor : null;
}

function isListParentAnchor(doc: Text, anchor: number): boolean {
  if (anchor < 0 || anchor > doc.length) return false;
  const line = doc.lineAt(anchor);
  return line.from === anchor && listPrefixPattern.test(line.text);
}

const concealDecoration = Decoration.mark({ class: "exo-md-syntax-hidden" });
const boldDecoration = Decoration.mark({ class: "exo-md-strong" });
const italicDecoration = Decoration.mark({ class: "exo-md-emphasis" });
const strikeDecoration = Decoration.mark({ class: "exo-md-strike" });
const codeDecoration = Decoration.mark({ class: "exo-md-inline-code" });

interface MarkdownLivePreviewOptions {
  onOpenTarget: (target: string) => void;
  onOpenTag: (tag: string) => void;
  onResolveImage: (target: string, options?: { lookupByFilename?: boolean }) => Promise<{ url: string }>;
  suppressedGeneratedTitle?: string | null;
  graphReferences?: MarkdownGraphReferences | null;
}

export interface MarkdownGraphReferenceItem {
  label: string;
  target: string;
}

export interface MarkdownGraphReferences {
  backlinks: MarkdownGraphReferenceItem[];
  references: MarkdownGraphReferenceItem[];
}

const listPrefixPattern = /^(\s*)((?:[-*+]|\d+[.)]))\s+/;

export function markdownLivePreview(options: MarkdownLivePreviewOptions): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      metadata: MarkdownPreviewMetadata;

      constructor(view: EditorView) {
        this.metadata = markdownPreviewMetadata(view.state.doc);
        this.decorations = buildDecorations(view, options, this.metadata);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.metadata = updateMarkdownPreviewMetadataForChanges(update.startState.doc, update.state.doc, update.changes, this.metadata);
        }
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(toggleFoldEffect)))) {
          this.decorations = buildDecorations(update.view, options, this.metadata);
        }
      }
    },
    { decorations: (instance) => instance.decorations },
  );

  return [
    foldedListParentAnchorsField,
    listPrefixAtomicRanges,
    listPrefixSelectionFilter,
    plugin,
    wikilinkExitKeymap,
    listContinuationOutdentKeymap,
    listPrefixNavigationKeymap,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.target instanceof HTMLElement)) return false;

        const checkbox = event.target.closest<HTMLElement>("[data-exo-checkbox-pos]");
        if (checkbox) {
          const toggled = toggleTaskCheckboxAt(view, checkbox.dataset.exoCheckboxPos);
          if (toggled) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
        }

        const interactivePreviewControl = event.target.closest<HTMLElement>(
          "[data-exo-fold-anchor], [data-exo-checkbox-pos], [data-exo-link-target], [data-exo-tag]",
        );
        if (!interactivePreviewControl) {
          return false;
        }

        event.preventDefault();
        return true;
      },
      click(event, view) {
        if (!(event.target instanceof HTMLElement)) return false;

        // Checkbox toggle
        const checkbox = event.target.closest<HTMLElement>("[data-exo-checkbox-pos]");
        if (checkbox) {
          event.preventDefault();
          return true;
        }

        // List fold toggle
        const foldToggle = event.target.closest<HTMLElement>("[data-exo-fold-anchor]");
        if (foldToggle) {
          const anchor = Number(foldToggle.dataset.exoFoldAnchor);
          if (Number.isInteger(anchor) && anchor >= 0 && anchor <= view.state.doc.length) {
            view.dispatch({ effects: toggleFoldEffect.of(anchor) });
            event.preventDefault();
            return true;
          }
        }

        // Link / tag clicks
        const target = event.target.closest<HTMLElement>("[data-exo-link-target], [data-exo-tag]");
        if (!target) {
          return false;
        }

        const noteTarget = target.dataset.exoLinkTarget;
        if (noteTarget) {
          event.preventDefault();
          options.onOpenTarget(noteTarget);
          return true;
        }

        const tag = target.dataset.exoTag;
        if (tag) {
          event.preventDefault();
          options.onOpenTag(tag);
          return true;
        }

        return false;
      },
    }),
  ];
}

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

export function visibleLineNumbers(
  doc: { lineAt(position: number): { number: number }; lines: number },
  ranges: readonly { from: number; to: number }[],
): number[] {
  const visible = new Set<number>();
  for (const range of ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) {
      visible.add(line);
    }
  }
  return [...visible].sort((left, right) => left - right);
}

function foldedListLineNumbers(doc: Text, listContexts: Map<number, ListContext>, anchors: ReadonlySet<number>) {
  const lines = new Set<number>();
  for (const anchor of anchors) {
    const line = doc.lineAt(anchor);
    if (line.from === anchor && listContexts.get(line.number)?.isListStart) {
      lines.add(line.number);
    }
  }
  return lines;
}

function buildDecorations(view: EditorView, options: MarkdownLivePreviewOptions, metadata: MarkdownPreviewMetadata): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const { listContexts, tableContexts, codeFenceContexts } = metadata;
  const foldedParentAnchors = view.state.field(foldedListParentAnchorsField);
  const foldedLines = foldedListLineNumbers(view.state.doc, listContexts, foldedParentAnchors);

  // Determine which list lines have children (next line has greater depth)
  const linesWithChildren = new Set<number>();
  for (const [lineNum, ctx] of listContexts) {
    if (!ctx.isListStart) continue;
    const nextCtx = listContexts.get(lineNum + 1);
    if (nextCtx && nextCtx.depth > ctx.depth) {
      linesWithChildren.add(lineNum);
    }
  }

  // Compute which lines are hidden due to folding
  const hiddenLines = new Set<number>();
  for (const foldedLine of foldedLines) {
    const foldedCtx = listContexts.get(foldedLine);
    if (!foldedCtx) continue;
    const foldDepth = foldedCtx.depth;
    for (let ln = foldedLine + 1; ln <= view.state.doc.lines; ln++) {
      const ctx = listContexts.get(ln);
      if (!ctx || (ctx.isListStart && ctx.depth <= foldDepth)) break;
      hiddenLines.add(ln);
    }
  }

  const lineDecorations: DecorationEntry[] = [];
  const inlineDecorations: DecorationEntry[] = [];

  const cursorPos = view.state.selection.main.head;

  const handledTableStarts = new Set<number>();

  const renderedLineNumbers = visibleLineNumbers(view.state.doc, view.visibleRanges);
  if (!renderedLineNumbers.includes(currentLine)) {
    renderedLineNumbers.push(currentLine);
    renderedLineNumbers.sort((left, right) => left - right);
  }
  for (const lineNumber of renderedLineNumbers) {
    const line = view.state.doc.line(lineNumber);
    const text = line.text;
    const codeFenceCtx = codeFenceContexts.get(lineNumber);

    if (lineNumber === 1 && shouldSuppressGeneratedTitleLine(text, options.suppressedGeneratedTitle ?? null)) {
      lineDecorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: "exo-md-line--suppressed-title" }),
      });
      if (line.from < line.to) {
        lineDecorations.push({ from: line.from, to: line.to, decoration: Decoration.replace({}) });
      }
      continue;
    }

    if (hiddenLines.has(lineNumber)) {
      lineDecorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: "exo-md-line--folded-hidden" }),
      });
      continue;
    }

    if (codeFenceCtx) {
      const isFenceLine = lineNumber === codeFenceCtx.startLine || lineNumber === codeFenceCtx.endLine;
      const isSingleUnclosedFence = codeFenceCtx.startLine === codeFenceCtx.endLine;
      const cursorOnLine = currentLine === lineNumber;

      if (isFenceLine) {
        lineDecorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({
            attributes: {
              class: "exo-md-line exo-md-line--codefence",
              ...(codeFenceCtx.language ? { "data-exo-code-language": codeFenceCtx.language } : {}),
            },
          }),
        });

        if (!cursorOnLine && line.from < line.to) {
          lineDecorations.push({ from: line.from, to: line.to, decoration: concealDecoration });
        }

        if (isSingleUnclosedFence || cursorOnLine) {
          continue;
        }
      }

      if (!isFenceLine) {
        const classes = [
          "exo-md-line",
          "exo-md-line--codeblock",
          lineNumber === codeFenceCtx.startLine + 1 ? "exo-md-line--codeblock-start" : "",
          lineNumber === codeFenceCtx.endLine - 1 ? "exo-md-line--codeblock-end" : "",
        ].filter(Boolean);
        lineDecorations.push({
          from: line.from,
          to: line.from,
          decoration: Decoration.line({
            attributes: {
              class: classes.join(" "),
              ...(codeFenceCtx.language ? { "data-exo-code-language": codeFenceCtx.language } : {}),
            },
          }),
        });
        continue;
      }

      continue;
    }

    const tableCtx = tableContexts.get(lineNumber);
    if (tableCtx) {
      const cursorInTable = currentLine >= tableCtx.startLine && currentLine <= tableCtx.endLine;
      if (cursorInTable) {
        // Edit mode — show raw markdown, fall through to normal per-line decoration
      } else {
        if (lineNumber === tableCtx.startLine && !handledTableStarts.has(tableCtx.startLine)) {
          handledTableStarts.add(tableCtx.startLine);
          // Replace the start line's content with the table widget (single-line range — no block:true).
          // ViewPlugins cannot emit block decorations; this stays inline.
          if (line.from < line.to) {
            lineDecorations.push({
              from: line.from,
              to: line.to,
              decoration: Decoration.replace({ widget: new TableWidget(tableCtx) }),
            });
          } else {
            // Empty start line edge case — emit as a line decoration with the widget via mark
            lineDecorations.push({
              from: line.from,
              to: line.from,
              decoration: Decoration.widget({ widget: new TableWidget(tableCtx), side: 1 }),
            });
          }
        } else if (lineNumber !== tableCtx.startLine) {
          // Hide other table lines via line-level CSS class (display:none)
          lineDecorations.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({ class: "exo-md-line--folded-hidden" }),
          });
        }
        continue;
      }
    }

    const hasChildren = linesWithChildren.has(lineNumber);
    const isFolded = foldedLines.has(lineNumber);
    decorateLine(line.from, line.number, text, cursorPos, listContexts, lineDecorations, hasChildren, isFolded);
    decorateInline(line.from, text, cursorPos, inlineDecorations, options);
  }

  // Line decorations (from === to, point decorations) must come first at each position,
  // then range decorations sorted by from, then by to.
  const all = [...lineDecorations, ...inlineDecorations];
  if (options.graphReferences && (options.graphReferences.backlinks.length > 0 || options.graphReferences.references.length > 0)) {
    all.push({
      from: view.state.doc.length,
      to: view.state.doc.length,
      decoration: Decoration.widget({
        widget: new GraphReferencesWidget(options.graphReferences),
        side: 1,
      }),
    });
  }
  all.sort((a, b) => a.from - b.from || a.to - b.to);

  for (const entry of all) {
    builder.add(entry.from, entry.to, entry.decoration);
  }

  return builder.finish();
}

class GraphReferencesWidget extends WidgetType {
  constructor(private readonly references: MarkdownGraphReferences) {
    super();
  }

  toDOM() {
    const wrap = document.createElement("section");
    wrap.className = "markdown-graph-references";
    wrap.dataset.testid = "markdown-graph-references";
    wrap.contentEditable = "false";
    wrap.setAttribute("aria-label", "Graph references");

    if (this.references.backlinks.length > 0) {
      wrap.appendChild(this.renderGroup("Backlinks", this.references.backlinks, "backlinks"));
    }
    if (this.references.references.length > 0) {
      wrap.appendChild(this.renderGroup("References", this.references.references, "references"));
    }

    return wrap;
  }

  eq(other: GraphReferencesWidget) {
    return JSON.stringify(other.references) === JSON.stringify(this.references);
  }

  ignoreEvent(event: Event) {
    return event.type !== "click" && event.type !== "mousedown";
  }

  private renderGroup(title: string, items: MarkdownGraphReferenceItem[], testId: string) {
    const group = document.createElement("div");
    group.className = "markdown-graph-references__group";
    group.dataset.testid = `markdown-graph-${testId}`;

    const heading = document.createElement("div");
    heading.className = "markdown-graph-references__title";
    heading.textContent = title;
    group.appendChild(heading);

    const list = document.createElement("div");
    list.className = "markdown-graph-references__items";
    for (const item of items) {
      const button = document.createElement("button");
      button.className = "markdown-graph-references__item";
      button.type = "button";
      button.dataset.exoLinkTarget = item.target;
      button.dataset.exoLinkKind = "wikilink";
      button.textContent = item.label;
      list.appendChild(button);
    }
    group.appendChild(list);
    return group;
  }
}

export function shouldSuppressGeneratedTitleLine(lineText: string, suppressedGeneratedTitle: string | null): boolean {
  if (!suppressedGeneratedTitle) {
    return false;
  }
  return lineText.trim() === `# ${suppressedGeneratedTitle}`;
}

function cursorWithin(cursorPos: number, from: number, to: number): boolean {
  return cursorPos >= from && cursorPos <= to;
}

function decorateLine(
  lineFrom: number,
  lineNumber: number,
  text: string,
  cursorPos: number,
  listContexts: Map<number, ListContext>,
  out: DecorationEntry[],
  hasChildren = false,
  isFolded = false,
) {
  const heading = text.match(/^(#{1,6})\s+/);
  if (heading) {
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: `exo-md-line exo-md-line--heading exo-md-line--h${heading[1].length}` }) });
    const prefixEnd = lineFrom + heading[0].length;
    if (!cursorWithin(cursorPos, lineFrom, prefixEnd)) {
      out.push({ from: lineFrom, to: prefixEnd, decoration: concealDecoration });
    }
    return;
  }

  const listContext = listContexts.get(lineNumber);
  if (listContext) {
    out.push({
      from: lineFrom,
      to: lineFrom,
      decoration: Decoration.line({
        attributes: {
          class: `exo-md-line ${listContext.isListStart ? "exo-md-line--list-start" : "exo-md-line--list-continuation"}`,
          style: listLineStyle(listContext.depth),
          "data-exo-list-depth": String(listContext.depth),
        },
      }),
    });
  }

  const task = text.match(/^(\s*[-*+]\s+)\[([ xX])\]\s+/);
  if (task) {
    const isChecked = task[2].toLowerCase() === "x";
    const checkboxCharPos = lineFrom + task[1].length + 1;
    const prefixEnd = lineFrom + task[0].length;
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: `exo-md-line exo-md-line--task${isChecked ? " exo-md-line--task-done" : ""}` }) });
    if (!cursorWithin(cursorPos, lineFrom, prefixEnd)) {
      out.push({
        from: lineFrom,
        to: prefixEnd,
        decoration: Decoration.replace({ widget: new TaskPrefixWidget(isChecked, listContext?.depth ?? 0, checkboxCharPos) }),
      });
    }
    return;
  }

  if (listContext) {
    if (listContext.isListStart) {
      const prefixEnd = lineFrom + listContext.prefixLength;
      const cursorInPrefix = cursorPos >= lineFrom && cursorPos < prefixEnd;
      const lineClass = [
        "exo-md-line",
        "exo-md-line--list",
        listContext.ordered ? "exo-md-line--list-ordered" : "",
        hasChildren ? "exo-md-line--list-has-children" : "",
        isFolded ? "exo-md-line--list-folded" : "",
        cursorInPrefix ? "exo-md-line--list-raw" : "",
      ].filter(Boolean).join(" ");
      out.push({
        from: lineFrom,
        to: lineFrom,
        decoration: Decoration.line({
          attributes: {
            class: lineClass,
            style: listLineStyle(listContext.depth),
            "data-exo-list-depth": String(listContext.depth),
            "data-exo-list-marker": listContext.marker,
            ...(cursorInPrefix ? { "data-exo-list-raw": listContext.marker } : {}),
          },
        }),
      });
      if (hasChildren) {
        out.push({
          from: lineFrom,
          to: lineFrom,
          decoration: Decoration.widget({ widget: new ListFoldToggleWidget(listContext.depth, isFolded, lineFrom), side: -1 }),
        });
      }
      if (!cursorInPrefix) {
        // Normal mode: replace entire prefix invisibly, bullet shown via ::before.
        out.push({ from: lineFrom, to: prefixEnd, decoration: Decoration.replace({}) });
      } else {
        const markerMatch = text.match(listPrefixPattern);
        const markerStart = lineFrom + (markerMatch?.[1].length ?? 0);
        const markerEnd = markerStart + listContext.marker.length;
        if (lineFrom < markerStart) {
          out.push({ from: lineFrom, to: markerStart, decoration: Decoration.replace({}) });
        }
        out.push({ from: markerStart, to: markerEnd, decoration: Decoration.mark({ class: "exo-md-list-marker-raw" }) });
        if (markerEnd < prefixEnd) {
          out.push({ from: markerEnd, to: prefixEnd, decoration: Decoration.replace({}) });
        }
      }
    } else {
      out.push({
        from: lineFrom,
        to: lineFrom,
        decoration: Decoration.line({
          attributes: {
            class: "exo-md-line exo-md-line--list exo-md-line--list-continuation",
            style: listLineStyle(listContext.depth),
            "data-exo-list-depth": String(listContext.depth),
          },
        }),
      });
    }
    return;
  }

  const quoteMatch = text.match(/^(>\s*)/);
  if (quoteMatch) {
    const prefixLen = quoteMatch[1].length;
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: "exo-md-line exo-md-line--quote" }) });
    if (!cursorWithin(cursorPos, lineFrom, lineFrom + prefixLen)) {
      out.push({ from: lineFrom, to: lineFrom + prefixLen, decoration: concealDecoration });
    }
    return;
  }

  if (isThematicBreak(text)) {
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: "exo-md-line exo-md-line--rule" }) });
    if (!cursorWithin(cursorPos, lineFrom, lineFrom + text.length)) {
      out.push({ from: lineFrom, to: lineFrom + text.length, decoration: concealDecoration });
    }
  }
}

function isThematicBreak(text: string) {
  const trimmed = text.trim();
  if (!/^[-*_][\s-*_]*$/.test(trimmed)) {
    return false;
  }

  const marker = trimmed[0];
  if (![...trimmed].every((char) => char === marker || /\s/.test(char))) {
    return false;
  }

  return [...trimmed].filter((char) => char === marker).length >= 3;
}

function decorateInline(
  lineFrom: number,
  text: string,
  cursorPos: number,
  out: DecorationEntry[],
  options: MarkdownLivePreviewOptions,
) {
  applyDelimited(text, lineFrom, /\*\*(.+?)\*\*/g, 2, boldDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /(?<!\*)\*([^*]+)\*(?!\*)/g, 1, italicDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /~~(.+?)~~/g, 2, strikeDecoration, out, cursorPos);
  applyObsidianImageEmbeds(text, lineFrom, out, cursorPos, options);
  applyWikilinks(text, lineFrom, out, cursorPos);
  applyMarkdownImages(text, lineFrom, out, cursorPos, options);
  applyMarkdownLinks(text, lineFrom, out, cursorPos);

  applyDelimited(text, lineFrom, /`([^`\n]+)`/g, 1, codeDecoration, out, cursorPos);
  applyInteractiveMarks(text, lineFrom, /(^|[\s(])#([A-Za-z][\w/-]*)\b/g, out, (match, start) => {
    const offset = match[1] ? match[1].length : 0;
    return [start + offset, start + offset + match[2].length + 1, { "data-exo-tag": match[2] }];
  }, "exo-md-tag");
}

/**
 * The Markdown source stays canonical. Outside the image's range it becomes a
 * widget; placing the caret in that range removes the widget and exposes the
 * exact source for ordinary CodeMirror editing.
 */
function applyMarkdownImages(
  text: string,
  lineFrom: number,
  out: DecorationEntry[],
  cursorPos: number,
  options: MarkdownLivePreviewOptions,
) {
  for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|(.+?))\s*\)/g)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (cursorWithin(cursorPos, start, end)) {
      continue;
    }
    const target = markdownImageTarget(match[2] ?? match[3] ?? "");
    if (!target) {
      continue;
    }
    out.push({
      from: start,
      to: end,
      decoration: Decoration.replace({ widget: new MarkdownImageWidget(match[1], target, options.onResolveImage) }),
    });
  }
}

function applyObsidianImageEmbeds(
  text: string,
  lineFrom: number,
  out: DecorationEntry[],
  cursorPos: number,
  options: MarkdownLivePreviewOptions,
) {
  for (const match of text.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (cursorWithin(cursorPos, start, end)) {
      continue;
    }
    const target = match[1].trim();
    if (!target) {
      continue;
    }
    out.push({
      from: start,
      to: end,
      decoration: Decoration.replace({ widget: new MarkdownImageWidget(target, target, options.onResolveImage, true) }),
    });
  }
}

export function markdownImageTarget(rawTarget: string): string {
  // Optional Markdown titles follow a target in quotes or parentheses. Keep
  // ordinary spaces in local filenames intact.
  return rawTarget.trim().replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/, "").trim();
}

class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly target: string,
    private readonly resolveImage: MarkdownLivePreviewOptions["onResolveImage"],
    private readonly lookupByFilename = false,
  ) {
    super();
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "exo-md-image exo-md-image--loading";
    wrap.contentEditable = "false";
    wrap.dataset.testid = "markdown-image";
    wrap.setAttribute("aria-label", this.alt || "Markdown image");

    const fallback = document.createElement("span");
    fallback.className = "exo-md-image__fallback";
    fallback.textContent = this.alt || "Image";
    wrap.appendChild(fallback);

    const appendImage = (url: string) => {
      const image = document.createElement("img");
      image.className = "exo-md-image__asset";
      image.src = url;
      image.alt = this.alt;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("load", () => {
        wrap.classList.remove("exo-md-image--loading", "exo-md-image--missing");
        fallback.remove();
      }, { once: true });
      image.addEventListener("error", () => {
        wrap.classList.remove("exo-md-image--loading");
        wrap.classList.add("exo-md-image--missing");
        image.remove();
      }, { once: true });
      wrap.appendChild(image);
    };

    const remoteUrl = remoteMarkdownImageUrl(this.target);
    if (remoteUrl) {
      appendImage(remoteUrl);
      return wrap;
    }

    void this.resolveImage(this.target, { lookupByFilename: this.lookupByFilename }).then(({ url }) => {
      appendImage(url);
    }).catch(() => {
      wrap.classList.remove("exo-md-image--loading");
      wrap.classList.add("exo-md-image--missing");
    });
    return wrap;
  }

  eq(other: MarkdownImageWidget) {
    return other.alt === this.alt && other.target === this.target;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * HTTP(S) images are public references in the Markdown document, so the
 * renderer loads them directly. Local paths still use the main-process
 * resolver, which enforces Note Root containment before returning a file URL.
 */
export function remoteMarkdownImageUrl(target: string): string | null {
  try {
    const url = new URL(target);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function applyDelimited(
  text: string,
  lineFrom: number,
  pattern: RegExp,
  delimiterLength: number,
  decoration: Decoration,
  out: DecorationEntry[],
  cursorPos: number,
) {
  for (const match of text.matchAll(pattern)) {
    const start = lineFrom + (match.index ?? 0);
    const end = start + match[0].length;
    if (cursorWithin(cursorPos, start, end)) {
      // Cursor is inside this match — show raw delimiters, still apply style
      out.push({ from: start + delimiterLength, to: end - delimiterLength, decoration });
    } else {
      out.push({ from: start, to: start + delimiterLength, decoration: concealDecoration });
      out.push({ from: start + delimiterLength, to: end - delimiterLength, decoration });
      out.push({ from: end - delimiterLength, to: end, decoration: concealDecoration });
    }
  }
}

function applyInteractiveMarks(
  text: string,
  lineFrom: number,
  pattern: RegExp,
  out: DecorationEntry[],
  rangeResolver: (match: RegExpMatchArray, start: number) => [number, number, Record<string, string>?],
  className = "exo-md-link",
) {
  for (const match of text.matchAll(pattern)) {
    const start = lineFrom + (match.index ?? 0);
    const [from, to, attrs] = rangeResolver(match, start);
    out.push({ from, to, decoration: Decoration.mark({ class: className, attributes: attrs }) });
  }
}

function applyWikilinks(text: string, lineFrom: number, out: DecorationEntry[], cursorPos: number) {
  for (const match of text.matchAll(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    const start = lineFrom + (match.index ?? 0);
    const fullText = match[0];
    const end = start + fullText.length;
    const target = match[1].trim();
    const label = (match[2] ?? target).trim();
    const labelStartOffset = match[2] ? fullText.indexOf(match[2]) : 2;
    const labelStart = start + labelStartOffset;
    const labelEnd = labelStart + label.length;

    if (cursorWithin(cursorPos, start, end)) {
      // Cursor inside — show raw wikilink, still make the label clickable
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": target, "data-exo-link-kind": "wikilink" } }) });
    } else {
      out.push({ from: start, to: start + 2, decoration: concealDecoration });
      if (match[2]) {
        out.push({ from: start + 2, to: labelStart, decoration: concealDecoration });
      }
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": target, "data-exo-link-kind": "wikilink" } }) });
      out.push({ from: end - 2, to: end, decoration: concealDecoration });
    }
  }
}

function applyMarkdownLinks(text: string, lineFrom: number, out: DecorationEntry[], cursorPos: number) {
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const start = lineFrom + (match.index ?? 0);
    // Images are handled by their own replacement widget. Without this guard,
    // the link parser would also decorate the nested `[alt](target)` range.
    if (start > lineFrom && text[start - lineFrom - 1] === "!") {
      continue;
    }
    const end = start + match[0].length;
    const label = match[1];
    const labelStart = start + 1;
    const labelEnd = labelStart + label.length;

    if (cursorWithin(cursorPos, start, end)) {
      // Cursor inside — show raw markdown link, still make label clickable
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": match[2].trim() } }) });
    } else {
      out.push({ from: start, to: start + 1, decoration: concealDecoration });
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": match[2].trim() } }) });
      out.push({ from: labelEnd, to: end, decoration: concealDecoration });
    }
  }
}

class TaskPrefixWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly depth: number,
    private readonly checkboxPos: number,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "exo-md-list-prefix exo-md-list-prefix--task";
    const bulletLeft = LIST_GEOMETRY.baseIndent + this.depth * LIST_GEOMETRY.indentStep - LIST_GEOMETRY.markerLaneWidth;
    span.style.left = `${bulletLeft}px`;
    const checkbox = document.createElement("span");
    checkbox.className = `exo-md-checkbox ${this.checked ? "exo-md-checkbox--checked" : ""}`;
    checkbox.dataset.exoCheckboxPos = String(this.checkboxPos);
    span.appendChild(checkbox);
    return span;
  }

  eq(other: TaskPrefixWidget) {
    return other.checked === this.checked && other.depth === this.depth && other.checkboxPos === this.checkboxPos;
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown";
  }
}

class ListFoldToggleWidget extends WidgetType {
  constructor(
    private readonly depth: number,
    private readonly isFolded: boolean,
    private readonly parentAnchor: number,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "exo-md-list-prefix exo-md-list-prefix--fold";
    const bulletLeft = LIST_GEOMETRY.baseIndent + this.depth * LIST_GEOMETRY.indentStep - LIST_GEOMETRY.markerLaneWidth;
    span.style.left = `${bulletLeft - 14}px`;
    span.style.width = "14px";

    const fold = document.createElement("span");
    fold.className = `exo-md-fold-toggle ${this.isFolded ? "exo-md-fold-toggle--folded" : ""}`;
    fold.dataset.exoFoldAnchor = String(this.parentAnchor);
    span.appendChild(fold);
    return span;
  }

  eq(other: ListFoldToggleWidget) {
    return other.depth === this.depth && other.isFolded === this.isFolded && other.parentAnchor === this.parentAnchor;
  }

  ignoreEvent(event: Event) {
    return event.type === "mousedown";
  }
}

function listLineStyle(depth: number) {
  const padLeft = LIST_GEOMETRY.baseIndent + depth * LIST_GEOMETRY.indentStep;
  return `${listGeometryStyleVariables()};--exo-list-depth:${depth};padding-left:${padLeft}px;`;
}

// ---------------------------------------------------------------------------
class TableWidget extends WidgetType {
  constructor(private readonly ctx: TableContext) {
    super();
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "exo-md-table-wrap";

    const table = document.createElement("table");
    table.className = "exo-md-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this.ctx.headers.forEach((cell, idx) => {
      const th = document.createElement("th");
      th.textContent = cell;
      const align = this.ctx.alignments[idx] ?? "left";
      th.style.textAlign = align;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.ctx.rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, idx) => {
        const td = document.createElement("td");
        td.textContent = cell;
        const align = this.ctx.alignments[idx] ?? "left";
        td.style.textAlign = align;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  eq(other: TableWidget) {
    if (other.ctx.headers.length !== this.ctx.headers.length) return false;
    if (other.ctx.rows.length !== this.ctx.rows.length) return false;
    if (other.ctx.headers.some((h, i) => h !== this.ctx.headers[i])) return false;
    if (other.ctx.alignments.some((a, i) => a !== this.ctx.alignments[i])) return false;
    for (let r = 0; r < this.ctx.rows.length; r += 1) {
      const a = this.ctx.rows[r];
      const b = other.ctx.rows[r];
      if (a.length !== b.length) return false;
      if (a.some((c, i) => c !== b[i])) return false;
    }
    return true;
  }

  ignoreEvent() {
    return false;
  }
}
