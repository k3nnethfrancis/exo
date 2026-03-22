import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
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
}

interface ListContext {
  depth: number;
  marker: string;
  ordered: boolean;
  isListStart: boolean;
  prefixLength: number;
}

const listPrefixPattern = /^(\s*)((?:[-*+]|\d+[.)]))\s+/;
const leadingWhitespacePattern = /^(\s*)/;

export function markdownLivePreview(options: MarkdownLivePreviewOptions): Extension[] {
  return [
    foldedLinesField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(toggleFoldEffect)))) {
            this.decorations = buildDecorations(update.view);
          }
        }
      },
      {
        decorations: (instance) => instance.decorations,
      },
    ),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!(event.target instanceof HTMLElement)) return false;

        // Checkbox toggle
        const checkbox = event.target.closest<HTMLElement>("[data-exo-checkbox-pos]");
        if (checkbox) {
          const pos = Number(checkbox.dataset.exoCheckboxPos);
          if (!Number.isNaN(pos) && pos >= 0 && pos < view.state.doc.length) {
            const currentChar = view.state.doc.sliceString(pos, pos + 1);
            const newChar = currentChar === " " ? "x" : " ";
            view.dispatch({ changes: { from: pos, to: pos + 1, insert: newChar } });
            event.preventDefault();
            return true;
          }
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

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const listContexts = collectListMetadata(view.state.doc);
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

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const text = line.text;

    if (hiddenLines.has(lineNumber)) {
      lineDecorations.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ class: "exo-md-line--folded-hidden" }),
      });
      continue;
    }

    const hasChildren = linesWithChildren.has(lineNumber);
    const isFolded = foldedLines.has(lineNumber);
    decorateLine(line.from, line.number, text, cursorPos, listContexts, lineDecorations, hasChildren, isFolded);
    decorateInline(line.from, text, cursorPos, inlineDecorations);
  }

  // Line decorations (from === to, point decorations) must come first at each position,
  // then range decorations sorted by from, then by to.
  const all = [...lineDecorations, ...inlineDecorations];
  all.sort((a, b) => a.from - b.from || a.to - b.to);

  for (const entry of all) {
    builder.add(entry.from, entry.to, entry.decoration);
  }

  return builder.finish();
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
          style: listLineStyle(listContext.depth, listContext.isListStart),
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
    const prefixEnd = lineFrom + listContext.prefixLength;
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: "exo-md-line exo-md-line--list" }) });
    if (!cursorWithin(cursorPos, lineFrom, prefixEnd)) {
      out.push({
        from: lineFrom,
        to: prefixEnd,
        decoration: Decoration.replace({ widget: new ListPrefixWidget(listContext.marker, listContext.ordered, listContext.depth, hasChildren, isFolded, lineNumber) }),
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

  if (/^---+$/.test(text) || /^\*\*\*+$/.test(text)) {
    out.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: "exo-md-line exo-md-line--rule" }) });
    if (!cursorWithin(cursorPos, lineFrom, lineFrom + text.length)) {
      out.push({ from: lineFrom, to: lineFrom + text.length, decoration: concealDecoration });
    }
  }
}

function decorateInline(lineFrom: number, text: string, cursorPos: number, out: DecorationEntry[]) {
  applyDelimited(text, lineFrom, /\*\*(.+?)\*\*/g, 2, boldDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /(?<!\*)\*([^*]+)\*(?!\*)/g, 1, italicDecoration, out, cursorPos);
  applyDelimited(text, lineFrom, /~~(.+?)~~/g, 2, strikeDecoration, out, cursorPos);
  applyWikilinks(text, lineFrom, out, cursorPos);
  applyMarkdownLinks(text, lineFrom, out, cursorPos);

  applyInteractiveMarks(text, lineFrom, /`[^`]+`/g, out, (match, start) => [start, start + match[0].length], "exo-md-inline-code");
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
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": target } }) });
    } else {
      out.push({ from: start, to: start + 2, decoration: concealDecoration });
      if (match[2]) {
        out.push({ from: start + 2, to: labelStart, decoration: concealDecoration });
      }
      out.push({ from: labelStart, to: labelEnd, decoration: Decoration.mark({ class: "exo-md-link", attributes: { "data-exo-link-target": target } }) });
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

  ignoreEvent() {
    return false;
  }
}

class ListPrefixWidget extends WidgetType {
  constructor(
    private readonly markerText: string,
    private readonly ordered: boolean,
    private readonly depth: number,
    private readonly hasChildren: boolean,
    private readonly isFolded: boolean,
    private readonly lineNumber: number,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "exo-md-list-prefix";
    const foldWidth = this.hasChildren ? 14 : 0;
    const laneWidth = LIST_GEOMETRY.markerLaneWidth + foldWidth;
    const bulletLeft = LIST_GEOMETRY.baseIndent + this.depth * LIST_GEOMETRY.indentStep - laneWidth;
    span.style.left = `${bulletLeft}px`;
    span.style.width = `${laneWidth}px`;

    if (this.hasChildren) {
      const fold = document.createElement("span");
      fold.className = `exo-md-fold-toggle ${this.isFolded ? "exo-md-fold-toggle--folded" : ""}`;
      fold.dataset.exoFoldLine = String(this.lineNumber);
      span.appendChild(fold);
    }
    const marker = document.createElement("span");
    marker.className = `exo-md-list-bullet ${this.ordered ? "exo-md-list-bullet--ordered" : ""}`;
    marker.textContent = this.ordered ? this.markerText : "•";
    span.appendChild(marker);
    return span;
  }

  eq(other: ListPrefixWidget) {
    return other.markerText === this.markerText && other.ordered === this.ordered && other.depth === this.depth && other.hasChildren === this.hasChildren && other.isFolded === this.isFolded && other.lineNumber === this.lineNumber;
  }

  ignoreEvent() {
    return false;
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

function listLineStyle(depth: number, _isListStart: boolean) {
  const guideLayers = listGuideXs(depth).map(
    (x) => `linear-gradient(to bottom, var(--exo-list-guide), var(--exo-list-guide)) ${x}px 0 / 1px 100% no-repeat`,
  );
  const padLeft = LIST_GEOMETRY.baseIndent + depth * LIST_GEOMETRY.indentStep;
  let style = `${listGeometryStyleVariables()};padding-left:${padLeft}px;`;
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
