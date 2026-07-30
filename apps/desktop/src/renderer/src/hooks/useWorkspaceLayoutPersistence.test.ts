import { describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceSettings, type WorkspaceSettings } from "@exograph/core";

import {
  createWorkspaceCanvasSnapshot,
  decodePersistedWorkspaceCanvas,
  useWorkspaceLayoutPersistence,
} from "./useWorkspaceLayoutPersistence";
import type { PaneNode } from "./usePaneTree";

const effectHarness = vi.hoisted(() => {
  let previousDependencies: readonly unknown[] | undefined;
  let cleanup: void | (() => void);

  return {
    useEffect(
      effect: () => void | (() => void),
      dependencies?: readonly unknown[],
    ) {
      const changed = (
        !previousDependencies
        || !dependencies
        || dependencies.length !== previousDependencies.length
        || dependencies.some((dependency, index) => !Object.is(dependency, previousDependencies?.[index]))
      );
      if (!changed) return;
      cleanup?.();
      previousDependencies = dependencies ? [...dependencies] : undefined;
      cleanup = effect();
    },
    reset() {
      cleanup?.();
      cleanup = undefined;
      previousDependencies = undefined;
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: effectHarness.useEffect,
}));

const editor: PaneNode = {
  kind: "leaf",
  id: "editor",
  content: { kind: "editor", openPaths: ["/notes/a.md"], activePath: "/notes/a.md" },
};

describe("WorkspaceCanvas persistence", () => {
  it("persists a utility-width-only layout change", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    effectHarness.reset();
    try {
      const initialLayout = createWorkspaceCanvasSnapshot({
        canvas: editor,
        sidebarCollapsed: false,
        sidebarWidth: 175,
        utilityWidth: 430,
      });
      const settings = normalizeWorkspaceSettings({
        workspaceRoot: "/workspace",
        defaultTerminalCwd: "/workspace",
        noteRoots: ["/workspace/notes"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });
      expect(settings).not.toBeNull();
      const workspaceSettingsRef = {
        current: {
          ...settings!,
          layout: initialLayout as unknown as WorkspaceSettings["layout"],
        },
      };
      const saveSettingsPatch = vi.fn(async (patch: Partial<WorkspaceSettings>) => {
        workspaceSettingsRef.current = { ...workspaceSettingsRef.current, ...patch };
      });
      const baseOptions: Parameters<typeof useWorkspaceLayoutPersistence>[0] = {
        canvas: editor,
        sidebarCollapsed: false,
        sidebarWidth: 175,
        utilityWidth: 430,
        layoutPersistenceReady: true,
        onboardingActive: false,
        workspaceModel: {} as Parameters<typeof useWorkspaceLayoutPersistence>[0]["workspaceModel"],
        workspaceSettingsRef,
        saveSettingsPatch,
      };

      useWorkspaceLayoutPersistence(baseOptions);
      useWorkspaceLayoutPersistence({ ...baseOptions, utilityWidth: 510 });
      await vi.advanceTimersByTimeAsync(900);

      expect(saveSettingsPatch).toHaveBeenCalledTimes(1);
      expect(saveSettingsPatch).toHaveBeenCalledWith({
        layout: expect.objectContaining({ utilityWidth: 510 }),
      });
    } finally {
      effectHarness.reset();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("writes version three mixed-pane layouts", () => {
    const snapshot = createWorkspaceCanvasSnapshot({ canvas: editor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });
    expect(snapshot).toEqual({ version: 3, canvas: editor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });
    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });

  it("rejects an unsupported persisted canvas version", () => {
    expect(decodePersistedWorkspaceCanvas({ version: 2, canvas: editor })).toBeNull();
    expect(decodePersistedWorkspaceCanvas({ version: 3, editorTree: editor })).toBeNull();
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
        activeFolderReturnPath: "/notes/projects/plan.md",
      },
    };

    const snapshot = createWorkspaceCanvasSnapshot({ canvas: folderEditor, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });

    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });

  it("persists preview placement but drops live terminal placement at app restart", () => {
    const canvas: PaneNode = {
      kind: "split",
      id: "mixed",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        editor,
        { kind: "split", id: "tools", direction: "vertical", ratio: 0.5, children: [
          { kind: "leaf", id: "terminal", content: { kind: "terminal", terminalId: "term-1" } },
          { kind: "leaf", id: "preview", content: { kind: "browser", previewId: "preview-1" } },
        ] },
      ],
    };
    const snapshot = createWorkspaceCanvasSnapshot({ canvas, sidebarCollapsed: false, sidebarWidth: 175, utilityWidth: 430 });

    expect(snapshot.canvas).not.toMatchObject({ content: { kind: "terminal" } });
    expect(JSON.stringify(snapshot.canvas)).toContain("preview-1");
    expect(decodePersistedWorkspaceCanvas(snapshot)).toEqual(snapshot);
  });
});
