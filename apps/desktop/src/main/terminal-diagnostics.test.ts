import { describe, expect, it } from "vitest";

import { terminalDiagnosticsFromRecord } from "./terminal-diagnostics";

describe("terminal diagnostics", () => {
  it("reports the direct-pty lifecycle without an attach or transcript surface", () => {
    const diagnostics = terminalDiagnosticsFromRecord({
      info: {
        id: "term-1",
        title: "Shell",
        cwd: "/workspace",
        terminalKind: "shell",
        harnessId: null,
        kind: "shell",
        command: "/bin/sh",
        instructionOverlayPath: null,
        status: "running",
        readiness: "ready",
        queuedInputCount: 0,
        attachGeneration: 1,
      },
      kind: "shell",
      status: "running",
      health: "healthy",
      healthDetail: "Terminal pty is running.",
      runtime: "pty",
      cwd: "/workspace",
      title: "Shell",
      command: "/bin/sh",
      bufferedLines: 0,
      bufferedChars: 0,
      lastWriteId: 0,
      now: Date.now(),
    });

    expect(diagnostics).toMatchObject({
      runtime: "pty",
      tmuxSessionName: undefined,
      tmuxPaneId: null,
      safeAttachCommand: "",
      transcriptPath: undefined,
    });
  });
});
