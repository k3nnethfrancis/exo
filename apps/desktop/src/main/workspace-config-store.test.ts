import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveWorkspaceSettings, type WorkspaceSettings } from "@exo/core";
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
});

function settings(): WorkspaceSettings {
  return { workspaceRoot: "/workspace", defaultTerminalCwd: "/workspace", noteRoots: ["/workspace/notes"], projectRoots: [], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" }, appearanceMode: "system", colorThemeId: "exo-neutral", editorFontSize: 15, terminalFontSize: 13, terminalHistoryLines: 1000, terminalTranscriptRetention: "forever", terminalTranscriptRetentionDays: 14, explorerScale: 1, exploreIndexSearchOnEnter: false, indexUpdateStrategy: "on-save" };
}
