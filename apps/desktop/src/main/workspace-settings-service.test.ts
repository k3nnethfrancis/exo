import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDefaultClaudeAgentCommand, type WorkspaceModel, type WorkspaceSettings } from "@exo/core";
import { AgentCommandInvocationService } from "./agent-command-invocation-service";
import type { IndexingService } from "./indexing-service";
import { WorkspaceSettingsStore } from "./settings-store";
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
      currentRevision: vi.fn(() => "revision-before"),
      save: vi.fn(async (request: { settings: WorkspaceSettings }) => ({ settings: request.settings, revision: "revision-after" })),
    } as unknown as WorkspaceSettingsStore;
    const terminalManager = {
      setDefaultCwd: vi.fn(),
      setBufferLineLimit: vi.fn(),
      setTerminalRuntimeOptions: vi.fn(),
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

    await service.saveSettings({ settings: next, expectedRevision: "revision-before" });

    expect(store.save).toHaveBeenCalledWith({ settings: next, expectedRevision: "revision-before" });
    expect(setWorkspaceSetupComplete).toHaveBeenCalledWith(true);
    expect(applyAppearanceMode).toHaveBeenCalledWith(next);
    expect(workspaceModel).toEqual(coreMock.model);
    expect(ensureNoteRoots).toHaveBeenCalledWith(coreMock.model);
    expect(workspaceWatcherService.start).toHaveBeenCalledWith(coreMock.model);
    expect(terminalManager.setDefaultCwd).toHaveBeenCalledWith("/workspace");
    expect(terminalManager.setBufferLineLimit).toHaveBeenCalledWith(1_500);
    expect(indexingService.shouldSyncAfterSettingsApply).toHaveBeenCalledWith(previous, next);
    expect(indexingService.scheduleSync).toHaveBeenCalledWith("settings-apply", 0);
    expect(restartCommandServer).not.toHaveBeenCalled();
  });

  it("returns the committed snapshot when runtime application fails", async () => {
    const previous = workspaceSettings({ appearanceMode: "system" });
    const next = workspaceSettings({ appearanceMode: "dark" });
    let workspaceModel = workspaceModelFromSettings(previous);
    coreMock.model = workspaceModelFromSettings(next);
    let currentSettings: WorkspaceSettings | null = previous;
    const store = {
      fromModel: vi.fn(),
      currentRevision: vi.fn(() => "revision-after"),
      save: vi.fn(async (request: { settings: WorkspaceSettings }) => ({
        settings: request.settings,
        revision: "revision-after",
      })),
    } as unknown as WorkspaceSettingsStore;
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
      setWorkspaceSetupComplete: vi.fn(),
      terminalManager: terminalManagerStub(),
      workspaceWatcherService: { start: vi.fn() } as unknown as WorkspaceWatcherService,
      indexingService: {
        shouldSyncAfterSettingsApply: vi.fn(() => false),
        scheduleSync: vi.fn(),
      } as unknown as IndexingService,
      ensureNoteRoots: vi.fn(async () => {
        throw new Error("Note root is not writable.");
      }),
      restartCommandServer: vi.fn(),
      applyAppearanceMode: vi.fn(),
    });

    await expect(service.saveSettings({
      settings: next,
      expectedRevision: "revision-before",
    })).resolves.toMatchObject({
      settings: next,
      revision: "revision-after",
      runtimeApply: {
        status: "failed",
        errorMessage: "Note root is not writable.",
      },
    });
    expect(currentSettings).toEqual(next);
  });

  it("preserves settings omitted by a focused edit payload", async () => {
    const layout: NonNullable<WorkspaceSettings["layout"]> = {
      editorTree: {
        kind: "leaf",
        id: "editor-primary",
        content: { kind: "editor", openPaths: ["/workspace/notes/home.md"], activePath: "/workspace/notes/home.md" },
      },
      terminalTree: {
        kind: "leaf",
        id: "terminal-primary",
        content: { kind: "terminal", terminalIds: ["terminal-1"], activeTerminalId: "terminal-1" },
      },
      terminalCollapsed: false,
      terminalMonitorMode: false,
      sidePanesFlipped: false,
      zoneSplitRatio: 0.6,
      sidebarCollapsed: false,
      sidebarWidth: 220,
      inspectorCollapsed: true,
    };
    const previous = {
      ...workspaceSettings({
        agentCommands: [{
          id: "codex",
          label: "Codex",
          handle: "codex",
          command: "codex",
          cwdPolicy: "workspace_root",
          promptDelivery: "terminalInputAfterLaunch",
          version: 1,
          enabled: true,
        }],
        layout,
      }),
      futureSettings: { localOnly: true },
    } as WorkspaceSettings & { futureSettings: { localOnly: boolean } };
    const edit = workspaceSettings({ appearanceMode: "dark" });
    let workspaceModel = workspaceModelFromSettings(previous);
    coreMock.model = workspaceModelFromSettings(edit);
    let currentSettings: WorkspaceSettings | null = previous;
    const store = {
      fromModel: vi.fn(),
      currentRevision: vi.fn(() => "revision-before"),
      save: vi.fn(async (request: { settings: WorkspaceSettings }) => ({ settings: request.settings, revision: "revision-after" })),
    } as unknown as WorkspaceSettingsStore;
    const indexingService = {
      shouldSyncAfterSettingsApply: vi.fn(() => false),
      scheduleSync: vi.fn(),
    } as unknown as IndexingService;
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
      setWorkspaceSetupComplete: vi.fn(),
      terminalManager: terminalManagerStub(),
      workspaceWatcherService: { start: vi.fn() } as unknown as WorkspaceWatcherService,
      indexingService,
      ensureNoteRoots: vi.fn(async () => undefined),
      restartCommandServer: vi.fn(),
      applyAppearanceMode: vi.fn(),
    });

    const saved = await service.saveSettings({
      settings: edit,
      expectedRevision: "revision-before",
    });

    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: "revision-before",
      settings: expect.objectContaining({
        appearanceMode: "dark",
        agentCommands: previous.agentCommands,
        layout,
        futureSettings: previous.futureSettings,
      }),
    }));
    expect(saved.settings).toMatchObject({
      appearanceMode: "dark",
      agentCommands: previous.agentCommands,
      layout,
      futureSettings: previous.futureSettings,
    });
  });

  it("keeps a seeded Agent Command launchable after a Settings round trip", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-settings-command-workspace-"));
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-settings-command-user-data-"));
    const store = new WorkspaceSettingsStore({ userDataPath, env: {} });
    const seeded = workspaceSettings({
      workspaceRoot,
      defaultTerminalCwd: workspaceRoot,
      noteRoots: [workspaceRoot],
      projectRoots: [],
      agentCommands: [createDefaultClaudeAgentCommand()],
    });

    try {
      const seededSnapshot = await store.save({ settings: seeded, expectedRevision: null });
      const loadedSnapshot = await store.load();
      expect(loadedSnapshot).not.toBeNull();
      let currentSettings = loadedSnapshot!.settings;
      const edit = workspaceSettings({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [workspaceRoot],
        projectRoots: [],
        appearanceMode: "dark",
      });
      let workspaceModel = workspaceModelFromSettings(seeded);
      coreMock.model = workspaceModelFromSettings(edit);
      const settingsService = new WorkspaceSettingsService({
        store,
        getWorkspaceModel: () => workspaceModel,
        setWorkspaceModel: (model) => {
          workspaceModel = model;
        },
        getWorkspaceSettings: () => currentSettings,
        setWorkspaceSettings: (settings) => {
          currentSettings = settings;
        },
        setWorkspaceSetupComplete: vi.fn(),
        terminalManager: terminalManagerStub(),
        workspaceWatcherService: { start: vi.fn() } as unknown as WorkspaceWatcherService,
        indexingService: {
          shouldSyncAfterSettingsApply: vi.fn(() => false),
          scheduleSync: vi.fn(),
        } as unknown as IndexingService,
        ensureNoteRoots: vi.fn(async () => undefined),
        restartCommandServer: vi.fn(),
        applyAppearanceMode: vi.fn(),
      });

      await settingsService.saveSettings({
        settings: edit,
        expectedRevision: seededSnapshot.revision,
      });
      const reloaded = await store.load();
      expect(reloaded).not.toBeNull();
      const terminalManager = launchTerminalManager();
      const invocationService = new AgentCommandInvocationService({
        getWorkspaceSettings: () => reloaded!.settings,
        trustStateRoot: userDataPath,
        terminalManager,
      });

      await expect(invocationService.launchNoteInvocation({
        handle: "@claude",
        documentPath: path.join(workspaceRoot, "note.md"),
        mentionText: "@claude summarize this",
        message: "summarize this",
        allowUntrustedOneShot: true,
      })).resolves.toMatchObject({
        ok: true,
        invocation: {
          command: { handle: "claude" },
          message: "summarize this",
        },
      });
      expect(terminalManager.createAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ handle: "claude" }),
        workspaceRoot,
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

});

function terminalManagerStub(): TerminalManager {
  return {
    setDefaultCwd: vi.fn(),
    setBufferLineLimit: vi.fn(),
    setTerminalRuntimeOptions: vi.fn(),
  } as unknown as TerminalManager;
}

function launchTerminalManager(): TerminalManager & { createAgentCommand: ReturnType<typeof vi.fn> } {
  return {
    createAgentCommand: vi.fn(async (command, cwd) => ({
      id: "terminal-command",
      terminalKind: "shell",
      harnessId: null,
      kind: "shell",
      title: command.label,
      cwd,
      command: command.command,
      status: "running",
      transcriptPath: null,
      attachGeneration: 1,
    })),
    sendMessage: vi.fn(async () => ({ ok: true, delivery: "sent" })),
  } as unknown as TerminalManager & { createAgentCommand: ReturnType<typeof vi.fn> };
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
