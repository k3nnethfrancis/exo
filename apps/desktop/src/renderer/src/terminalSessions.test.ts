import { describe, expect, it } from "vitest";
import type { TerminalSessionInfo } from "../../shared/api";

import { isTerminalInputEnabled, summarizeTerminalStatusLine, terminalSessionsEqual } from "./terminalSessions";

function terminalSessionFixture(overrides: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    id: "term-a",
    title: "Terminal",
    cwd: "/workspace",
    kind: "shell",
    command: "zsh",
    status: "running",
    health: "idle",
    healthDetail: "No recent terminal output; terminal may simply be waiting for input.",
    attachGeneration: 1,
    ...overrides,
  };
}

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
        attachGeneration: 1,
      },
    ] as const;

    expect(terminalSessionsEqual([...sessions], [...sessions])).toBe(true);
    expect(terminalSessionsEqual([...sessions], [{ ...sessions[0], healthDetail: "stale output" }])).toBe(false);
  });

  it("blocks terminal input while a running session is unhealthy", () => {
    const unhealthySession = {
      id: "term-a",
      title: "Terminal",
      cwd: "/workspace",
      kind: "shell",
      command: "zsh",
      status: "running",
      health: "unhealthy",
      healthDetail: "Terminal process is unavailable.",
      attachGeneration: 1,
    } as const;

    expect(isTerminalInputEnabled(unhealthySession)).toBe(false);
    expect(isTerminalInputEnabled({ ...unhealthySession, health: "idle" })).toBe(true);
    expect(isTerminalInputEnabled({ ...unhealthySession, status: "exited", health: "exited" })).toBe(false);
  });

  it("summarizes exited terminal state for the bottom status bar", () => {
    const sessions = [
      terminalSessionFixture({
        id: "term-codex",
        title: "Codex",
        status: "exited",
        health: "exited",
        healthDetail: "Process exited.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-codex", new Set())).toEqual({
      label: "Terminal exited",
      tone: "warn",
      title: "Codex: Process exited.",
      busy: false,
      sessionId: "term-codex",
    });
  });

  it("prioritizes terminal loading state without requiring a floating overlay", () => {
    const sessions = [
      terminalSessionFixture({ id: "term-shell", title: "Shell" }),
      terminalSessionFixture({
        id: "term-codex",
        title: "Codex",
        status: "exited",
        health: "exited",
        healthDetail: "Process exited.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-shell", new Set(["term-shell"]))).toEqual({
      label: "Loading terminal",
      tone: "info",
      title: "Shell: loading terminal output.",
      busy: true,
      sessionId: "term-shell",
    });
    expect(summarizeTerminalStatusLine([sessions[0]], "term-shell", new Set())).toBeNull();
  });

  it("does not let stale terminal hydration mask an unavailable session", () => {
    const sessions = [
      terminalSessionFixture({
        id: "term-shell",
        title: "Shell",
        status: "running",
        health: "unhealthy",
        healthDetail: "Unable to find live tmux pane.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-shell", new Set(["term-shell"]))).toEqual({
      label: "Terminal unavailable",
      tone: "error",
      title: "Shell: Unable to find live tmux pane.",
      busy: false,
      sessionId: "term-shell",
    });
  });
});
