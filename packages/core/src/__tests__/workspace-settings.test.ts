import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadWorkspaceSettings,
  listWorkspaceRegistryEntries,
  loadActiveWorkspaceSettings,
  normalizeWorkspaceSettings,
  saveWorkspaceSettings,
  workspaceEnvOverrides,
  workspaceSettingsToEnv,
} from "../workspace-settings";

describe("workspace settings registry", () => {
  it("defaults missing color theme ids and normalizes unknown ids", () => {
    const missing = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-theme/notes",
      defaultTerminalCwd: "/tmp/exo-theme/project",
      noteRoots: ["/tmp/exo-theme/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });
    const unknown = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-theme/notes",
      defaultTerminalCwd: "/tmp/exo-theme/project",
      noteRoots: ["/tmp/exo-theme/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      colorThemeId: "unknown-theme" as never,
    });

    expect(missing?.colorThemeId).toBe("exo-neutral");
    expect(unknown?.colorThemeId).toBe("exo-neutral");
  });

  it("persists selected color theme ids", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-theme-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };

    try {
      await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-theme/notes",
        defaultTerminalCwd: "/tmp/exo-theme/project",
        noteRoots: ["/tmp/exo-theme/notes"],
        projectRoots: ["/tmp/exo-theme/project"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "dark",
        colorThemeId: "exo-solar",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryLines: 100_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, env);

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({
        appearanceMode: "dark",
        colorThemeId: "exo-solar",
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("normalizes persisted pane layout settings", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-layout-"));

    try {
      const saved = await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-layout/notes",
        defaultTerminalCwd: "/tmp/exo-layout/project",
        noteRoots: ["/tmp/exo-layout/notes"],
        projectRoots: ["/tmp/exo-layout/project"],
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
        layout: {
          editorTree: {
            kind: "split",
            id: "editor-split",
            direction: "horizontal",
            ratio: 0.9,
            children: [
              { kind: "leaf", id: "editor-a", content: { kind: "editor", openPaths: ["/tmp/exo-layout/notes/a.md"], activePath: "/tmp/exo-layout/notes/a.md" } },
              { kind: "leaf", id: "editor-b", content: { kind: "browser", url: "localhost:3000" } },
            ],
          },
          terminalTree: {
            kind: "leaf",
            id: "terminal-a",
            content: { kind: "terminal", terminalIds: ["term-2"], activeTerminalId: "missing" },
          },
          terminalCollapsed: true,
          sidePanesFlipped: true,
          zoneSplitRatio: 0.01,
          sidebarCollapsed: true,
          sidebarWidth: 9999,
          inspectorCollapsed: false,
        },
      }, { EXO_USER_DATA_PATH: userDataPath });

      expect(saved.layout).toMatchObject({
        terminalCollapsed: true,
        sidePanesFlipped: true,
        zoneSplitRatio: 0.15,
        sidebarWidth: 800,
        inspectorCollapsed: false,
      });
      expect(saved.layout?.editorTree.kind).toBe("split");
      if (saved.layout?.editorTree.kind === "split" && saved.layout.editorTree.children[1].kind === "leaf") {
        expect(saved.layout.editorTree.children[1].content).toEqual({ kind: "browser", url: "localhost:3000" });
      }
      expect(saved.layout?.terminalTree.kind).toBe("leaf");
      if (saved.layout?.terminalTree.kind === "leaf" && saved.layout.terminalTree.content.kind === "terminal") {
        expect(saved.layout.terminalTree.content.activeTerminalId).toBe("term-2");
      }
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("uses the current explorer width for new and old-default layouts", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-sidebar-width-"));

    try {
      const saved = await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-layout/notes",
        defaultTerminalCwd: "/tmp/exo-layout/project",
        noteRoots: ["/tmp/exo-layout/notes"],
        projectRoots: ["/tmp/exo-layout/project"],
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
        layout: {
          editorTree: { kind: "leaf", id: "editor-a", content: { kind: "editor", openPaths: [], activePath: null } },
          terminalTree: { kind: "leaf", id: "terminal-a", content: { kind: "terminal", terminalIds: [], activeTerminalId: null } },
          terminalCollapsed: false,
          sidePanesFlipped: false,
          zoneSplitRatio: 0.6,
          sidebarCollapsed: false,
          sidebarWidth: 260,
          inspectorCollapsed: true,
        },
      }, { EXO_USER_DATA_PATH: userDataPath });

      expect(saved.layout?.sidebarWidth).toBe(175);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

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
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryLines: 1_000_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
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
