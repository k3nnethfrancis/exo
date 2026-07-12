import { describe, expect, it } from "vitest";

import { acceptsUtilitySurface } from "./useDragManager";

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
