import { describe, expect, it } from "vitest";
import { normalizeWorkspaceSettings } from "@exograph/core";

import { resolveSettingsTerminalRuntime } from "./workspaceSettingsModel";

class WorkspaceSettingsStore {
  constructor(_options: object) {}
  normalize = normalizeWorkspaceSettings;
}

describe("workspace terminal settings", () => {
  it("keeps terminal runtime bounds out of persisted settings", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exograph-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exograph-test/workspace",
      defaultTerminalCwd: "/tmp/exograph-test/workspace",
      noteRoots: ["/tmp/exograph-test/workspace/notes"],
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

  it("rejects retired terminal tuning instead of applying internal defaults to it", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exograph-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exograph-test/workspace",
      defaultTerminalCwd: "/tmp/exograph-test/workspace",
      noteRoots: ["/tmp/exograph-test/workspace/notes"],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryLines: 24_000,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 30,
    });

    expect(settings).toBeNull();
  });
});
