import { describe, expect, it } from "vitest";

import type { TerminalSessionInfo } from "../shared/api";
import {
  initialHarnessReadiness,
  observeHarnessReadiness,
  semanticMessageWrite,
  shouldQueueRawWrite,
  shouldQueueSemanticMessage,
} from "./terminal-harness-readiness";

describe("terminal harness readiness", () => {
  it("gates Codex startup while other harnesses start ready", () => {
    expect(initialHarnessReadiness("codex")).toBe("starting");
    expect(initialHarnessReadiness("claude")).toBe("ready");
    expect(initialHarnessReadiness("shell")).toBe("ready");
  });

  it("keeps Codex semantic sends queued until chat input is ready", () => {
    const info = terminalInfo({ kind: "codex", readiness: "starting" });

    expect(shouldQueueSemanticMessage(info, true)).toBe(true);
    expect(shouldQueueSemanticMessage(info, false)).toBe(false);
    expect(shouldQueueRawWrite(info, "work on this\r")).toBe(true);
    expect(shouldQueueRawWrite(info, "\u0003")).toBe(false);

    expect(observeHarnessReadiness(info, "OpenAI Codex\n› ")).toMatchObject({
      readiness: "ready",
      readinessDetail: "Codex chat input is ready.",
      flushQueued: true,
      clearTimer: true,
    });
  });

  it("keeps queued Codex sends blocked at trust and update prompts", () => {
    const info = terminalInfo({ kind: "codex", readiness: "starting" });

    expect(observeHarnessReadiness(info, "Do you trust the files in this folder?")).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup trust prompt is waiting for interactive confirmation.",
      flushQueued: false,
      clearTimer: true,
    });
    expect(observeHarnessReadiness(info, "OpenAI Codex\nUpdate available!\n3. Skip until next version")).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      flushQueued: false,
      clearTimer: true,
    });
  });

  it("uses bracketed paste for agent messages and plain text for shell messages", () => {
    expect(semanticMessageWrite("shell", "echo hello")).toBe("echo hello");
    expect(semanticMessageWrite("claude", "line 1\nline 2")).toBe("\x1b[200~line 1\nline 2\x1b[201~");
  });
});

function terminalInfo(overrides: Partial<TerminalSessionInfo>): TerminalSessionInfo {
  return {
    id: "term-1",
    title: "Codex",
    cwd: "/workspace",
    terminalKind: "agent",
    harnessId: "codex",
    kind: "codex",
    command: "codex",
    status: "running",
    readiness: "ready",
    queuedInputCount: 0,
    attachGeneration: 1,
    ...overrides,
  };
}
