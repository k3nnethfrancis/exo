import { describe, expect, it } from "vitest";

import { decodePersistedWorkspaceCanvas, createWorkspaceCanvasSnapshot } from "./useWorkspaceLayoutPersistence";
import type { PaneNode } from "./usePaneTree";

const editor: PaneNode = { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" } };
const terminal: PaneNode = { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalIds: ["term-1"], activeTerminalId: "term-1" } };
const preview: PaneNode = { kind: "leaf", id: "preview", content: { kind: "browser", url: "http://localhost:3000" } };

describe("WorkspaceCanvas persistence", () => {
  it.each([
    ["empty", { kind: "leaf", id: "empty", content: { kind: "editor", openPaths: [], activePath: null } } as PaneNode],
    ["note-only", editor],
    ["terminal-only", terminal],
    ["preview", preview],
    ["mixed", { kind: "split", id: "mixed", direction: "horizontal", ratio: 0.5, children: [editor, terminal] } as PaneNode],
  ] as const)("round-trips %s through the canonical canvas shape", (_name, canvas) => {
    const snapshot = createWorkspaceCanvasSnapshot({ canvas, sidebarCollapsed: false, sidebarWidth: 175, inspectorCollapsed: true });
    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });

  it("decodes the old two-zone shape only at restore", () => {
    const restored = decodePersistedWorkspaceCanvas({ version: 0, editorTree: editor, terminalTree: terminal, sidebarCollapsed: true, sidebarWidth: 220, inspectorCollapsed: false });
    expect(restored?.version).toBe(1);
    expect(restored?.canvas.kind).toBe("split");
    expect(restored?.canvas).toMatchObject({ children: [editor, terminal] });
    expect(restored).toMatchObject({ sidebarCollapsed: true, sidebarWidth: 220, inspectorCollapsed: false });
  });
});
