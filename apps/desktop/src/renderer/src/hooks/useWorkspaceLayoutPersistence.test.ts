import { describe, expect, it } from "vitest";

import { createWorkspaceCanvasSnapshot, decodePersistedWorkspaceCanvas } from "./useWorkspaceLayoutPersistence";
import type { PaneNode } from "./usePaneTree";

const editor: PaneNode = {
  kind: "leaf",
  id: "editor",
  content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" },
};

describe("WorkspaceCanvas persistence", () => {
  it("writes version two editor-only layouts", () => {
    const snapshot = createWorkspaceCanvasSnapshot({ canvas: editor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });
    expect(snapshot).toEqual({ version: 2, canvas: editor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });
    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });

  it("removes legacy terminal and preview leaves while preserving editor splits", () => {
    const restored = decodePersistedWorkspaceCanvas({
      version: 1,
      canvas: {
        kind: "split",
        id: "old-shell",
        direction: "horizontal",
        ratio: 0.62,
        children: [
          editor,
          {
            kind: "split",
            id: "old-utility",
            direction: "vertical",
            ratio: 0.5,
            children: [
              { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalIds: ["term-1"], activeTerminalId: "term-1" } },
              { kind: "leaf", id: "preview", content: { kind: "browser", url: "http://localhost:3000" } },
            ],
          },
        ],
      },
      sidebarCollapsed: true,
      sidebarWidth: 220,
      utilityWidth: 510,
    });

    expect(restored).toEqual({ version: 2, canvas: editor, sidebarCollapsed: true, sidebarWidth: 220, utilityWidth: 510 });
  });

  it("does not revive a separate legacy terminal tree", () => {
    const restored = decodePersistedWorkspaceCanvas({
      version: 0,
      editorTree: editor,
      terminalTree: { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalIds: ["term-1"], activeTerminalId: "term-1" } },
    });

    expect(restored?.canvas).toEqual(editor);
  });

  it("preserves an open Folder Overview alongside ordinary note tabs", () => {
    const folderEditor: PaneNode = {
      kind: "leaf",
      id: "editor",
      content: {
        kind: "editor",
        openPaths: ["/notes/projects/plan.md"],
        activePath: null,
        openFolderPaths: ["/notes/projects"],
        activeFolderPath: "/notes/projects",
      },
    };

    const snapshot = createWorkspaceCanvasSnapshot({ canvas: folderEditor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });

    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });
});
