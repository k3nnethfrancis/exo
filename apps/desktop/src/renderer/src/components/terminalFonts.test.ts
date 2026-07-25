import { describe, expect, it } from "vitest";

import { TERMINAL_CUSTOM_GLYPHS, TERMINAL_FONT_FAMILY } from "./terminalFonts";

describe("terminal font configuration", () => {
  it("uses font fallback instead of xterm custom glyph drawing for agent TUIs", () => {
    expect(TERMINAL_CUSTOM_GLYPHS).toBe(false);
    expect(TERMINAL_FONT_FAMILY).toContain('"Apple Symbols"');
    expect(TERMINAL_FONT_FAMILY).toContain('"Apple Color Emoji"');
    expect(TERMINAL_FONT_FAMILY).toContain('"Symbols Nerd Font');
    expect(TERMINAL_FONT_FAMILY).toMatch(/^"IBM Plex Mono"/);
  });
});
