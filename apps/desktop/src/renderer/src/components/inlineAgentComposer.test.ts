import { describe, expect, it } from "vitest";

import { InlineAgentAffordanceWidget, type ComposerState } from "./inlineAgentComposer";

function composer(overrides: Partial<ComposerState> = {}): ComposerState {
  return {
    id: 1,
    handle: "claude",
    from: 0,
    messageFrom: 7,
    to: 8,
    ...overrides,
  };
}

describe("inline agent affordance", () => {
  it("keeps the same DOM widget while the active request grows", () => {
    const before = new InlineAgentAffordanceWidget(composer());
    const afterTyping = new InlineAgentAffordanceWidget(composer({ to: 42 }));

    expect(before.eq(afterTyping)).toBe(true);
  });

  it("replaces the widget when its rendered agent identity changes", () => {
    const claude = new InlineAgentAffordanceWidget(composer());
    const codex = new InlineAgentAffordanceWidget(composer({ handle: "codex" }));

    expect(claude.eq(codex)).toBe(false);
  });
});
