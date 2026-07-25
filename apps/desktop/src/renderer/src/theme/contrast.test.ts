import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { THEME_FAMILIES } from "./registry";

describe("renderer theme contrast", () => {
  it("keeps core text, syntax, and terminal foreground pairs above AA contrast", () => {
    for (const family of THEME_FAMILIES) {
      for (const theme of Object.values(family.variants)) {
        if (!theme) {
          continue;
        }
        const editorBg = theme.css["--editor-bg"];
        const terminalBg = theme.terminal.background;

        expect(contrastRatio(theme.css["--text-primary"], editorBg), theme.id).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme.terminal.foreground, terminalBg), theme.id).toBeGreaterThanOrEqual(4.5);
        for (const [slot, color] of Object.entries(theme.syntax)) {
          expect(contrastRatio(color, editorBg), `${theme.id} syntax ${slot}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
