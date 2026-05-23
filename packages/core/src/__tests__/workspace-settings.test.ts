import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  listWorkspaceRegistryEntries,
  loadActiveWorkspaceSettings,
  saveWorkspaceSettings,
  workspaceEnvOverrides,
  workspaceSettingsToEnv,
} from "../workspace-settings";

describe("workspace settings registry", () => {
  it("persists and reloads the active desktop workspace", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-registry-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };

    try {
      const saved = await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo/notes-alpha",
        defaultTerminalCwd: "/tmp/exo/project-alpha",
        noteRoots: ["/tmp/exo/notes-alpha"],
        projectRoots: ["/tmp/exo/project-alpha"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryMode: "full",
        terminalHistoryLines: 1_000_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        terminalStreamingMode: "visible",
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, env);

      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({
        workspaceRoot: "/tmp/exo/notes-alpha",
        defaultTerminalCwd: "/tmp/exo/project-alpha",
      });
      await expect(listWorkspaceRegistryEntries(env)).resolves.toHaveLength(1);
      expect(workspaceSettingsToEnv(saved)).toMatchObject({
        EXO_WORKSPACE_ROOT: "/tmp/exo/notes-alpha",
        EXO_DEFAULT_TERMINAL_CWD: "/tmp/exo/project-alpha",
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("treats explicit workspace env as an override", () => {
    expect(workspaceEnvOverrides({ EXO_WORKSPACE_ROOT: "/tmp/manual" })).toBe(true);
    expect(workspaceEnvOverrides({})).toBe(false);
  });
});
