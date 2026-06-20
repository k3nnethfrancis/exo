import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(currentDir, "..");

describe("ShellLayout brand icon", () => {
  it("uses the transparent glyph asset instead of the square app icon", () => {
    const shellLayoutSource = readFileSync(resolve(currentDir, "ShellLayout.tsx"), "utf8");

    expect(shellLayoutSource).toContain("../assets/exo-glyph.svg");
    expect(shellLayoutSource).not.toContain("../assets/exo-icon.svg");
  });

  it("keeps the glyph asset monochrome without a square background", () => {
    const glyphSource = readFileSync(resolve(rendererRoot, "assets/exo-glyph.svg"), "utf8");

    expect(glyphSource).toContain("currentColor");
    expect(glyphSource).not.toMatch(/<(rect|polygon)\b/i);
    expect(glyphSource).not.toMatch(/<path[^>]*\bd=["']M0 0/i);
  });
});
