import { describe, expect, it } from "vitest";

import { acceptsCanvasPane, acceptsUtilitySurface } from "./useDragManager";

describe("utility surface drops", () => {
  it("accepts a terminal only at the terminal utility destination", () => {
    expect(acceptsUtilitySurface({ kind: "terminal", terminalId: "shell-1" }, "terminal")).toBe(true);
    expect(acceptsUtilitySurface({ kind: "terminal", terminalId: "shell-1" }, "preview")).toBe(false);
  });

  it("accepts a preview only at the Preview utility destination", () => {
    expect(acceptsUtilitySurface({ kind: "preview", previewId: "preview-1" }, "preview")).toBe(true);
    expect(acceptsUtilitySurface({ kind: "preview", previewId: "preview-1" }, "terminal")).toBe(false);
  });

  it("does not turn documents or filesystem paths into utility drops", () => {
    expect(acceptsUtilitySurface({ kind: "document", filePath: "/notes/a.md" }, "terminal")).toBe(false);
    expect(acceptsUtilitySurface({ kind: "workspace-path", path: "/notes/a.md", nodeKind: "file" }, "preview")).toBe(false);
  });
});

describe("canvas pane drops", () => {
  it("lets every movable surface split with every canvas pane kind", () => {
    for (const paneKind of ["editor", "terminal", "browser"] as const) {
      expect(acceptsCanvasPane(paneKind, "workspace", { kind: "document", filePath: "/notes/a.md" })).toBe(true);
      expect(acceptsCanvasPane(paneKind, "workspace", { kind: "terminal", terminalId: "shell-1" })).toBe(true);
      expect(acceptsCanvasPane(paneKind, "workspace", { kind: "preview", previewId: "preview-1" })).toBe(true);
    }
  });

  it("does not make a utility rail a generic canvas target", () => {
    expect(acceptsCanvasPane("terminal", undefined, { kind: "document", filePath: "/notes/a.md" })).toBe(false);
  });
});
