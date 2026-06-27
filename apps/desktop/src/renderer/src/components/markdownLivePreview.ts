import { EditorSelection, EditorState, Prec, Transaction, type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { indentLess } from "@codemirror/commands";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LIST_GEOMETRY, listGeometryStyleVariables } from "./listGeometry";

const toggleFoldEffect = StateEffect.define<number>();

const foldedLinesField = StateField.define<Set<number>>({
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
      // Remap folded line numbers after edits
      const remapped = new Set<number>();
      for (const lineNumber of next) {
        if (lineNumber >= 1 && lineNumber <= tr.state.doc.lines) {
          remapped.add(lineNumber);
        }
      }
      return remapped;
    }
    return next;
  },
});

const concealDecoration = Decoration.mark({ class: "exo-md-syntax-hidden" });
const boldDecoration = Decoration.mark({ class: "exo-md-strong" });
const italicDecoration = Decoration.mark({ class: "exo-md-emphasis" });
const strikeDecoration = Decoration.mark({ class: "exo-md-strike" });
const codeDecoration = Decoration.mark({ class: "exo-md-inline-code" });

interface MarkdownLivePreviewOptions {
  onOpenTarget: (target: string) => void;
  onOpenTag: (tag: string) => void;
  suppressedGeneratedTitle?: string | null;
  graphReferences?: MarkdownGraphReferences | null;
}

interface ListContext {
  depth: number;
  marker: string;
  ordered: boolean;
  isListStart: boolean;
  prefixLength: number;
}

interface CodeFenceContext {
  startLine: number;
  endLine: number;
  language: string;
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
const taskListPrefixPattern = /^(\s*)([-*+])\s+\[[ xX]\]\s+/;
const leadingWhitespacePattern = /^(\s*)/;

export function markdownLivePreview(options: MarkdownLivePreviewOptions): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(toggleFoldEffect)))) {
          this.decorations = buildDecorations(update.view, options);
        }
      }
    },
    { decorations: (instance) => instance.decorations },
  );

  return [
    foldedLinesField,
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
          "[data-exo-fold-line], [data-exo-checkbox-pos], [data-exo-link-target], [data-exo-tag]",
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
        const foldToggle = event.target.closest<HTMLElement>("[data-exo-fold-line]");
        if (foldToggle) {
          const lineNum = Number(foldToggle.dataset.exoFoldLine);
          if (!Number.isNaN(lineNum)) {
            view.dispatch({ effects: toggleFoldEffect.of(lineNum) });
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

function toggleTaskCheckboxAt(view: EditorView, rawPos: string | undefined) {
  const pos = Number(rawPos);
  if (!Number.isInteger(pos) || pos < 0 || pos >= view.state.doc.length) {
    return false;
  }

  const currentChar = view.state.doc.sliceString(pos, pos + 1);
  const newChar = nextTaskCheckboxMarker(currentChar);
  if (newChar === null) {
    return false;
  }

  view.dispatch({
    changes: { from: pos, to: pos + 1, insert: newChar },
    userEvent: "input",
  });
  view.focus();
  return true;
}

function nextTaskCheckboxMarker(currentChar: string) {
  if (currentChar === " ") {
    return "x";
  }
  if (currentChar === "x" || currentChar === "X") {
    return " ";
  }
  return null;
}

const listPrefixAtomicRanges = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const match = line.text.match(listPrefixPattern);
    if (!match) {
      continue;
    }

    const marker = match[2] || "-";
    const markerStart = line.from + match[1].length;
    const markerEnd = markerStart + marker.length;
    const prefixEnd = line.from + match[0].length;

    if (line.from < markerStart) {
      builder.add(line.from, markerStart, Decoration.replace({}));
    }
    if (markerEnd < prefixEnd) {
      builder.add(markerEnd, prefixEnd, Decoration.replace({}));
    }
  }

  return builder.finish();
});

const listPrefixNavigationKeymap = Prec.highest(keymap.of([
  {
    key: "ArrowLeft",
    run: moveWithinListPrefix("left"),
  },
  {
    key: "ArrowRight",
    run: moveWithinListPrefix("right"),
  },
]));

const listContinuationOutdentKeymap = Prec.highest(keymap.of([
  {
    key: "Enter",
    run: continueOrExitList,
  },
  {
    key: "Shift-Tab",
    run: outdentBlankListContinuation,
  },
  {
    key: "Mod-[",
    run: (view) => outdentBlankListContinuation(view) || indentLess(view),
  },
]));

const wikilinkExitKeymap = Prec.highest(keymap.of([
  {
    key: "Tab",
    run: exitWikilink,
  },
  {
    key: "Enter",
    run: exitWikilink,
  },
]));

const listPrefixSelectionFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || !tr.changes.empty) {
    return tr;
  }

  const range = tr.selection.main;
  if (!range.empty) {
    return tr;
  }

  const positions = listPrefixPositionsAt(tr.state, range.head);
  if (!positions) {
    return tr;
  }

  const markerInterior = range.head > positions.markerStart && range.head < positions.markerEnd;
  const hiddenLineStart = range.head === positions.lineFrom && positions.lineFrom < positions.markerStart;
  const hiddenBeforeMarker = range.head > positions.lineFrom && range.head < positions.markerStart;
  const hiddenAfterMarker = range.head > positions.markerEnd && range.head < positions.prefixEnd;
  if (!markerInterior && !hiddenLineStart && !hiddenBeforeMarker && !hiddenAfterMarker) {
    return tr;
  }

  const nextPos = hiddenLineStart || hiddenBeforeMarker || hiddenAfterMarker || markerInterior ? positions.prefixEnd : range.head;

  return {
    selection: EditorSelection.cursor(nextPos),
    scrollIntoView: true,
    annotations: Transaction.userEvent.of("select"),
  };
});

function moveWithinListPrefix(direction: "left" | "right") {
  return (view: EditorView): boolean => moveListPrefixSelection(view, direction);
}

function moveListPrefixSelection(view: EditorView, direction: "left" | "right"): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }

  const positions = listPrefixPositionsAt(view.state, range.head);
  if (!positions) {
    return false;
  }

  const nextPos = direction === "left" ? listPrefixArrowLeftTarget(view.state, positions, range.head) : listPrefixArrowRightTarget(positions, range.head);
  if (nextPos === null) {
    return false;
  }

  view.dispatch({
    selection: EditorSelection.cursor(nextPos),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

function outdentBlankListContinuation(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(range.head);
  if (!isBlankListContinuationLine(view.state, line.number)) {
    return false;
  }

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: "" },
    selection: EditorSelection.cursor(line.from),
    scrollIntoView: true,
    userEvent: "delete.dedent",
  });
  return true;
}

function exitWikilink(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }

  const edit = wikilinkExitEdit(view.state, range.head);
  if (!edit) {
    return false;
  }

  view.dispatch({
    changes: edit.insert ? { from: edit.insertAt, to: edit.insertAt, insert: edit.insert } : undefined,
    selection: EditorSelection.cursor(edit.selection),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

export function wikilinkExitEdit(state: EditorState, pos: number): { insertAt: number; insert: string; selection: number } | null {
  const line = state.doc.lineAt(pos);
  for (const match of line.text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    const start = line.from + (match.index ?? 0);
    const end = start + match[0].length;
    if (pos < start || pos > end) {
      continue;
    }

    const hasSpaceAfter = end < line.to && state.doc.sliceString(end, end + 1) === " ";
    if (hasSpaceAfter) {
      return { insertAt: end, insert: "", selection: end + 1 };
    }
    return { insertAt: end, insert: " ", selection: end + 1 };
  }
  return null;
}

function continueOrExitList(view: EditorView): boolean {
  const range = view.state.selection.main;
  if (!range.empty) {
    return false;
  }

  const edit = listEnterEdit(view.state, range.head);
  if (!edit) {
    return outdentBlankListContinuation(view);
  }

  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(edit.selection),
    scrollIntoView: true,
    userEvent: edit.exitList ? "delete.dedent" : "input",
  });
  return true;
}

export function listEnterEdit(state: EditorState, pos: number): { from: number; to: number; insert: string; selection: number; exitList: boolean } | null {
  const line = state.doc.lineAt(pos);
  const match = line.text.match(listPrefixPattern);
  if (!match) {
    return null;
  }

  const taskMatch = line.text.match(taskListPrefixPattern);
  if (taskMatch) {
    const prefix = taskMatch[0];
    const content = line.text.slice(prefix.length);
    if (content.trim().length === 0) {
      return {
        from: line.from,
        to: line.to,
        insert: "",
        selection: line.from,
        exitList: true,
      };
    }
    const nextPrefix = `${taskMatch[1]}${taskMatch[2]} [ ] `;
    return {
      from: pos,
      to: pos,
      insert: `\n${nextPrefix}`,
      selection: pos + nextPrefix.length + 1,
      exitList: false,
    };
  }

  const prefix = match[0];
  const marker = match[2] || "-";
  const content = line.text.slice(prefix.length);
  if (content.trim().length === 0) {
    return {
      from: line.from,
      to: line.to,
      insert: "",
      selection: line.from,
      exitList: true,
    };
  }

  const nextPrefix = `${match[1]}${nextListMarker(marker)} `;
  return {
    from: pos,
    to: pos,
    insert: `\n${nextPrefix}`,
    selection: pos + nextPrefix.length + 1,
    exitList: false,
  };
}

function nextListMarker(marker: string): string {
  const ordered = marker.match(/^(\d+)([.)])$/);
  if (!ordered) {
    return marker;
  }
  return `${Number(ordered[1]) + 1}${ordered[2]}`;
}

function isBlankListContinuationLine(state: EditorState, lineNumber: number): boolean {
  const line = state.doc.line(lineNumber);
  if (line.text.length === 0 || line.text.trim().length > 0) {
    return false;
  }

  const contexts = collectListMetadata(state.doc);
  for (let previousLine = lineNumber - 1; previousLine >= 1; previousLine -= 1) {
    const text = state.doc.line(previousLine).text;
    if (text.trim().length === 0) {
      continue;
    }
    return contexts.has(previousLine);
  }
  return false;
}

interface ListPrefixPositions {
  lineFrom: number;
  lineNumber: number;
  markerStart: number;
  markerEnd: number;
  prefixEnd: number;
}

function listPrefixPositionsAt(state: EditorState, pos: number): ListPrefixPositions | null {
  const line = state.doc.lineAt(pos);
  const match = line.text.match(listPrefixPattern);
  if (!match) {
    return null;
  }

  const marker = match[2] || "-";
  const markerStart = line.from + match[1].length;
  const markerEnd = markerStart + marker.length;
  const prefixEnd = line.from + match[0].length;
  if (pos < line.from || pos > prefixEnd) {
    return null;
  }

  return {
    lineFrom: line.from,
    lineNumber: line.number,
    markerStart,
    markerEnd,
    prefixEnd,
  };
}

function listPrefixArrowLeftTarget(state: EditorState, positions: ListPrefixPositions, pos: number): number | null {
  if (pos === positions.prefixEnd) {
    return positions.markerEnd;
  }
  if (pos > positions.markerEnd && pos < positions.prefixEnd) {
    return positions.markerEnd;
  }
  if (pos === positions.markerEnd) {
    return positions.markerStart;
  }
  if (pos > positions.markerStart && pos < positions.markerEnd) {
    return positions.markerStart;
  }
  if (pos === positions.markerStart || (pos >= positions.lineFrom && pos < positions.markerStart)) {
    if (positions.lineNumber <= 1) {
      return positions.lineFrom;
    }
    return state.doc.line(positions.lineNumber - 1).to;
  }
  return null;
}

function listPrefixArrowRightTarget(positions: ListPrefixPositions, pos: number): number | null {
  if (pos < positions.markerStart) {
    return positions.markerStart;
  }
  if (pos === positions.markerStart) {
    return positions.markerEnd;
  }
  if (pos > positions.markerStart && pos < positions.markerEnd) {
    return positions.markerEnd;
  }
  if (pos === positions.markerEnd || (pos > positions.markerEnd && pos < positions.prefixEnd)) {
    return positions.prefixEnd;
  }
  return null;
}

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

function buildDecorations(view: EditorView, options: MarkdownLivePreviewOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const listContexts = collectListMetadata(view.state.doc);
  const tableContexts = collectTableMetadata(view.state.doc);
  const codeFenceContexts = collectCodeFenceMetadata(view.state.doc);
  const foldedLines = view.state.field(foldedLinesField);

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

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
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
    decorateInline(line.from, text, cursorPos, inlineDecorations);
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

    if (this.references.backlinks.length > 0) {
      wrap.appendChild(this.renderGroup("Backlinks", this.references.backlinks, "backlinks"));
    }
    if (this.references.references.length > 0) {
      wrap.appendChild(this.renderGroup("References", this.references.references, "reference-links"));
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
    const guideXs = listGuideXs(listContext.depth);
    out.push({
      from: lineFrom,
      to: lineFrom,
      decoration: Decoration.line({
        attributes: {
          class: `exo-md-line ${listContext.isListStart ? "exo-md-line--list-start" : "exo-md-line--list-continuation"}`,
          style: listLineStyle(listContext.depth),
          "data-exo-list-depth": String(listContext.depth),
          "data-exo-guide-xs": guideXs.join(","),
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
          decoration: Decoration.widget({ widget: new ListFoldToggleWidget(listContext.depth, isFolded, lineNumber), side: -1 }),
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

function decorateInline(lineFrom: number, text: string, cursorPos: number, out: DecorationEntry[]) {
  applyDelimited(text, lineFrom, /\*\*(.+?)\*\*/g, 2, boldDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /(?<!\*)\*([^*]+)\*(?!\*)/g, 1, italicDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /~~(.+?)~~/g, 2, strikeDecoration, out, cursorPos);
  applyWikilinks(text, lineFrom, out, cursorPos);
  applyMarkdownLinks(text, lineFrom, out, cursorPos);

  applyDelimited(text, lineFrom, /`([^`\n]+)`/g, 1, codeDecoration, out, cursorPos);
  applyInteractiveMarks(text, lineFrom, /(^|[\s(])#([A-Za-z][\w/-]*)\b/g, out, (match, start) => {
    const offset = match[1] ? match[1].length : 0;
    return [start + offset, start + offset + match[2].length + 1, { "data-exo-tag": match[2] }];
  }, "exo-md-tag");
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
  for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
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
    private readonly lineNumber: number,
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
    fold.dataset.exoFoldLine = String(this.lineNumber);
    span.appendChild(fold);
    return span;
  }

  eq(other: ListFoldToggleWidget) {
    return other.depth === this.depth && other.isFolded === this.isFolded && other.lineNumber === this.lineNumber;
  }

  ignoreEvent(event: Event) {
    return event.type === "mousedown";
  }
}

function indentationColumns(whitespace: string, tabSize = 4) {
  let columns = 0;
  for (const ch of whitespace) {
    if (ch === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      columns += 1;
    }
  }
  return columns;
}

function collectListMetadata(doc: EditorView["state"]["doc"]) {
  const listContexts = new Map<number, ListContext>();
  const stack: Array<{
    indent: number;
    depth: number;
    marker: string;
    ordered: boolean;
  }> = [];

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;
    const isBlank = text.trim().length === 0;
    const leadingWhitespace = text.match(leadingWhitespacePattern);
    const indent = indentationColumns(leadingWhitespace ? leadingWhitespace[1] : "");
    const match = text.match(listPrefixPattern);

    if (isBlank) {
      stack.length = 0;
      continue;
    }

    if (match) {
      while (stack.length > 0 && indent < stack[stack.length - 1].indent) {
        stack.pop();
      }
      if (stack.length > 0 && indent === stack[stack.length - 1].indent) {
        stack.pop();
      }

      const depth = stack.length;
      const marker = match[2] || "-";
      const ordered = /^\d+[.)]$/.test(marker);
      stack.push({
        indent,
        depth,
        marker,
        ordered,
      });

      listContexts.set(lineNumber, {
        depth,
        marker,
        ordered,
        isListStart: true,
        prefixLength: match[0].length,
      });
      continue;
    }

    if (!isBlank) {
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
    }

    if (stack.length > 0) {
      const current = stack[stack.length - 1];
      listContexts.set(lineNumber, {
        depth: current.depth,
        marker: current.marker,
        ordered: current.ordered,
        isListStart: false,
        prefixLength: 0,
      });
    }
  }

  return listContexts;
}

function listLineStyle(depth: number) {
  const guideLayers = listGuideXs(depth).map(
    (x) => `linear-gradient(to bottom, var(--exo-list-guide), var(--exo-list-guide)) ${x}px 0 / 1px 100% no-repeat`,
  );
  const padLeft = LIST_GEOMETRY.baseIndent + depth * LIST_GEOMETRY.indentStep;
  let style = `${listGeometryStyleVariables()};--exo-list-depth:${depth};padding-left:${padLeft}px;`;
  if (guideLayers.length > 0) {
    style += `background:${guideLayers.join(",")};`;
  }
  return style;
}

function listGuideXs(depth: number) {
  const guideXs: number[] = [];
  const guideCount = Math.max(0, depth);

  for (let index = 0; index < guideCount; index += 1) {
    guideXs.push(
      LIST_GEOMETRY.baseIndent +
        index * LIST_GEOMETRY.indentStep -
        LIST_GEOMETRY.markerLaneWidth * 1 +
        LIST_GEOMETRY.guideOffset,
    );
  }

  return guideXs;
}

// ---------------------------------------------------------------------------
// Code fences
// ---------------------------------------------------------------------------

function collectCodeFenceMetadata(doc: EditorView["state"]["doc"]) {
  const contexts = new Map<number, CodeFenceContext>();
  let openFence:
    | {
        startLine: number;
        markerChar: "`" | "~";
        markerLength: number;
        language: string;
      }
    | null = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const text = doc.line(lineNumber).text;

    if (openFence) {
      if (isClosingCodeFence(text, openFence.markerChar, openFence.markerLength)) {
        addCodeFenceContext(contexts, openFence.startLine, lineNumber, openFence.language);
        openFence = null;
      }
      continue;
    }

    const opening = parseOpeningCodeFence(text);
    if (opening) {
      openFence = { startLine: lineNumber, ...opening };
    }
  }

  if (openFence) {
    addCodeFenceContext(contexts, openFence.startLine, doc.lines, openFence.language);
  }

  return contexts;
}

function addCodeFenceContext(contexts: Map<number, CodeFenceContext>, startLine: number, endLine: number, language: string) {
  const context = { startLine, endLine, language };
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    contexts.set(lineNumber, context);
  }
}

function parseOpeningCodeFence(text: string) {
  const match = text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return null;
  }

  const marker = match[2];
  const markerChar = marker[0] as "`" | "~";
  const info = match[3].trim();

  if (markerChar === "`" && info.includes("`")) {
    return null;
  }

  return {
    markerChar,
    markerLength: marker.length,
    language: info.split(/\s+/, 1)[0] ?? "",
  };
}

function isClosingCodeFence(text: string, markerChar: "`" | "~", markerLength: number) {
  const match = text.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
  return Boolean(match && match[2][0] === markerChar && match[2].length >= markerLength);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

type ColumnAlign = "left" | "center" | "right";

interface TableContext {
  /** First line of the table block (the header row), 1-indexed */
  startLine: number;
  /** Last line of the table block (inclusive) */
  endLine: number;
  /** Document offset of the start of the first table line */
  startOffset: number;
  /** Document offset of the end of the last table line */
  endOffset: number;
  /** Header cells, parsed */
  headers: string[];
  /** Body rows (separator excluded), each is an array of cells */
  rows: string[][];
  /** Per-column alignment derived from the separator row */
  alignments: ColumnAlign[];
}

const tableLinePattern = /^\s*\|.*\|\s*$/;
const tableSeparatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function parseTableRow(text: string): string[] {
  const trimmed = text.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseAlignments(separatorText: string): ColumnAlign[] {
  return parseTableRow(separatorText).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function collectTableMetadata(doc: import("@codemirror/state").Text): Map<number, TableContext> {
  const result = new Map<number, TableContext>();
  let i = 1;
  while (i <= doc.lines) {
    const line = doc.line(i);
    const text = line.text;
    if (tableLinePattern.test(text)) {
      // Need at least 2 lines: header + separator
      const next = i + 1 <= doc.lines ? doc.line(i + 1) : null;
      if (next && tableSeparatorPattern.test(next.text)) {
        const startLine = i;
        const startOffset = line.from;
        const headers = parseTableRow(text);
        const alignments = parseAlignments(next.text);
        const rows: string[][] = [];
        let endLine = i + 1;
        let endOffset = next.to;
        // Consume body rows
        let j = i + 2;
        while (j <= doc.lines) {
          const bodyLine = doc.line(j);
          if (!tableLinePattern.test(bodyLine.text)) break;
          rows.push(parseTableRow(bodyLine.text));
          endLine = j;
          endOffset = bodyLine.to;
          j += 1;
        }
        const ctx: TableContext = { startLine, endLine, startOffset, endOffset, headers, rows, alignments };
        for (let ln = startLine; ln <= endLine; ln += 1) {
          result.set(ln, ctx);
        }
        i = endLine + 1;
        continue;
      }
    }
    i += 1;
  }
  return result;
}

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
