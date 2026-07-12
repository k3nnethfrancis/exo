import { Facet, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";

export interface InlineAgentDraft {
  handle: string;
  message: string;
}

interface ComposerState {
  id: number;
  handle: string;
  from: number;
  messageFrom: number;
  to: number;
}

const openComposer = StateEffect.define<ComposerState>();
const closeComposer = StateEffect.define<null>();

const composerState = StateField.define<ComposerState | null>({
  create: () => null,
  update(value, transaction) {
    let next = value
      ? {
          ...value,
          from: transaction.changes.mapPos(value.from, 1),
          messageFrom: transaction.changes.mapPos(value.messageFrom, 1),
          to: transaction.changes.mapPos(value.to, 1),
        }
      : null;

    if (next && transaction.docChanged) {
      const before = transaction.startState.selection.main;
      const after = transaction.state.selection.main;
      // The agent request is ordinary document text. Extend its live range only
      // while the user is typing at its active end; edits elsewhere do not turn
      // unrelated prose into the request.
      if (before.empty && before.head >= next.messageFrom && before.head <= next.to && after.empty) {
        next = { ...next, to: after.head };
      }
    }

    for (const effect of transaction.effects) {
      if (effect.is(openComposer)) next = effect.value;
      if (effect.is(closeComposer)) next = null;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (composer) => {
    if (!composer) return Decoration.none;
    return Decoration.set([
      Decoration.mark({
        class: `inline-agent-composer__mark inline-agent-composer__mark--${agentPresentation(composer.handle)}`,
      }).range(composer.from, composer.to),
      Decoration.mark({
        class: `inline-agent-composer__mention inline-agent-composer__mention--${agentPresentation(composer.handle)}`,
      }).range(composer.from, composer.messageFrom),
      Decoration.widget({
        widget: new InlineAgentAffordanceWidget(composer),
        side: 1,
      }).range(composer.to),
    ]);
  }),
});

let nextComposerId = 1;

export function openInlineAgentComposer(view: EditorView, input: { from: number; to: number; handle: string }): void {
  const mention = `@${input.handle}`;
  const inserted = `${mention} `;
  const id = nextComposerId++;
  const messageFrom = input.from + mention.length;
  view.dispatch({
    changes: { from: input.from, to: input.to, insert: inserted },
    effects: openComposer.of({ id, handle: input.handle, from: input.from, messageFrom, to: input.from + inserted.length }),
    selection: { anchor: input.from + inserted.length },
    userEvent: "input.complete",
  });
  view.focus();
}

export function inlineAgentComposerExtension(options: {
  onSend: (draft: InlineAgentDraft) => void;
}): Extension {
  return [
    composerState,
    composerCallbackFacet.of(options.onSend),
    Prec.highest(keymap.of([
      { key: "Shift-Enter", run: sendInlineAgentComposer },
      { key: "Escape", run: closeInlineAgentComposer },
    ])),
  ];
}

const composerCallbackFacet = Facet.define<(draft: InlineAgentDraft) => void, (draft: InlineAgentDraft) => void>({
  combine: (callbacks) => callbacks[0] ?? (() => {}),
});

function sendInlineAgentComposer(view: EditorView): boolean {
  const composer = view.state.field(composerState, false);
  if (!composer) return false;
  const message = view.state.sliceDoc(composer.messageFrom, composer.to).trim();
  if (!message) return true;
  view.state.facet(composerCallbackFacet)({ handle: composer.handle, message });
  view.dispatch({ effects: closeComposer.of(null), userEvent: "input.complete" });
  return true;
}

function closeInlineAgentComposer(view: EditorView): boolean {
  if (!view.state.field(composerState, false)) return false;
  view.dispatch({ effects: closeComposer.of(null), userEvent: "input.complete" });
  return true;
}

class InlineAgentAffordanceWidget extends WidgetType {
  constructor(private readonly composer: ComposerState) {
    super();
  }

  eq(other: InlineAgentAffordanceWidget): boolean {
    return this.composer.id === other.composer.id && this.composer.to === other.composer.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const anchor = document.createElement("span");
    anchor.className = `inline-agent-composer__affordance inline-agent-composer__affordance--${agentPresentation(this.composer.handle)}`;
    anchor.dataset.testid = "inline-agent-composer";

    const hint = document.createElement("span");
    hint.className = "inline-agent-composer__hint";
    hint.textContent = "Shift + Return to send";

    const button = document.createElement("button");
    button.className = "inline-agent-composer__send";
    button.type = "button";
    button.setAttribute("aria-label", `Send message to @${this.composer.handle}`);
    button.append(createAgentIcon(agentPresentation(this.composer.handle)));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      sendInlineAgentComposer(view);
      view.focus();
    });

    anchor.append(hint, button);
    return anchor;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function agentPresentation(handle: string): "claude" | "codex" | "default" {
  return handle === "claude" || handle === "codex" ? handle : "default";
}

function createAgentIcon(kind: ReturnType<typeof agentPresentation>): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", kind === "claude"
    ? "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
    : "M4.25 4.75h15.5v14.5H4.25zM8 9.5h8M8 13h5");
  svg.append(path);
  return svg;
}
