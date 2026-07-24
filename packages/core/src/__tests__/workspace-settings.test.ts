import { access, chmod, mkdir, mkdtemp, open, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand } from "../agent-invocation";
import {
  loadWorkspaceSettings,
  listWorkspaceRegistryEntries,
  loadWorkspaceRegistry,
  loadActiveWorkspaceSettings,
  acknowledgeMainWikiMigration,
  normalizeWorkspaceSettings,
  pendingMainWikiMigration,
  resolveWorkspaceRegistryPath,
  resolveWorkspaceSettingsPath,
  resolveWorkspaceSettingsTransactionPath,
  saveWorkspaceSettings,
  workspaceEnvOverrides,
  workspaceModelFromSettings,
} from "../workspace-settings";

describe("workspace settings registry", () => {
  it("normalizes legacy multi-root settings to one wiki and keeps its contained index roots only", () => {
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-one-wiki",
      defaultTerminalCwd: "/tmp/exo-one-wiki",
      noteRoots: ["/tmp/exo-one-wiki/notes", "/tmp/exo-one-wiki/other-notes"],
      indexedRoots: [
        { id: "notes", label: "notes", path: "/tmp/exo-one-wiki/notes", kind: "notes", pattern: "**/*.md", ignore: [], backend: "qmd" },
        { id: "nested", label: "nested", path: "/tmp/exo-one-wiki/notes/docs", kind: "docs", pattern: "**/*.md", ignore: [], backend: "qmd" },
        { id: "other", label: "other", path: "/tmp/exo-one-wiki/other-notes", kind: "notes", pattern: "**/*.md", ignore: [], backend: "qmd" },
      ],
      indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
    });

    expect(settings?.noteRoots).toEqual(["/tmp/exo-one-wiki/notes"]);
    expect(settings?.indexedRoots.map((root) => root.path)).toEqual([
      "/tmp/exo-one-wiki/notes",
      "/tmp/exo-one-wiki/notes/docs",
    ]);
    expect(pendingMainWikiMigration(settings!)).toEqual({
      retiredNoteRoots: ["/tmp/exo-one-wiki/other-notes"],
    });
    expect(pendingMainWikiMigration(acknowledgeMainWikiMigration(settings!))).toBeNull();
  });

  it("persists the one-main-wiki migration even when no other legacy settings exist", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-main-wiki-migration-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const primaryRoot = "/tmp/exo-main-wiki/notes";
    const retiredRoot = "/tmp/exo-main-wiki/archive";
    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify({
        workspaceRoot: "/tmp/exo-main-wiki",
        defaultTerminalCwd: "/tmp/exo-main-wiki",
        noteRoots: [primaryRoot, retiredRoot],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      }), { mode: 0o600 });

      const loaded = await loadWorkspaceSettings(env);
      expect(pendingMainWikiMigration(loaded!)).toEqual({ retiredNoteRoots: [retiredRoot] });

      const persisted = JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8"));
      expect(persisted.noteRoots).toEqual([primaryRoot]);
      expect(persisted.migrationMetadata.mainWiki).toEqual({ retiredNoteRoots: [retiredRoot] });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("migrates legacy active QMD settings and off settings to an explicit search engine", () => {
    const base = {
      workspaceRoot: "/tmp/exo-search-engine",
      defaultTerminalCwd: "/tmp/exo-search-engine",
      noteRoots: ["/tmp/exo-search-engine/notes"],
    };

    expect(normalizeWorkspaceSettings({
      ...base,
      indexedRoots: [{ id: "notes", label: "notes", path: "/tmp/exo-search-engine/notes", kind: "notes", pattern: "**/*.md", ignore: [], backend: "qmd" }],
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
    })?.searchEngine).toBe("qmd");
    expect(normalizeWorkspaceSettings({
      ...base,
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    })?.searchEngine).toBe("filesystem");
  });

  it("retains QMD configuration when Simple search is selected", () => {
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-search-engine",
      defaultTerminalCwd: "/tmp/exo-search-engine",
      noteRoots: ["/tmp/exo-search-engine/notes"],
      indexedRoots: [{ id: "notes", label: "notes", path: "/tmp/exo-search-engine/notes", kind: "notes", pattern: "**/*.md", ignore: [], backend: "qmd" }],
      indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
      searchEngine: "filesystem",
    });

    expect(settings).toMatchObject({
      searchEngine: "filesystem",
      indexing: { enabled: true, mode: "hybrid" },
      indexedRoots: [{ path: "/tmp/exo-search-engine/notes" }],
    });
  });

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
      expect(loaded).toMatchObject({ noteRoots: [legacySettings.noteRoots[0]], agentCommands: legacySettings.agentCommands, migrationMetadata: legacySettings.migrationMetadata, futureSetting: legacySettings.futureSetting, layout: { ...legacySettings.layout, version: 3 } });
      expect(loaded).not.toHaveProperty("projectRoots");

      const persisted = JSON.parse(await readFile(resolveWorkspaceSettingsPath(env), "utf8"));
      const persistedRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8"));
      expect(persisted).not.toHaveProperty("projectRoots");
      expect(persistedRegistry.workspaces[0].settings).not.toHaveProperty("projectRoots");
      expect(persistedRegistry.workspaces[0].settings.futureSetting).toEqual({ retained: true });
      expect(persisted.noteRoots).toEqual([legacySettings.noteRoots[0]]);
      expect(persistedRegistry.workspaces[0].settings.noteRoots).toEqual([legacySettings.noteRoots[0]]);
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
      version: 3 as const,
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

  it("retains colliding legacy workspace roots and reloads the intended active workspace", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-collision-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };

    try {
      await saveWorkspaceSettings(workspaceSettingsFor("/tmp/Aa"), env);
      await saveWorkspaceSettings(workspaceSettingsFor("/tmp/BB"), env);

      const registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(2);
      expect(registry.workspaces.map((workspace) => workspace.notesFolder)).toEqual(["/tmp/BB", "/tmp/Aa"]);
      expect(new Set(registry.workspaces.map((workspace) => workspace.id)).size).toBe(2);
      expect(registry.workspaces.every((workspace) => workspace.id.startsWith("workspace-v1-"))).toBe(true);
      expect(registry.activeWorkspaceId).toBe(registry.workspaces[0]?.id);
      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: ["/tmp/BB"] });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("deduplicates lexical aliases and persists their canonical absolute Notes Folder", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-canonical-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };

    try {
      await saveWorkspaceSettings(workspaceSettingsFor("/tmp/exo-canonical/notes"), env);
      await saveWorkspaceSettings(workspaceSettingsFor("/tmp/exo-canonical/./notes"), env);

      const registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(1);
      expect(registry.workspaces[0]?.notesFolder).toBe("/tmp/exo-canonical/notes");
      expect(registry.workspaces[0]?.settings.noteRoots).toEqual(["/tmp/exo-canonical/notes"]);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("migrates old colliding IDs atomically and preserves the active Notes Folder", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-migration-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const aa = workspaceSettingsFor("/tmp/Aa");
    const bb = workspaceSettingsFor("/tmp/BB");
    const legacyRegistry = legacyCollisionRegistry(aa, bb);

    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(bb), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify(legacyRegistry), { mode: 0o600 });

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: ["/tmp/BB"] });

      const persisted = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(persisted.workspaces).toHaveLength(2);
      expect(persisted.workspaces.map((workspace) => workspace.notesFolder)).toEqual(["/tmp/BB", "/tmp/Aa"]);
      expect(new Set(persisted.workspaces.map((workspace) => workspace.id)).size).toBe(2);
      expect(persisted.workspaces.every((workspace) => workspace.id.startsWith("workspace-v1-"))).toBe(true);
      expect(persisted.activeWorkspaceId).toBe(persisted.workspaces[0]?.id);
      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: ["/tmp/BB"] });
      await expect(access(resolveWorkspaceSettingsTransactionPath(env))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("recovers an interrupted old-ID migration without dropping either Workspace", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-recovery-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const aa = workspaceSettingsFor("/tmp/Aa");
    const bb = workspaceSettingsFor("/tmp/BB");

    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(aa), { mode: 0o600 });
      await writeFile(resolveWorkspaceSettingsTransactionPath(env), JSON.stringify({
        version: 1,
        settings: bb,
        registry: legacyCollisionRegistry(aa, bb),
      }), { mode: 0o600 });

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: ["/tmp/BB"] });

      const persisted = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(persisted.workspaces).toHaveLength(2);
      expect(new Set(persisted.workspaces.map((workspace) => workspace.id)).size).toBe(2);
      expect(persisted.workspaces.every((workspace) => workspace.id.startsWith("workspace-v1-"))).toBe(true);
      expect(persisted.activeWorkspaceId).toBe(persisted.workspaces.find((workspace) => workspace.notesFolder === "/tmp/BB")?.id);
      await expect(loadActiveWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: ["/tmp/BB"] });
      await expect(access(resolveWorkspaceSettingsTransactionPath(env))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it.each(["settings", "registry"] as const)("recovers malformed registry identity fields through %s load without a rewrite loop", async (loadKind) => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), `exo-core-workspace-malformed-${loadKind}-`));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const active = workspaceSettingsFor("/tmp/exo-malformed-active/notes");
    const other = workspaceSettingsFor("/tmp/exo-malformed-other/notes");

    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(active), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify({
        activeWorkspaceId: 7,
        workspaces: [
          { id: 7, label: "Active", notesFolder: null, settings: active, updatedAt: "2026-07-24T01:00:00.000Z" },
          { id: null, label: "Other", notesFolder: 42, settings: other, updatedAt: "2026-07-24T02:00:00.000Z" },
          null,
          { id: "invalid-settings", notesFolder: "/tmp/invalid", settings: null },
        ],
      }), { mode: 0o600 });

      const load = loadKind === "settings" ? loadWorkspaceSettings : loadWorkspaceRegistry;
      await expect(load(env)).resolves.toBeTruthy();
      const afterMigration = await readFile(resolveWorkspaceRegistryPath(env), "utf8");
      const registry = JSON.parse(afterMigration) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(2);
      expect(registry.workspaces.map((entry) => entry.label)).toEqual(["Active", "Other"]);
      expect(registry.workspaces.every((entry) => entry.id.startsWith("workspace-v1-"))).toBe(true);
      expect(registry.activeWorkspaceId).toBe(registry.workspaces[0]?.id);
      const migratedInode = (await stat(resolveWorkspaceRegistryPath(env))).ino;

      await expect(load(env)).resolves.toBeTruthy();
      expect(await readFile(resolveWorkspaceRegistryPath(env), "utf8")).toBe(afterMigration);
      expect((await stat(resolveWorkspaceRegistryPath(env))).ino).toBe(migratedInode);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("migrates identity in place while preserving labels, order, timestamps, and unrelated settings", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-metadata-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const first = { ...workspaceSettingsFor("/tmp/exo-metadata-first/notes"), futureSetting: { retained: "first" } };
    const staleActive = { ...workspaceSettingsFor("/tmp/exo-metadata-active/notes"), futureSetting: { retained: "stale" } };
    const currentActive = { ...staleActive, futureSetting: { retained: "current" } };
    const third = { ...workspaceSettingsFor("/tmp/exo-metadata-third/notes"), futureSetting: { retained: "third" } };

    try {
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(currentActive), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify({
        activeWorkspaceId: "legacy-active",
        workspaces: [
          { id: "legacy-first", label: "First custom label", notesFolder: first.noteRoots[0], settings: first, updatedAt: "2026-07-21T01:00:00.000Z", futureMetadata: { retained: true } },
          { id: "legacy-active", label: "Keep this custom label", notesFolder: "/tmp/exo-stale-display-path", settings: staleActive, updatedAt: "2026-07-22T02:00:00.000Z" },
          { id: 17, label: "Third custom label", notesFolder: null, settings: third, updatedAt: "2026-07-23T03:00:00.000Z" },
        ],
      }), { mode: 0o600 });

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ futureSetting: { retained: "current" } });
      const afterMigration = await readFile(resolveWorkspaceRegistryPath(env), "utf8");
      const registry = JSON.parse(afterMigration) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces.map((entry) => entry.label)).toEqual([
        "First custom label",
        "Keep this custom label",
        "Third custom label",
      ]);
      expect(registry.workspaces.map((entry) => entry.updatedAt)).toEqual([
        "2026-07-21T01:00:00.000Z",
        "2026-07-22T02:00:00.000Z",
        "2026-07-23T03:00:00.000Z",
      ]);
      expect(registry.workspaces.map((entry) => entry.notesFolder)).toEqual([
        first.noteRoots[0],
        staleActive.noteRoots[0],
        third.noteRoots[0],
      ]);
      expect(registry.activeWorkspaceId).toBe(registry.workspaces[1]?.id);
      expect(registry.workspaces[0]?.settings.futureSetting).toEqual({ retained: "first" });
      expect(registry.workspaces[1]?.settings.futureSetting).toEqual({ retained: "current" });
      expect(registry.workspaces[2]?.settings.futureSetting).toEqual({ retained: "third" });
      expect(registry.workspaces[0]?.futureMetadata).toEqual({ retained: true });
      const migratedInode = (await stat(resolveWorkspaceRegistryPath(env))).ino;

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ futureSetting: { retained: "current" } });
      await expect(loadWorkspaceRegistry(env)).resolves.toMatchObject({ activeWorkspaceId: registry.activeWorkspaceId });
      expect(await readFile(resolveWorkspaceRegistryPath(env), "utf8")).toBe(afterMigration);
      expect((await stat(resolveWorkspaceRegistryPath(env))).ino).toBe(migratedInode);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("migrates a legacy real path to the selected symlink alias coherently in one load", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-selected-alias-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const otherNotesFolder = path.join(userDataPath, "other-notes");
    const realNotesFolder = path.join(userDataPath, "real-notes");
    const aliasNotesFolder = path.join(userDataPath, "alias-notes");

    try {
      await mkdir(otherNotesFolder);
      await mkdir(realNotesFolder);
      await symlink(realNotesFolder, aliasNotesFolder, "dir");
      const other = workspaceSettingsFor(otherNotesFolder);
      const legacyActive = { ...workspaceSettingsFor(realNotesFolder), futureSetting: { retained: "legacy" } };
      const selectedActive = { ...workspaceSettingsFor(aliasNotesFolder), futureSetting: { retained: "selected" } };
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(selectedActive), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify({
        activeWorkspaceId: "legacy-active",
        workspaces: [
          { id: "legacy-other", label: "Other label", notesFolder: otherNotesFolder, settings: other, updatedAt: "2026-07-20T01:00:00.000Z" },
          { id: "legacy-active", label: "Selected alias label", notesFolder: realNotesFolder, settings: legacyActive, updatedAt: "2026-07-21T02:00:00.000Z", futureMetadata: { retained: true } },
        ],
      }), { mode: 0o600 });

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: [aliasNotesFolder] });
      const afterMigration = await readFile(resolveWorkspaceRegistryPath(env), "utf8");
      const registry = JSON.parse(afterMigration) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces.map((entry) => entry.label)).toEqual(["Other label", "Selected alias label"]);
      expect(registry.workspaces[1]).toMatchObject({
        notesFolder: aliasNotesFolder,
        settings: { noteRoots: [aliasNotesFolder], futureSetting: { retained: "selected" } },
        updatedAt: "2026-07-21T02:00:00.000Z",
        futureMetadata: { retained: true },
      });
      expect(registry.activeWorkspaceId).toBe(registry.workspaces[1]?.id);
      const migratedInode = (await stat(resolveWorkspaceRegistryPath(env))).ino;

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: [aliasNotesFolder] });
      expect(await readFile(resolveWorkspaceRegistryPath(env), "utf8")).toBe(afterMigration);
      expect((await stat(resolveWorkspaceRegistryPath(env))).ino).toBe(migratedInode);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("reconciles an already-v1 physical registry entry to the selected symlink alias once", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-v1-selected-alias-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const otherNotesFolder = path.join(userDataPath, "other-notes");
    const realNotesFolder = path.join(userDataPath, "real-notes");
    const aliasNotesFolder = path.join(userDataPath, "alias-notes");

    try {
      await mkdir(otherNotesFolder);
      await mkdir(realNotesFolder);
      await symlink(realNotesFolder, aliasNotesFolder, "dir");
      await saveWorkspaceSettings(workspaceSettingsFor(otherNotesFolder), env);
      await saveWorkspaceSettings({ ...workspaceSettingsFor(realNotesFolder), futureSetting: { retained: "physical" } }, env);
      const physicalRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      const physicalEntry = physicalRegistry.workspaces[0]!;
      const otherEntry = physicalRegistry.workspaces[1]!;
      const selectedActive = { ...workspaceSettingsFor(aliasNotesFolder), futureSetting: { retained: "selected" } };
      const seededRegistry = {
        activeWorkspaceId: physicalEntry.id,
        workspaces: [
          { ...physicalEntry, label: "Physical custom label", updatedAt: "2026-07-24T04:00:00.000Z", futureMetadata: { retained: true } },
          otherEntry,
        ],
      };
      expect(physicalEntry.id).toMatch(/^workspace-v1-/);
      await writeFile(resolveWorkspaceSettingsPath(env), JSON.stringify(selectedActive), { mode: 0o600 });
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify(seededRegistry), { mode: 0o600 });

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: [aliasNotesFolder] });
      const afterMigration = await readFile(resolveWorkspaceRegistryPath(env), "utf8");
      const registry = JSON.parse(afterMigration) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(2);
      expect(registry.workspaces[0]).toMatchObject({
        id: physicalEntry.id,
        label: "Physical custom label",
        notesFolder: aliasNotesFolder,
        settings: { noteRoots: [aliasNotesFolder], futureSetting: { retained: "selected" } },
        updatedAt: "2026-07-24T04:00:00.000Z",
        futureMetadata: { retained: true },
      });
      expect(registry.workspaces[1]).toEqual(otherEntry);
      expect(registry.activeWorkspaceId).toBe(physicalEntry.id);
      const migratedInode = (await stat(resolveWorkspaceRegistryPath(env))).ino;

      await expect(loadWorkspaceSettings(env)).resolves.toMatchObject({ noteRoots: [aliasNotesFolder] });
      expect(await readFile(resolveWorkspaceRegistryPath(env), "utf8")).toBe(afterMigration);
      expect((await stat(resolveWorkspaceRegistryPath(env))).ino).toBe(migratedInode);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("uses one physical identity for a real Notes Folder and its symlink alias", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-symlink-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const realNotesFolder = path.join(userDataPath, "real-notes");
    const aliasNotesFolder = path.join(userDataPath, "alias-notes");

    try {
      await mkdir(realNotesFolder);
      await symlink(realNotesFolder, aliasNotesFolder, "dir");
      await saveWorkspaceSettings(workspaceSettingsFor(realNotesFolder), env);
      const firstRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;

      await saveWorkspaceSettings(workspaceSettingsFor(aliasNotesFolder), env);
      const registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(1);
      expect(registry.workspaces[0]?.id).toBe(firstRegistry.workspaces[0]?.id);
      expect(registry.workspaces[0]?.notesFolder).toBe(aliasNotesFolder);
      expect(registry.workspaces[0]?.settings.noteRoots).toEqual([aliasNotesFolder]);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("uses one physical identity for case aliases on a case-insensitive macOS volume", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-case-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const notesFolder = path.join(userDataPath, "CaseSensitiveSpelling");
    const aliasNotesFolder = path.join(userDataPath, "casesensitivespelling");

    try {
      await mkdir(notesFolder);
      try {
        await realpath(aliasNotesFolder);
      } catch {
        return;
      }
      await saveWorkspaceSettings(workspaceSettingsFor(notesFolder), env);
      const firstRegistry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      await saveWorkspaceSettings(workspaceSettingsFor(aliasNotesFolder), env);
      const registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(1);
      expect(registry.workspaces[0]?.id).toBe(firstRegistry.workspaces[0]?.id);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("uses physical identity for relative existing roots and lexical identity for absent roots", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-fallback-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const existingNotesFolder = path.join(userDataPath, "existing-notes");
    const relativeNotesFolder = path.relative(process.cwd(), existingNotesFolder);
    const absentNotesFolder = path.join(userDataPath, "absent-notes");
    const absentAlias = path.join(userDataPath, "missing-parent", "..", "absent-notes");

    try {
      await mkdir(existingNotesFolder);
      const relativeSettings = workspaceSettingsFor(relativeNotesFolder);
      expect(relativeSettings.noteRoots).toEqual([existingNotesFolder]);
      expect(workspaceModelFromSettings(relativeSettings).noteRoots[0]?.path).toBe(existingNotesFolder);
      await saveWorkspaceSettings(workspaceSettingsFor(existingNotesFolder), env);
      const existingId = (JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot).workspaces[0]?.id;
      await saveWorkspaceSettings(relativeSettings, env);
      let registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(1);
      expect(registry.workspaces[0]?.id).toBe(existingId);
      expect(registry.workspaces[0]?.notesFolder).toBe(existingNotesFolder);
      expect(registry.workspaces[0]?.settings.noteRoots).toEqual([existingNotesFolder]);

      await saveWorkspaceSettings(workspaceSettingsFor(absentNotesFolder), env);
      const absentId = (JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot).workspaces[0]?.id;
      await saveWorkspaceSettings(workspaceSettingsFor(absentAlias), env);
      registry = JSON.parse(await readFile(resolveWorkspaceRegistryPath(env), "utf8")) as WorkspaceRegistrySnapshot;
      expect(registry.workspaces).toHaveLength(2);
      expect(registry.workspaces[0]?.id).toBe(absentId);
      expect(registry.workspaces[0]?.notesFolder).toBe(absentNotesFolder);
      expect(registry.workspaces.map((entry) => entry.id)).toContain(existingId);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("preserves all entries and selects the first for an underdetermined legacy collision", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-core-workspace-identity-ambiguous-"));
    const env = { EXO_USER_DATA_PATH: userDataPath };
    const aa = workspaceSettingsFor("/tmp/Aa");
    const bb = workspaceSettingsFor("/tmp/BB");

    try {
      await writeFile(resolveWorkspaceRegistryPath(env), JSON.stringify(legacyCollisionRegistry(aa, bb)), { mode: 0o600 });

      const registry = await loadWorkspaceRegistry(env);
      expect(registry.workspaces).toHaveLength(2);
      expect(registry.workspaces.map((entry) => entry.notesFolder)).toEqual(["/tmp/BB", "/tmp/Aa"]);
      expect(registry.activeWorkspaceId).toBe(registry.workspaces[0]?.id);
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

interface WorkspaceRegistrySnapshot {
  activeWorkspaceId: string | null;
  workspaces: Array<{
    id: string;
    label: string;
    notesFolder: string;
    settings: { noteRoots: string[]; futureSetting?: unknown };
    updatedAt: string;
    futureMetadata?: unknown;
  }>;
}

function workspaceSettingsFor(notesFolder: string) {
  const settings = normalizeWorkspaceSettings({
    workspaceRoot: path.dirname(notesFolder),
    defaultTerminalCwd: path.dirname(notesFolder),
    noteRoots: [notesFolder],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  });
  if (!settings) {
    throw new Error("Expected fixture settings to normalize.");
  }
  return settings;
}

function legacyCollisionRegistry(aa: ReturnType<typeof workspaceSettingsFor>, bb: ReturnType<typeof workspaceSettingsFor>) {
  return {
    activeWorkspaceId: "workspace-106p25j",
    workspaces: [
      { id: "workspace-106p25j", label: "BB", notesFolder: "/tmp/BB", settings: bb, updatedAt: "2026-07-24T00:00:00.000Z" },
      { id: "workspace-106p25j", label: "Aa", notesFolder: "/tmp/Aa", settings: aa, updatedAt: "2026-07-23T00:00:00.000Z" },
    ],
  };
}

interface WorkspaceSettingsTransaction {
  registry: {
    activeWorkspaceId: string | null;
    workspaces: Array<{ settings: { appearanceMode: string }; [key: string]: unknown }>;
  };
}
