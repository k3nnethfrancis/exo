import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspaceSettingsToEnv,
  exoTmuxServerNameForWorkspace,
  WorkspaceSettingsConflictError,
  WorkspaceSettingsStore,
} from "./settings-store";
import { saveWorkspaceSettings, type WorkspaceSettings, type WorkspaceSettingsSnapshot } from "@exo/core";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("WorkspaceSettingsStore", () => {
  it("rejects a delayed client save carrying a completed revision", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-settings-store-stale-"));
    tempPaths.push(userDataPath);
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const initial = workspaceSettings("/workspace/revision");
    await saveWorkspaceSettings(initial, env);
    const store = new WorkspaceSettingsStore({ userDataPath, env: {} });
    const stale = await store.load() as WorkspaceSettingsSnapshot;
    expect(stale.settings).toMatchObject(initial);
    expect(stale.revision).toMatch(/^[a-f0-9]{64}$/);

    const saved = await store.save({
      settings: { ...stale.settings, appearanceMode: "dark" },
      expectedRevision: stale.revision,
    });
    expect(saved.settings.appearanceMode).toBe("dark");

    const conflict = await store.save({
      settings: { ...stale.settings, terminalFontSize: 18 },
      expectedRevision: stale.revision,
    }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(WorkspaceSettingsConflictError);
    expect(conflict).toMatchObject({
      code: "workspace-settings-stale",
      expectedRevision: stale.revision,
      actualRevision: saved.revision,
    });
    const current = await new WorkspaceSettingsStore({ userDataPath, env: {} }).load() as WorkspaceSettingsSnapshot;
    expect(current.settings).toMatchObject({
      appearanceMode: "dark",
      terminalFontSize: initial.terminalFontSize,
    });
  });

  it("serializes concurrent saves and rejects the second stale revision", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-settings-store-serialized-"));
    tempPaths.push(userDataPath);
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const initial = workspaceSettings("/workspace/serialized");
    await saveWorkspaceSettings(initial, env);
    const firstStore = new WorkspaceSettingsStore({ userDataPath, env: {} });
    const secondStore = new WorkspaceSettingsStore({ userDataPath, env: {} });
    const [firstSnapshot, secondSnapshot] = await Promise.all([firstStore.load(), secondStore.load()]);
    expect(firstSnapshot).not.toBeNull();
    expect(secondSnapshot).not.toBeNull();

    const firstSave = firstStore.save({
      settings: { ...firstSnapshot!.settings, appearanceMode: "dark" },
      expectedRevision: firstSnapshot!.revision,
    });
    const secondSave = secondStore.save({
      settings: { ...secondSnapshot!.settings, terminalFontSize: 18 },
      expectedRevision: secondSnapshot!.revision,
    });

    await expect(firstSave).resolves.toMatchObject({ settings: { appearanceMode: "dark" } });
    await expect(secondSave).rejects.toMatchObject({ code: "workspace-settings-stale" });
    await expect(new WorkspaceSettingsStore({ userDataPath, env: {} }).load()).resolves.toMatchObject({
      settings: {
        appearanceMode: "dark",
        terminalFontSize: initial.terminalFontSize,
      },
    });
  });

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
      settings: {
        workspaceRoot: "/workspace/active",
        noteRoots: ["/workspace/active/notes"],
      },
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
