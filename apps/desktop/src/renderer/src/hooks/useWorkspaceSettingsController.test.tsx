import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  WorkspaceSettings,
  WorkspaceSettingsSaveRequest,
} from "@exo/core";

import type { WorkspaceSettingsSaveOutcome } from "../../../shared/api";
import { defaultIndexedRoot } from "../workspaceSettingsDialogTypes";
import type { WorkspaceSettingsDialogState } from "../workspaceSettingsDialogTypes";
import {
  indexBusyStateForEvent,
  useWorkspaceSettingsController,
  workspaceSettingsFromDialog,
} from "./useWorkspaceSettingsController";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace settings patch persistence", () => {
  it("applies consecutive local patches in order with the revision returned by each save", async () => {
    let persistedSettings = workspaceSettings();
    let persistedRevision = "revision-0";
    let saveTail = Promise.resolve();
    let appliedSaveCount = 0;
    const firstSaveGate = deferred<void>();
    const saveSettings = vi.fn((request: WorkspaceSettingsSaveRequest) => {
      const result = saveTail.then(async (): Promise<WorkspaceSettingsSaveOutcome> => {
        appliedSaveCount += 1;
        if (appliedSaveCount === 1) {
          await firstSaveGate.promise;
        }
        if (request.expectedRevision !== persistedRevision) {
          throw new Error("workspace-settings-stale");
        }
        persistedSettings = request.settings;
        persistedRevision = `revision-${appliedSaveCount}`;
        return {
          settings: persistedSettings,
          revision: persistedRevision,
          runtimeApply: { status: "applied" },
        };
      });
      saveTail = result.then(() => undefined, () => undefined);
      return result;
    });
    vi.stubGlobal("window", {
      exo: {
        workspace: {
          getSettings: vi.fn(async () => ({ settings: persistedSettings, revision: persistedRevision })),
          saveSettings,
        },
      },
    });
    const settingsRef = { current: persistedSettings };
    const revisionRef = { current: persistedRevision };
    const controllerRef: { current: ReturnType<typeof useWorkspaceSettingsController> | null } = { current: null };

    renderToStaticMarkup(
      <WorkspaceSettingsControllerHarness
        controllerRef={controllerRef}
        options={{
          workspaceSettingsRef: settingsRef,
          workspaceSettingsRevisionRef: revisionRef,
          applyWorkspaceSettings: vi.fn(),
          refreshWorkspaceModel: vi.fn(async () => undefined),
          setIndexStatus: vi.fn(),
        }}
      />,
    );
    const controller = controllerRef.current;
    expect(controller).not.toBeNull();

    const firstPatch = controller!.saveSettingsPatch({ terminalFontSize: 14 });
    const secondPatch = controller!.saveSettingsPatch({ terminalFontSize: 15 });
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    firstSaveGate.resolve();
    await expect(Promise.all([firstPatch, secondPatch])).resolves.toEqual([undefined, undefined]);
    expect(saveSettings.mock.calls.map(([request]) => request.expectedRevision)).toEqual([
      "revision-0",
      "revision-1",
    ]);
    expect(persistedSettings.terminalFontSize).toBe(15);
    expect(settingsRef.current.terminalFontSize).toBe(15);
    expect(revisionRef.current).toBe("revision-2");
  });

  it("publishes a committed runtime failure before saving the queued correction", async () => {
    let persistedSettings = workspaceSettings();
    let persistedRevision = "revision-0";
    let saveCount = 0;
    const saveSettings = vi.fn(async (request: WorkspaceSettingsSaveRequest): Promise<WorkspaceSettingsSaveOutcome> => {
      if (request.expectedRevision !== persistedRevision) {
        throw new Error("workspace-settings-stale");
      }
      saveCount += 1;
      persistedSettings = request.settings;
      persistedRevision = `revision-${saveCount}`;
      return saveCount === 1
        ? {
            settings: persistedSettings,
            revision: persistedRevision,
            runtimeApply: {
              status: "failed",
              errorMessage: "Runtime context is unavailable.",
            },
          }
        : {
            settings: persistedSettings,
            revision: persistedRevision,
            runtimeApply: { status: "applied" },
          };
    });
    vi.stubGlobal("window", {
      exo: {
        workspace: {
          getSettings: vi.fn(async () => ({ settings: persistedSettings, revision: persistedRevision })),
          saveSettings,
        },
      },
    });
    const settingsRef = { current: persistedSettings };
    const revisionRef = { current: persistedRevision };
    const controllerRef: { current: ReturnType<typeof useWorkspaceSettingsController> | null } = { current: null };
    renderToStaticMarkup(
      <WorkspaceSettingsControllerHarness
        controllerRef={controllerRef}
        options={{
          workspaceSettingsRef: settingsRef,
          workspaceSettingsRevisionRef: revisionRef,
          applyWorkspaceSettings: vi.fn(),
          refreshWorkspaceModel: vi.fn(async () => undefined),
          setIndexStatus: vi.fn(),
        }}
      />,
    );
    const controller = controllerRef.current;
    expect(controller).not.toBeNull();

    const failedApply = controller!.saveSettingsPatch({ terminalFontSize: 14 });
    const correction = controller!.saveSettingsPatch({ terminalFontSize: 15 });

    await expect(failedApply).rejects.toThrow("Runtime context is unavailable.");
    await expect(correction).resolves.toBeUndefined();
    expect(saveSettings.mock.calls.map(([request]) => request.expectedRevision)).toEqual([
      "revision-0",
      "revision-1",
    ]);
    expect(settingsRef.current.terminalFontSize).toBe(15);
    expect(revisionRef.current).toBe("revision-2");
  });
});

describe("index activity presentation", () => {
  it("maps identifiable automatic embedding work to the embedding state", () => {
    expect(indexBusyStateForEvent({ state: "running", reason: "automatic-embedding-catch-up" })).toBe("embedding");
    expect(indexBusyStateForEvent({ state: "running", reason: "note-save" })).toBe("updating");
    expect(indexBusyStateForEvent({ state: "running", reason: "settings" }, "embedding")).toBe("embedding");
    expect(indexBusyStateForEvent({ state: "idle", reason: "automatic-embedding-catch-up" }, "embedding")).toBeNull();
  });
});

describe("workspace settings structural persistence", () => {
  it("retains complete existing indexed roots while applying structural settings", () => {
    const root = {
      id: "research-docs",
      label: "Research documents",
      path: "/workspace/notes/research",
      kind: "docs" as const,
      pattern: "**/*.{md,mdx}",
      ignore: ["private/**", "archive/**"],
      backend: "filesystem" as const,
      futureRootOption: { source: "newer-exo" },
    };
    const current = {
      ...workspaceSettings(),
      indexedRoots: [root],
      indexing: { enabled: true, mode: "lexical" as const, backend: "qmd" as const },
      searchEngine: "qmd" as const,
    } as WorkspaceSettings;

    const next = workspaceSettingsFromDialog(
      workspaceSettingsDialog({ indexedRoots: [root] }),
      { includeStructural: true },
      current,
    );

    expect(next.indexedRoots).toEqual([root]);
  });

  it("removes omitted roots and applies defaults only to new paths", () => {
    const retained = {
      id: "research-docs",
      label: "Research documents",
      path: "/workspace/notes/research",
      kind: "docs" as const,
      pattern: "**/*.mdx",
      ignore: ["private/**"],
      backend: "qmd" as const,
    };
    const removed = {
      id: "archive",
      label: "Archive",
      path: "/workspace/notes/archive",
      kind: "notes" as const,
      pattern: "**/*.md",
      ignore: [],
      backend: "qmd" as const,
    };
    const current = {
      ...workspaceSettings(),
      indexedRoots: [retained, removed],
    } as WorkspaceSettings;

    const next = workspaceSettingsFromDialog(
      workspaceSettingsDialog({ indexedRoots: [retained, defaultIndexedRoot("/workspace/notes/new", 1)] }),
      { includeStructural: true },
      current,
    );

    expect(next.indexedRoots).toEqual([
      retained,
      {
        id: "index-root-2",
        label: "new",
        path: "/workspace/notes/new",
        kind: "mixed",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      },
    ]);
  });
});

interface WorkspaceSettingsControllerHarnessProps {
  controllerRef: { current: ReturnType<typeof useWorkspaceSettingsController> | null };
  options: Parameters<typeof useWorkspaceSettingsController>[0];
}

function WorkspaceSettingsControllerHarness(props: WorkspaceSettingsControllerHarnessProps) {
  props.controllerRef.current = useWorkspaceSettingsController(props.options);
  return null;
}

function workspaceSettings(): WorkspaceSettings {
  return {
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: ["/workspace/notes"],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}

function workspaceSettingsDialog(overrides: Partial<WorkspaceSettingsDialogState> = {}): WorkspaceSettingsDialogState {
  return {
    section: "workspace",
    settingsRevision: null,
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: ["/workspace/notes"],
    indexedRoots: [],
    indexMode: "off",
    searchEngine: "filesystem",
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: "15",
    terminalFontSize: "13",
    explorerScale: "1",
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
    agentCommands: [],
    saveStatus: "idle",
    errorMessage: null,
    appliedWorkspaceKey: "",
    applyStatus: "idle",
    applyErrorMessage: null,
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
