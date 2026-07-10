import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand } from "../agent-invocation";
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
        terminalHistoryLines: 100_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
        agentCommands: [
          {
            id: " Claude Code ",
            label: " Claude Code ",
            handle: " @Claude ",
            command: " claude ",
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
          promptDelivery: "terminalInputAfterLaunch",
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
      terminalHistoryLines: 100_000,
      terminalTranscriptRetention: "forever",
      terminalTranscriptRetentionDays: 14,
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
    } as Parameters<typeof saveWorkspaceSettings>[0] & {
      futureSettings: { version: number; preferences: string[] };
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
      });
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
      promptDelivery: "terminalInputAfterLaunch",
    });
  });

  it("normalizes and projects persisted Pi-compatible harness settings", () => {
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-pi/notes",
      defaultTerminalCwd: "/tmp/exo-pi",
      noteRoots: ["/tmp/exo-pi/notes"],
      projectRoots: ["/tmp/exo-pi/projects"],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      piHarness: {
        enabled: true,
        label: "Custom Pi",
        command: "  /opt/pi/bin/pi  ",
        repoPath: " /opt/pi ",
        args: [" --model ", "", "local"],
        backendUrl: " http://127.0.0.1:8080 ",
        backendReady: false,
      },
    });

    expect(settings?.piHarness).toEqual({
      enabled: true,
      label: "Custom Pi",
      command: "/opt/pi/bin/pi",
      repoPath: "/opt/pi",
      args: ["--model", "local"],
      backendUrl: "http://127.0.0.1:8080",
      backendReady: false,
    });
    expect(workspaceSettingsToEnv(settings!)).toMatchObject({
      EXO_PI_ENABLED: "1",
      EXO_PI_LABEL: "Custom Pi",
      EXO_PI_COMMAND: "/opt/pi/bin/pi",
      EXO_PI_REPO_PATH: "/opt/pi",
      EXO_PI_ARGS: "--model,local",
      EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
      EXO_PI_BACKEND_READY: "0",
    });
    expect(workspaceSettingsToEnv(settings!, { includeWorkspace: false })).not.toHaveProperty("EXO_WORKSPACE_ROOT");
  });

  it("lets process env override persisted Pi-compatible harness settings", () => {
    const settings = normalizeWorkspaceSettings({
      workspaceRoot: "/tmp/exo-pi/notes",
      defaultTerminalCwd: "/tmp/exo-pi",
      noteRoots: ["/tmp/exo-pi/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      piHarness: {
        label: "Persisted Pi",
        repoPath: "/tmp/persisted-pi",
        backendUrl: "http://127.0.0.1:8080",
      },
    });

    const env: Record<string, string> = {
      ...workspaceSettingsToEnv(settings!),
      EXO_PI_LABEL: "Operator Pi",
      EXO_PI_BACKEND_URL: "http://127.0.0.1:9090",
    };

    expect(env.EXO_PI_LABEL).toBe("Operator Pi");
    expect(env.EXO_PI_BACKEND_URL).toBe("http://127.0.0.1:9090");
    expect(env.EXO_PI_REPO_PATH).toBe("/tmp/persisted-pi");
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
