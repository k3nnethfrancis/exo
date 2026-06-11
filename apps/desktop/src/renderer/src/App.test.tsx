import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "../../main/settings-store";
import { buildProjectReviewChanges, uniqueCwdMatchedSession } from "./changedFileReview";
import { isTerminalGeneratedResponse } from "./components/terminalInputFilters";
import { defaultTerminalCwdForNotesFolder } from "./hooks/useWorkspaceBootstrap";
import { terminalSessionsEqual } from "./terminalSessions";
import {
  FULL_TERMINAL_SCROLLBACK_LINES,
  clampNumber,
  resolveSettingsTerminalRuntime,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "./workspaceSettingsModel";

describe("desktop shell", () => {
  it("keeps a renderer test surface in place", () => {
    expect(true).toBe(true);
  });
});

describe("workspace terminal settings", () => {
  it("defaults to the clean terminal policy", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    expect(settings?.terminalHistoryMode).toBe(DEFAULT_TERMINAL_HISTORY_MODE);
    expect(settings?.terminalHistoryLines).toBe(DEFAULT_TERMINAL_HISTORY_LINES);
    expect(settings?.terminalTranscriptRetention).toBe(DEFAULT_TERMINAL_TRANSCRIPT_RETENTION);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalStreamingMode")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalAgentTransport")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalScrollbackLines")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalBufferChars")).toBe(false);
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toMatchObject({
      bufferLineLimit: DEFAULT_TERMINAL_HISTORY_LINES,
      transcriptRetentionDays: 0,
    });
  });

  it("derives terminal internals from custom history settings", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryMode: "custom",
      terminalHistoryLines: 24_000,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 30,
    });

    expect(settings?.terminalHistoryMode).toBe("custom");
    expect(settings?.terminalHistoryLines).toBe(24_000);
    expect(settings?.terminalTranscriptRetention).toBe("days");
    expect(settings?.terminalTranscriptRetentionDays).toBe(30);
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toEqual({
      scrollbackLines: 24_000,
      bufferLineLimit: 24_000,
      transcriptRetentionDays: 30,
    });
  });
});

describe("workspace settings renderer model", () => {
  it("keeps structural draft keys aligned with saved settings keys", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      projectRoots: ["/workspace/project"],
      indexedRoots: [{
        id: "index-notes",
        label: "notes",
        path: "/workspace/notes",
        kind: "notes",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      }],
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
    });

    expect(settings).not.toBeNull();
    expect(workspaceSettingsStructuralDraftKey({
      section: "workspace",
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      projectRoots: ["/workspace/project"],
      indexedRoots: ["/workspace/notes"],
      indexMode: "lexical",
      appearanceMode: "system",
      editorFontSize: "15",
      terminalFontSize: "13",
      terminalHistoryMode: "full",
      terminalHistoryLines: "1000000",
      terminalTranscriptRetention: "forever",
      terminalTranscriptRetentionDays: "14",
      explorerScale: "1",
      exploreIndexSearchOnEnter: true,
      indexUpdateStrategy: "on-save",
      saveStatus: "idle",
      errorMessage: null,
      appliedWorkspaceKey: "",
      applyStatus: "idle",
      applyErrorMessage: null,
      partialErrorMessages: [],
    })).toBe(workspaceSettingsStructuralKeyFromSettings(settings!));
  });

  it("resolves full scrollback and clamps invalid numeric settings", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryMode: "full",
    });

    expect(settings ? resolveSettingsTerminalRuntime(settings).scrollbackLines : null).toBe(FULL_TERMINAL_SCROLLBACK_LINES);
    expect(clampNumber(Number.NaN, 10, 20)).toBe(10);
    expect(clampNumber(25, 10, 20)).toBe(20);
    expect(clampNumber(15, 10, 20)).toBe(15);
  });
});

describe("workspace registry", () => {
  it("persists saved workspaces for the switcher", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-registry-"));
    const store = new WorkspaceSettingsStore({ userDataPath, env: {} });

    try {
      const firstSettings = store.normalize({
        workspaceRoot: "/tmp/exo-test/notes-alpha",
        defaultTerminalCwd: "/tmp/exo-test/notes-alpha",
        noteRoots: ["/tmp/exo-test/notes-alpha"],
        projectRoots: ["/tmp/exo-test/project-alpha"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });
      const secondSettings = store.normalize({
        workspaceRoot: "/tmp/exo-test/notes-beta",
        defaultTerminalCwd: "/tmp/exo-test/project-beta",
        noteRoots: ["/tmp/exo-test/notes-beta"],
        projectRoots: ["/tmp/exo-test/project-beta"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });

      expect(firstSettings).not.toBeNull();
      expect(secondSettings).not.toBeNull();
      await store.save(firstSettings!);
      await store.save(secondSettings!);

      const workspaces = await store.listWorkspaces();
      expect(workspaces.map((workspace) => workspace.label)).toEqual(["notes-beta", "notes-alpha"]);
      expect(workspaces[0].settings.defaultTerminalCwd).toBe("/tmp/exo-test/project-beta");
      await expect(store.getWorkspace(workspaces[1].id)).resolves.toMatchObject({
        notesFolder: "/tmp/exo-test/notes-alpha",
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});

describe("workspace onboarding model", () => {
  it("defaults terminal cwd to the parent of the selected notes folder", () => {
    expect(defaultTerminalCwdForNotesFolder("/Users/tester/lab/notes")).toBe("/Users/tester/lab");
    expect(defaultTerminalCwdForNotesFolder("/Users/tester/lab/notes/")).toBe("/Users/tester/lab");
    expect(defaultTerminalCwdForNotesFolder("/notes")).toBe("/notes");
  });
});

describe("terminal input filtering", () => {
  it("identifies xterm-generated device response sequences", () => {
    expect(isTerminalGeneratedResponse("\x1b[>0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[0n")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[24;80R")).toBe(true);
    expect(isTerminalGeneratedResponse("hello")).toBe(false);
    expect(isTerminalGeneratedResponse("try this out")).toBe(false);
  });
});

describe("terminal session sync", () => {
  it("detects unchanged terminal session snapshots", () => {
    const sessions = [
      {
        id: "term-a",
        title: "Shell",
        cwd: "/workspace",
        kind: "shell",
        command: "zsh",
        status: "running",
        health: "healthy",
        healthDetail: "running",
      },
    ] as const;

    expect(terminalSessionsEqual([...sessions], [...sessions])).toBe(true);
    expect(terminalSessionsEqual([...sessions], [{ ...sessions[0], healthDetail: "stale output" }])).toBe(false);
  });
});

describe("changed file review attribution", () => {
  it("does not associate ambiguous same-cwd file changes with every terminal", () => {
    const sessions = [
      { id: "term-a", title: "Shell A", cwd: "/workspace/project", kind: "shell", command: "zsh", status: "running" },
      { id: "term-b", title: "Shell B", cwd: "/workspace/project", kind: "shell", command: "zsh", status: "running" },
    ] as const;
    const change = {
      rootPath: "/workspace/project",
      rootLabel: "project",
      path: "src/demo.ts",
      absolutePath: "/workspace/project/src/demo.ts",
      status: "M",
      firstChangedLine: 2,
    };

    expect(uniqueCwdMatchedSession([...sessions], change.absolutePath)).toBeNull();
    expect(buildProjectReviewChanges([change], [], [...sessions])[0].agents).toEqual([]);
    expect(
      buildProjectReviewChanges(
        [change],
        [
          { rootPath: change.rootPath, filePath: change.absolutePath, sessionId: "term-a", observedAt: 1, association: "unique-cwd-match" },
          { rootPath: change.rootPath, filePath: change.absolutePath, sessionId: "term-b", observedAt: 2, association: "unique-cwd-match" },
        ],
        [...sessions],
      )[0].agents,
    ).toEqual([]);
  });
});
