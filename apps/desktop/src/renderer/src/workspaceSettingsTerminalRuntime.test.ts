import { describe, expect, it } from "vitest";
import { normalizeWorkspaceSettings } from "@exo/core";

import { resolveSettingsTerminalRuntime } from "./workspaceSettingsModel";

class WorkspaceSettingsStore {
  constructor(_options: object) {}
  normalize = normalizeWorkspaceSettings;
}

describe("workspace terminal settings", () => {
  it("keeps terminal runtime bounds out of persisted settings", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    expect(settings).not.toBeNull();
    expect(resolveSettingsTerminalRuntime(settings!)).toMatchObject({
      scrollbackLines: 100_000,
      readTailChars: 20_000,
    });
    for (const key of ["terminalHistoryLines", "terminalTranscriptRetention", "terminalTranscriptRetentionDays", "terminalStreamingMode", "terminalAgentTransport", "terminalScrollbackLines", "terminalBufferChars"]) {
      expect(settings).not.toHaveProperty(key);
    }
  });

  it("drops retired terminal tuning without changing internal runtime defaults", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryLines: 24_000,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 30,
    });

    expect(settings).not.toBeNull();
    expect(resolveSettingsTerminalRuntime(settings!)).toMatchObject({
      scrollbackLines: 100_000,
      readTailChars: 20_000,
    });
    for (const key of ["terminalHistoryLines", "terminalTranscriptRetention", "terminalTranscriptRetentionDays"]) {
      expect(settings).not.toHaveProperty(key);
    }
  });
});
