import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export interface InlineAgentDraft {
  handle: string;
  message: string;
}

interface ComposerState {
  id: number;
  handle: string;
  position: number;
}

const openComposer = StateEffect.define<ComposerState>();
const closeComposer = StateEffect.define<null>();

const composerState = StateField.define<ComposerState | null>({
  create: () => null,
  update(value, transaction) {
    let next = value
      ? { ...value, position: transaction.changes.mapPos(value.position, 1) }
      : null;
    for (const effect of transaction.effects) {
      if (effect.is(openComposer)) next = effect.value;
      if (effect.is(closeComposer)) next = null;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (composer) => {
    if (!composer) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new InlineAgentComposerWidget(composer),
        block: true,
        side: 1,
      }).range(composer.position),
    ]);
  }),
});

let nextComposerId = 1;

export function openInlineAgentComposer(view: EditorView, input: { from: number; to: number; handle: string }): void {
  view.dispatch({
    changes: { from: input.from, to: input.to, insert: "" },
    effects: openComposer.of({ id: nextComposerId++, handle: input.handle, position: input.from }),
    selection: { anchor: input.from },
    userEvent: "input.complete",
  });
}

export function inlineAgentComposerExtension(options: {
  onSend: (draft: InlineAgentDraft) => void;
}): Extension {
  return [
    composerState,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.target instanceof HTMLElement) || event.target.closest(".inline-agent-composer")) return false;
        if (view.state.field(composerState, false)) view.dispatch({ effects: closeComposer.of(null) });
        return false;
      },
    }),
    EditorView.baseTheme({
      ".inline-agent-composer": { display: "block" },
    }),
    composerCallbackFacet.of(options.onSend),
  ];
}

const composerCallbackFacet = Facet.define<(draft: InlineAgentDraft) => void, (draft: InlineAgentDraft) => void>({
  combine: (callbacks) => callbacks[0] ?? (() => {}),
});

class InlineAgentComposerWidget extends WidgetType {
  constructor(private readonly composer: ComposerState) {
    super();
  }

  eq(other: InlineAgentComposerWidget): boolean {
    return this.composer.id === other.composer.id && this.composer.handle === other.composer.handle;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("section");
    element.className = "inline-agent-composer";
    element.dataset.testid = "inline-agent-composer";

    const label = document.createElement("div");
    label.className = "inline-agent-composer__label";
    label.textContent = `@${this.composer.handle}`;

    const input = document.createElement("textarea");
    input.className = "inline-agent-composer__input";
    input.placeholder = "Message  ·  Shift+Enter to send";
    input.rows = 1;
    input.setAttribute("aria-label", `Message @${this.composer.handle}`);

    const resize = () => {
      input.style.height = "0px";
      input.style.height = `${Math.max(34, input.scrollHeight)}px`;
    };
    input.addEventListener("input", resize);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        view.dispatch({ effects: closeComposer.of(null) });
        view.focus();
        return;
      }
      if (event.key !== "Enter" || !event.shiftKey) return;
      event.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      view.state.facet(composerCallbackFacet)({ handle: this.composer.handle, message });
      view.dispatch({ effects: closeComposer.of(null) });
      view.focus();
    });

    element.append(label, input);
    window.requestAnimationFrame(() => {
      input.focus();
      resize();
    });
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
