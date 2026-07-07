import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyWorkspaceSettingsToEnv, exoTmuxServerNameForWorkspace, WorkspaceSettingsStore } from "./settings-store";
import type { WorkspaceSettings } from "@exo/core";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("WorkspaceSettingsStore", () => {
  it("loads the active workspace from the registry when direct settings are absent", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-settings-store-"));
    tempPaths.push(userDataPath);
    const activeSettings = workspaceSettings("/workspace/active");
    const inactiveSettings = workspaceSettings("/workspace/inactive");
    await writeFile(
      path.join(userDataPath, "workspace-registry.json"),
      JSON.stringify({
        activeWorkspaceId: "active",
        workspaces: [
          {
            id: "inactive",
            label: "inactive",
            notesFolder: inactiveSettings.noteRoots[0],
            settings: inactiveSettings,
            updatedAt: "2026-06-14T00:00:00.000Z",
          },
          {
            id: "active",
            label: "active",
            notesFolder: activeSettings.noteRoots[0],
            settings: activeSettings,
            updatedAt: "2026-06-14T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await expect(new WorkspaceSettingsStore({ userDataPath, env: {} }).load()).resolves.toMatchObject({
      workspaceRoot: "/workspace/active",
      noteRoots: ["/workspace/active/notes"],
    });
  });

  it("assigns an Exo-owned tmux server namespace for the active workspace", () => {
    const env: NodeJS.ProcessEnv = {};
    const settings = workspaceSettings("/workspace/active");

    applyWorkspaceSettingsToEnv(settings, env);

    expect(env.EXO_TMUX_SERVER_NAME).toBe(exoTmuxServerNameForWorkspace("/workspace/active"));
    expect(env.EXO_TMUX_SERVER_NAME).toMatch(/^exo-[a-f0-9]{10}$/);
  });
});

function workspaceSettings(workspaceRoot: string): WorkspaceSettings {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [path.join(workspaceRoot, "notes")],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryLines: 1_000_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
