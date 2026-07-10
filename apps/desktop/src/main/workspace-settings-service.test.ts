import { describe, expect, it, vi } from "vitest";

import type { WorkspaceModel, WorkspaceSettings } from "@exo/core";
import type { IndexingService } from "./indexing-service";
import type { WorkspaceSettingsStore } from "./settings-store";
import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceWatcherService } from "./workspace-watchers";
import { WorkspaceSettingsService } from "./workspace-settings-service";

const coreMock = vi.hoisted(() => ({
  runtimeRoot: "/runtime",
  model: null as WorkspaceModel | null,
}));

vi.mock("@exo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@exo/core")>();
  return {
    ...actual,
    resolveRuntimeConfig: () => ({ runtimeRoot: coreMock.runtimeRoot }),
    resolveWorkspaceModel: () => {
      if (!coreMock.model) {
        throw new Error("Missing mocked workspace model.");
      }
      return coreMock.model;
    },
  };
});

describe("WorkspaceSettingsService", () => {
  it("applies saved settings across workspace, terminal, watcher, and indexing services", async () => {
    const previous = workspaceSettings({ projectRoots: ["/workspace/old"], terminalHistoryLines: 500 });
    const next = workspaceSettings({
      projectRoots: ["/workspace/new"],
      terminalHistoryLines: 1_500,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 3,
    });
    let workspaceModel = workspaceModelFromSettings(previous);
    coreMock.model = workspaceModelFromSettings(next);
    let currentSettings: WorkspaceSettings | null = previous;
    const store = {
      fromModel: vi.fn((model: WorkspaceModel) => workspaceSettings({ workspaceRoot: model.workspaceRoot })),
      save: vi.fn(async (settings: WorkspaceSettings) => settings),
    } as unknown as WorkspaceSettingsStore;
    const terminalManager = {
      setRuntimeConfig: vi.fn(),
      setDefaultCwd: vi.fn(),
      setBufferLineLimit: vi.fn(),
      setTranscriptRetentionDays: vi.fn(),
      setTerminalRuntimeOptions: vi.fn(),
      syncRuntimeContext: vi.fn(async () => undefined),
    } as unknown as TerminalManager;
    const workspaceWatcherService = { start: vi.fn() } as unknown as WorkspaceWatcherService;
    const indexingService = {
      shouldSyncAfterSettingsApply: vi.fn(() => true),
      scheduleSync: vi.fn(),
    } as unknown as IndexingService;
    const setWorkspaceSetupComplete = vi.fn();
    const applyAppearanceMode = vi.fn();
    const ensureNoteRoots = vi.fn(async () => undefined);
    const restartCommandServer = vi.fn();
    const service = new WorkspaceSettingsService({
      store,
      getWorkspaceModel: () => workspaceModel,
      setWorkspaceModel: (model) => {
        workspaceModel = model;
      },
      getWorkspaceSettings: () => currentSettings,
      setWorkspaceSettings: (settings) => {
        currentSettings = settings;
      },
      setWorkspaceSetupComplete,
      terminalManager,
      workspaceWatcherService,
      indexingService,
      ensureNoteRoots,
      restartCommandServer,
      applyAppearanceMode,
    });

    await service.saveSettings(next);

    expect(store.save).toHaveBeenCalledWith(next);
    expect(setWorkspaceSetupComplete).toHaveBeenCalledWith(true);
    expect(applyAppearanceMode).toHaveBeenCalledWith(next);
    expect(workspaceModel).toEqual(coreMock.model);
    expect(ensureNoteRoots).toHaveBeenCalledWith(coreMock.model);
    expect(workspaceWatcherService.start).toHaveBeenCalledWith(coreMock.model);
    expect(terminalManager.setRuntimeConfig).toHaveBeenCalledWith({ runtimeRoot: "/runtime" });
    expect(terminalManager.setDefaultCwd).toHaveBeenCalledWith("/workspace");
    expect(terminalManager.setBufferLineLimit).toHaveBeenCalledWith(1_500);
    expect(terminalManager.setTranscriptRetentionDays).toHaveBeenCalledWith(3);
    expect(terminalManager.syncRuntimeContext).toHaveBeenCalledOnce();
    expect(indexingService.shouldSyncAfterSettingsApply).toHaveBeenCalledWith(previous, next);
    expect(indexingService.scheduleSync).toHaveBeenCalledWith("settings-apply", 0);
    expect(restartCommandServer).not.toHaveBeenCalled();
  });

});

function terminalManagerStub(): TerminalManager {
  return {
    setRuntimeConfig: vi.fn(),
    setDefaultCwd: vi.fn(),
    setBufferLineLimit: vi.fn(),
    setTranscriptRetentionDays: vi.fn(),
    setTerminalRuntimeOptions: vi.fn(),
    syncRuntimeContext: vi.fn(async () => undefined),
  } as unknown as TerminalManager;
}

function workspaceModelFromSettings(settings: WorkspaceSettings): WorkspaceModel {
  return {
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots.map((root, index) => ({ id: `note-${index + 1}`, label: `note-${index + 1}`, path: root, kind: "notes" })),
    projectRoots: settings.projectRoots.map((root, index) => ({ id: `project-${index + 1}`, label: `project-${index + 1}`, path: root, kind: "projects" })),
    indexedRoots: settings.indexedRoots,
    indexing: settings.indexing,
    attachedWorkcells: [],
  };
}

function workspaceSettings(overrides: Partial<WorkspaceSettings> = {}): WorkspaceSettings {
  return {
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: ["/workspace/notes"],
    projectRoots: ["/workspace/project"],
    indexedRoots: [
      {
        id: "index-notes",
        label: "notes",
        path: "/workspace/notes",
        kind: "notes",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      },
    ],
    indexing: { enabled: true, mode: "lexical", backend: "qmd" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryLines: 1_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: true,
    indexUpdateStrategy: "on-save",
    ...overrides,
  };
}
