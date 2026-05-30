import { describe, expect, it, vi } from "vitest";

import type { WorkspaceModel, WorkspaceSettings } from "@exo/core";
import { IndexingService } from "./indexing-service";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "home") return "/Users/tester";
      if (name === "desktop") return "/Users/tester/Desktop";
      if (name === "documents") return "/Users/tester/Documents";
      return "/tmp/exo-test";
    },
  },
}));

describe("IndexingService", () => {
  it("detects settings changes that require a full sync", () => {
    const settings = workspaceSettings();
    const service = indexingService(settings);

    expect(service.shouldSyncAfterSettingsApply(settings, settings)).toBe(false);
    expect(service.shouldSyncAfterSettingsApply(settings, {
      ...settings,
      indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
    })).toBe(true);
    expect(service.shouldSyncAfterSettingsApply(settings, {
      ...settings,
      indexedRoots: [{ ...settings.indexedRoots[0], path: "/workspace/notes/other" }],
    })).toBe(true);
    expect(service.shouldSyncAfterSettingsApply(settings, {
      ...settings,
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      indexedRoots: [],
    })).toBe(false);
  });

  it("saves specific indexed roots and refuses broad system roots by default", async () => {
    const settings = workspaceSettings();
    let savedSettings: WorkspaceSettings | null = null;
    const service = indexingService(settings, (nextSettings) => {
      savedSettings = nextSettings;
      return Promise.resolve(nextSettings);
    });

    await expect(service.addRoot({ path: "/Users/tester" })).rejects.toThrow("Refusing to index");
    await expect(service.addRoot({ path: "/workspace/notes/research", name: "research", kind: "notes" })).resolves.toMatchObject({
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
    });

    const savedSnapshot = savedSettings as WorkspaceSettings | null;
    expect(savedSnapshot?.indexedRoots).toHaveLength(2);
    expect(savedSnapshot?.indexedRoots.at(-1)).toMatchObject({
      id: "index-research",
      label: "research",
      path: "/workspace/notes/research",
      kind: "notes",
    });
  });
});

function indexingService(
  settings: WorkspaceSettings,
  saveWorkspaceSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings> = async (nextSettings) => nextSettings,
) {
  const model: WorkspaceModel = {
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots.map((root, index) => ({ id: `note-${index + 1}`, label: `note-${index + 1}`, path: root, kind: "notes" })),
    projectRoots: settings.projectRoots.map((root, index) => ({ id: `project-${index + 1}`, label: `project-${index + 1}`, path: root, kind: "projects" })),
    indexedRoots: settings.indexedRoots,
    indexing: settings.indexing,
    attachedWorkcells: [],
  };
  return new IndexingService({
    getWorkspaceModel: () => model,
    getCurrentSettings: () => settings,
    getRuntimeRoot: () => "/workspace/.exo",
    saveWorkspaceSettings,
    sendState: () => {},
    errorMessage: (error) => error instanceof Error ? error.message : String(error),
  });
}

function workspaceSettings(): WorkspaceSettings {
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
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryMode: "full",
    terminalHistoryLines: 1_000_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: true,
    indexUpdateStrategy: "on-save",
  };
}
