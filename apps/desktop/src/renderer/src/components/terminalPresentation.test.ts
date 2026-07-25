import { describe, expect, it } from "vitest";

import { normalizeTerminalPresentation } from "./terminalPresentation";

describe("terminal presentation normalization", () => {
  it("asks Claude action markers to render as text without changing other emoji", () => {
    expect(normalizeTerminalPresentation("⏺ Hey 🙂")).toBe("⏺︎ Hey 🙂");
  });

  it("does not duplicate explicit text or emoji presentation selectors", () => {
    expect(normalizeTerminalPresentation("⏺︎ text ⏺️ emoji")).toBe("⏺︎ text ⏺️ emoji");
  });
});
