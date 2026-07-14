import { access, chmod, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand } from "../agent-invocation";
import {
  loadWorkspaceSettings,
  listWorkspaceRegistryEntries,
  loadActiveWorkspaceSettings,
  normalizeWorkspaceSettings,
  resolveWorkspaceRegistryPath,
  resolveWorkspaceSettingsPath,
  resolveWorkspaceSettingsTransactionPath,
  saveWorkspaceSettings,
  workspaceEnvOverrides,
} from "../workspace-settings";

describe("workspace settings registry", () => {
  it("atomically strips retired project roots while preserving commands, layout, indexing, migration metadata, and unknown fields", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-note-root-migration-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const legacySettings = {
      workspaceRoot: "/tmp/exo-migration",
      defaultTerminalCwd: "/tmp/exo-migration",
      noteRoots: ["/tmp/exo-migration/notes", "/tmp/exo-migration/notes-two"],
      projectRoots: ["/tmp/exo-migration/project-a", "/tmp/exo-migration/project-b"],
      indexedRoots: [{ id: "index-1", label: "notes", path: "/tmp/exo-migration/notes", kind: "notes", pattern: "**/*.md", ignore: [], backend: "qmd" }],
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
      appearanceMode: "dark",
      colorThemeId: "exo-neutral",
      editorFontSize: 15,
      terminalFontSize: 13,
      terminalHistoryLines: 100_000,
      terminalTranscriptRetention: "forever",
      terminalTranscriptRetentionDays: 14,
      terminalInputCoalesceMs: 40,
      terminalAgentStartupGraceMs: 1_500,
      terminalAgentSubmitDelayMs: 120,
      terminalInitialColumns: 120,
      terminalInitialRows: 32,
      terminalMinimumColumns: 20,
      terminalMinimumRows: 8,
      terminalReadTailChars: 20_000,
      terminalMaxReadTailChars: 200_000,
      terminalUnresponsiveThresholdMs: 10_000,
      terminalIdleThresholdMs: 120_000,
      explorerScale: 1,
      exploreIndexSearchOnEnter: true,
      indexUpdateStrategy: "on-save",
      agentCommands: [{ id: "claude", label: "Claude", handle: "claude", command: "claude -p --model sonnet", cwdPolicy: "workspace_root", promptDelivery: "stdin", version: 1, enabled: true }],
      layout: { version: 2, sidebarCollapsed: false, sidebarWidth: 240, utilityWidth: 360, canvas: { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: [], activePath: null } } },
      migrationMetadata: { source: "legacy-build" },
      futureSetting: { retained: true },
    };
    const registry = {
      activeWorkspaceId: "legacy",
      workspaces: [{ id: "legacy", label: "Legacy", notesFolder: "/tmp/exo-migration/notes", settings: legacySettings, updatedAt: "2026-07-12T00:00:00.000Z" }],
    };
    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(legacySettings), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify(registry), { mode: 0o600 });

      const loaded = await loadWorkspaceSettings(env);
      expect(loaded).toMatchObject({ noteRoots: legacySettings.noteRoots, agentCommands: legacySettings.agentCommands, migrationMetadata: legacySettings.migrationMetadata, futureSetting: legacySettings.futureSetting, layout: legacySettings.layout });
      expect(loaded).not.toHaveProperty("projectRoots");

      const persisted = JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8"));
      const persistedRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8"));
      expect(persisted).not.toHaveProperty("projectRoots");
      expect(persistedRegistry.workspaces[0].settings).not.toHaveProperty("projectRoots");
      expect(persistedRegistry.workspaces[0].settings.futureSetting).toEqual({ retained: true });
      for (const key of [
        "terminalHistoryLines", "terminalTranscriptRetention", "terminalTranscriptRetentionDays",
        "terminalInputCoalesceMs", "terminalAgentStartupGraceMs", "terminalAgentSubmitDelayMs",
        "terminalInitialColumns", "terminalInitialRows", "terminalMinimumColumns", "terminalMinimumRows",
        "terminalReadTailChars", "terminalMaxReadTailChars", "terminalUnresponsiveThresholdMs", "terminalIdleThresholdMs",
      ]) {
        expect(persisted).not.toHaveProperty(key);
        expect(persistedRegistry.workspaces[0].settings).not.toHaveProperty(key);
      }
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("normalizes retired terminal settings when recovering an interrupted transaction", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-terminal-migration-recovery-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const legacy = {
      workspaceRoot: "/tmp/exo-terminal-recovery",
      defaultTerminalCwd: "/tmp/exo-terminal-recovery",
      noteRoots: ["/tmp/exo-terminal-recovery/notes"],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryLines: 5,
      terminalReadTailChars: 7,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 1,
      futureSetting: { retained: true },
    };
    const transaction = {
      version: 1,
      settings: legacy,
      registry: { activeWorkspaceId: "legacy", workspaces: [{ id: "legacy", label: "legacy", notesFolder: legacy.noteRoots[0], settings: legacy, updatedAt: "2026-07-12T00:00:00.000Z" }] },
    };

    try {
      await writeFile(resolveWorkspaceSettingsTransactionPath(env), JSON.stringify(transaction), { mode: 0o600 });
      const loaded = await loadWorkspaceSettings(env);
      expect(loaded?.futureSetting).toEqual({ retained: true });
      for (const key of ["terminalHistoryLines", "terminalReadTailChars", "terminalTranscriptRetention", "terminalTranscriptRetentionDays"]) {
        expect(loaded).not.toHaveProperty(key);
      }
      await expect(access(resolveWorkspaceSettingsTransactionPath(env))).rejects.toMatchObject({ code: "ENOENT" });
      const persisted = JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8"));
      expect(persisted.futureSetting).toEqual({ retained: true });
      expect(persisted).not.toHaveProperty("terminalHistoryLines");
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("recovers a committed settings transaction after an interrupted registry write", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-settings-recovery-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-recovery/notes",
      defaultTerminalCwd: "/tmp/exo-recovery",
      noteRoots: ["/tmp/exo-recovery/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    try {
      expect(settings).not.toBeNull();
      await saveWorkspaceSettings(settings!, env);
      const registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceSettingsTransaction["registry"];
      const nextSettings = { ...settings!, appearanceMode: "dark" as const };
      const nextRegistry = {
        ...registry,
        workspaces: registry.workspaces.map((entry, index) =>
          index === 0 ? { ...entry, settings: nextSettings } : entry),
      };
      const transactionPath = resolveWorkspaceSettingsTransactionPath(env);
      await writeFile(transactionPath, JSON.stringify({ version: 1, settings: nextSettings, registry: nextRegistry }), { mode: 0o600 });
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(nextSettings), { mode: 0o600 });

      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({ appearanceMode: "dark" });

      const recoveredRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceSettingsTransaction["registry"];
      expect(recoveredRegistry.workspaces[0]?.settings.appearanceMode).toBe("dark");
      await expect(access(transactionPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("enforces private permissions on settings and registry files", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-private-settings-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-private/notes",
      defaultTerminalCwd: "/tmp/exo-private",
      noteRoots: ["/tmp/exo-private/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    try {
      expect(settings).not.toBeNull();
      await saveWorkspaceSettings(settings!, env);
      await chmod(resolveWorkspaceSettingsPath(env), 0o666);
      await chmod(resolveWorkspaceRegistryPath(env), 0o666);

      await saveWorkspaceSettings({ ...settings!, appearanceMode: "dark" }, env);

      expect((await stat(resolveWorkspaceSettingsPath(env))).mode & 0o777).toBe(0o600);
      expect((await stat(resolveWorkspaceRegistryPath(env))).mode & 0o777).toBe(0o600);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("atomically replaces the settings and registry files", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-atomic-settings-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const initial = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-atomic/notes",
      defaultTerminalCwd: "/tmp/exo-atomic",
      noteRoots: ["/tmp/exo-atomic/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      appearanceMode: "system",
    });

    try {
      expect(initial).not.toBeNull();
      await saveWorkspaceSettings(initial!, env);
      const originalSettingsFile = await open(resolveWorkspaceSettingsPath(env), "r");
      const originalRegistryFile = await open(resolveWorkspaceRegistryPath(env), "r");

      try {
        await saveWorkspaceSettings({ ...initial!, appearanceMode: "dark" }, env);

        const originalSettings = JSON.parse(await originalSettingsFile.readFile("utf8")) as { appearanceMode: string };
        const currentSettings = JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8")) as { appearanceMode: string };
        const originalRegistry = JSON.parse(await originalRegistryFile.readFile("utf8")) as WorkspaceRegistryAppearance;
        const currentRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistryAppearance;
        expect(originalSettings.appearanceMode).toBe("system");
        expect(currentSettings.appearanceMode).toBe("dark");
        expect(originalRegistry.workspaces[0]?.settings.appearanceMode).toBe("system");
        expect(currentRegistry.workspaces[0]?.settings.appearanceMode).toBe("dark");
      } finally {
        await Promise.all([originalSettingsFile.close(), originalRegistryFile.close()]);
      }
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

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

  it("normalizes and persists configured agent commands", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-agent-commands-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };

    try {
      await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-agent/notes",
        defaultTerminalCwd: "/tmp/exo-agent",
        noteRoots: ["/tmp/exo-agent/notes"],
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
        agentCommands: [
          {
            id: " Claude Code ",
            label: " Claude Code ",
            handle: " @Claude ",
            command: " claude ",
            adapter: "generic",
            continuityPolicy: "fresh",
            cwdPolicy: "workspace_root",
            promptDelivery: "auto" as never,
            version: 0,
            enabled: true,
          },
        ],
      }, env);

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({
        agentCommands: [{
          id: "Claude-Code",
          label: "Claude Code",
          handle: "claude",
          command: "claude",
          cwdPolicy: "workspace_root",
          promptDelivery: "stdin",
          version: 1,
          enabled: true,
        }],
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("preserves configured and future settings across load, edit, save, and reload", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-lossless-settings-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const initialSettings = {
      workspaceRoot: "/tmp/exo-lossless/notes",
      defaultTerminalCwd: "/tmp/exo-lossless",
      noteRoots: ["/tmp/exo-lossless/notes"],
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
      agentCommands: [createDefaultClaudeAgentCommand()],
      layout: {
        editorTree: {
          kind: "leaf",
          id: "editor-primary",
          content: { kind: "editor", openPaths: ["/tmp/exo-lossless/notes/home.md"], activePath: "/tmp/exo-lossless/notes/home.md" },
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
      },
      futureSettings: {
        version: 2,
        preferences: ["local", "lossless"],
      },
      piHarness: {
        command: "/opt/retired-pi",
      },
    } as Parameters<typeof saveWorkspaceSettings>[0] & {
      futureSettings: { version: number; preferences: string[] };
      piHarness: { command: string };
    };

    try {
      await saveWorkspaceSettings(initialSettings, env);
      const loaded = await loadWorkspaceSettings(env);

      expect(loaded).not.toBeNull();
      await saveWorkspaceSettings({ ...loaded!, appearanceMode: "dark" }, env);

      const reloaded = await loadWorkspaceSettings(env) as typeof initialSettings | null;
      expect(reloaded).toMatchObject({
        appearanceMode: "dark",
        agentCommands: initialSettings.agentCommands,
        layout: initialSettings.layout,
        futureSettings: initialSettings.futureSettings,
        piHarness: initialSettings.piHarness,
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("preserves the current renderer canvas layout across a settings edit", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-canvas-layout-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const layout = {
      version: 2 as const,
      canvas: {
        kind: "leaf" as const,
        id: "editor-primary",
        content: {
          kind: "editor" as const,
          openPaths: ["/tmp/exo-canvas-layout/notes/home.md"],
          activePath: "/tmp/exo-canvas-layout/notes/home.md",
        },
      },
      sidebarCollapsed: false,
      sidebarWidth: 275,
      utilityWidth: 430,
    };
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-canvas-layout",
      defaultTerminalCwd: "/tmp/exo-canvas-layout",
      noteRoots: ["/tmp/exo-canvas-layout/notes"],
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
      layout,
    });

    try {
      expect(settings).not.toBeNull();
      const saved = await saveWorkspaceSettings(settings!, env);
      expect(saved.layout).toEqual(layout);

      const reloaded = await loadWorkspaceSettings(env);
      expect(reloaded).not.toBeNull();
      const edited = await saveWorkspaceSettings({ ...reloaded!, appearanceMode: "dark" }, env);
      expect(edited.layout).toEqual(layout);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("defaults missing agent commands to an empty settings list without installing commands", () => {
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-agent/notes",
      defaultTerminalCwd: "/tmp/exo-agent",
      noteRoots: ["/tmp/exo-agent/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    expect(settings?.agentCommands).toEqual([]);
    expect(createDefaultClaudeAgentCommand()).toMatchObject({
      handle: "claude",
      promptDelivery: "stdin",
    });
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
          terminalMonitorMode: true,
          sidePanesFlipped: true,
          zoneSplitRatio: 0.01,
          sidebarCollapsed: true,
          sidebarWidth: 9999,
          inspectorCollapsed: false,
        },
      }, { EXO_USER_DATA_PATH: userDataPath });

      expect(saved.layout).toMatchObject({
        terminalCollapsed: true,
        terminalMonitorMode: true,
        sidePanesFlipped: true,
        zoneSplitRatio: 0.15,
        sidebarWidth: 800,
        inspectorCollapsed: false,
      });
      if (!saved.layout || !("editorTree" in saved.layout)) {
        throw new Error("Expected the legacy layout to remain readable.");
      }
      expect(saved.layout.editorTree.kind).toBe("split");
      if (saved.layout.editorTree.kind === "split" && saved.layout.editorTree.children[1].kind === "leaf") {
        expect(saved.layout.editorTree.children[1].content).toEqual({ kind: "browser", url: "localhost:3000" });
      }
      expect(saved.layout.terminalTree.kind).toBe("leaf");
      if (saved.layout.terminalTree.kind === "leaf" && saved.layout.terminalTree.content.kind === "terminal") {
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
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
        layout: {
          editorTree: { kind: "leaf", id: "editor-a", content: { kind: "editor", openPaths: [], activePath: null } },
          terminalTree: { kind: "leaf", id: "terminal-a", content: { kind: "terminal", terminalIds: [], activeTerminalId: null } },
          terminalCollapsed: false,
          terminalMonitorMode: false,
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
      await saveWorkspaceSettings({
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
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, env);

      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({
        workspaceRoot: "/tmp/exo/notes-alpha",
        defaultTerminalCwd: "/tmp/exo/project-alpha",
      });
      await expect(listWorkspaceRegistryEntries(env)).resolves.toHaveLength(1);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("treats explicit workspace env as an override", () => {
    expect(workspaceEnvOverrides({ EXO_WORKSPACE_ROOT: "/tmp/manual" })).toBe(true);
    expect(workspaceEnvOverrides({})).toBe(false);
  });
});

interface WorkspaceRegistryAppearance {
  workspaces: Array<{ settings: { appearanceMode: string } }>;
}

interface WorkspaceSettingsTransaction {
  registry: {
    activeWorkspaceId: string | null;
    workspaces: Array<{ settings: { appearanceMode: string }; [key: string]: unknown }>;
  };
}
