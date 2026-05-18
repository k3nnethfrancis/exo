import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_STREAMING_MODE,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "../../main/settings-store";
import { isTerminalGeneratedResponse } from "./components/terminalInputFilters";

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
    expect(settings?.terminalStreamingMode).toBe(DEFAULT_TERMINAL_STREAMING_MODE);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalScrollbackLines")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalBufferChars")).toBe(false);
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toMatchObject({
      bufferLineLimit: null,
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
      terminalStreamingMode: "paused",
    });

    expect(settings?.terminalHistoryMode).toBe("custom");
    expect(settings?.terminalHistoryLines).toBe(24_000);
    expect(settings?.terminalTranscriptRetention).toBe("days");
    expect(settings?.terminalTranscriptRetentionDays).toBe(30);
    expect(settings?.terminalStreamingMode).toBe("paused");
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toEqual({
      scrollbackLines: 24_000,
      bufferLineLimit: 24_000,
      transcriptRetentionDays: 30,
    });
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
