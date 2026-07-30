import { describe, expect, it } from "vitest";

import { applyTheme } from "./applyTheme";
import { resolveTheme } from "./registry";

describe("renderer theme application", () => {
  it("resolves named themes and applies runtime css variables", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        getPropertyValue: (name: string) => properties.get(name) ?? "",
      },
    } as unknown as HTMLElement;
    const theme = resolveTheme("exograph-solar", "dark");

    applyTheme(root, theme);

    expect(root.dataset.colorTheme).toBe("exograph-solar");
    expect(root.style.getPropertyValue("--editor-bg")).toBe("#1f1f1f");
    expect(resolveTheme("unknown-theme", "light").id).toBe("exograph-neutral-light");
  });
});
