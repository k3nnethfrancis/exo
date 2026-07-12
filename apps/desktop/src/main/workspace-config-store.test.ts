import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceRegistryPath, resolveWorkspaceSettingsPath, saveWorkspaceSettings, type WorkspaceSettings } from "@exo/core";
import { WorkspaceConfigConflictError, WorkspaceConfigStore } from "./workspace-config-store";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((target) => rm(target, { recursive: true, force: true }))));

describe("WorkspaceConfigStore", () => {
  it("owns serialized revision-checked patches while preserving unknown settings", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-config-"));
    paths.push(userDataPath);
    await saveWorkspaceSettings({ ...settings(), futureSetting: { local: true } } as WorkspaceSettings, { EXO_USER_DATA_PATH: userDataPath });
    const first = new WorkspaceConfigStore({ userDataPath, env: {} });
    const second = new WorkspaceConfigStore({ userDataPath, env: {} });
    const loaded = await first.load();
    const saved = await first.patch(loaded!.revision, { appearanceMode: "dark" });
    await expect(second.patch(loaded!.revision, { terminalFontSize: 18 })).rejects.toBeInstanceOf(WorkspaceConfigConflictError);
    expect(saved.settings).toMatchObject({ appearanceMode: "dark", futureSetting: { local: true } });
  });

  it("logs retired project-root normalization once and persists the stripped model", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-config-migration-"));
    paths.push(userDataPath);
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const legacy = { ...settings(), projectRoots: ["/legacy/project"], futureSetting: { preserved: true } };
    const registry = { activeWorkspaceId: "legacy", workspaces: [{ id: "legacy", label: "legacy", notesFolder: "/workspace/notes", settings: legacy, updatedAt: "2026-07-12T00:00:00.000Z" }] };
    await mkdir(userDataPath, { recursive: true });
    await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(legacy));
    await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify(registry));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const store = new WorkspaceConfigStore({ userDataPath, env: {} });
      await store.load();
      await store.load();

      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith("[exo] normalized retired project roots", { droppedProjectRoots: ["/legacy/project"] });
      expect(JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8"))).not.toHaveProperty("projectRoots");
    } finally {
      info.mockRestore();
    }
  });
});

function settings(): WorkspaceSettings {
  return { workspaceRoot: "/workspace", defaultTerminalCwd: "/workspace", noteRoots: ["/workspace/notes"], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" }, appearanceMode: "system", colorThemeId: "exo-neutral", editorFontSize: 15, terminalFontSize: 13, terminalHistoryLines: 1000, terminalTranscriptRetention: "forever", terminalTranscriptRetentionDays: 14, explorerScale: 1, exploreIndexSearchOnEnter: false, indexUpdateStrategy: "on-save" };
}
