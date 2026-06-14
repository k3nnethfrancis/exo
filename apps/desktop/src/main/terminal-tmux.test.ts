import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import {
  detectTmux,
  exoTmuxSessionName,
  parseTmuxPaneList,
  shellCommand,
  shellQuote,
  TmuxCommandError,
  TmuxCommandRunner,
  tmuxEnvironmentArgs,
} from "./terminal-tmux";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("terminal tmux runtime helpers", () => {
  it("detects tmux through EXO_TMUX_PATH first", () => {
    childProcess.spawnSync.mockImplementation((command: string) => ({
      status: command === "/custom/tmux" ? 0 : 1,
      stdout: command === "/custom/tmux" ? "tmux 3.5a\n" : "",
      stderr: "",
    }));

    expect(detectTmux({ EXO_TMUX_PATH: "/custom/tmux" })).toEqual({
      available: true,
      path: "/custom/tmux",
      version: "tmux 3.5a",
    });
    expect(childProcess.spawnSync.mock.calls[0]?.[0]).toBe("/custom/tmux");
    expect(childProcess.spawnSync.mock.calls[0]?.[1]).toEqual(["-V"]);
  });

  it("reports actionable missing tmux details", () => {
    childProcess.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

    const availability = detectTmux({});

    expect(availability).toMatchObject({
      available: false,
      reason: expect.stringContaining("Install tmux"),
    });
    expect(availability.available ? [] : availability.attempted).toContain("tmux");
  });

  it("creates stable sanitized Exo tmux session names", () => {
    expect(exoTmuxSessionName("term-12", "/Users/kenneth/Desktop/lab")).toMatch(/^exo-[a-f0-9]{10}-term-12$/);
    expect(exoTmuxSessionName("term weird/12", "/workspace")).not.toContain("/");
    expect(exoTmuxSessionName("term-1-2026-06-14T20:58:49.167Z", "/workspace")).not.toContain(".");
    expect(exoTmuxSessionName("term-12", "/workspace")).toBe(exoTmuxSessionName("term-12", "/workspace"));
  });

  it("parses tmux pane list output", () => {
    const panes = parseTmuxPaneList("exo-a\t@1\t%2\t0\tzsh\t/tmp/work\nexo-b\t@3\t%4\t1\tclaude\t/tmp/other\n");

    expect(panes).toEqual([
      {
        sessionName: "exo-a",
        windowId: "@1",
        paneId: "%2",
        dead: false,
        currentCommand: "zsh",
        currentPath: "/tmp/work",
      },
      {
        sessionName: "exo-b",
        windowId: "@3",
        paneId: "%4",
        dead: true,
        currentCommand: "claude",
        currentPath: "/tmp/other",
      },
    ]);
  });

  it("wraps tmux command failures with command context", () => {
    childProcess.execFileSync.mockImplementation(() => {
      const error = new Error("failed") as Error & { stderr: Buffer };
      error.stderr = Buffer.from("no server running");
      throw error;
    });

    const runner = new TmuxCommandRunner("/opt/homebrew/bin/tmux");

    expect(() => runner.run(["list-sessions"])).toThrow(TmuxCommandError);
    try {
      runner.run(["list-sessions"]);
    } catch (error) {
      expect(error).toMatchObject({
        command: "/opt/homebrew/bin/tmux",
        args: ["list-sessions"],
        stderr: "no server running",
      });
    }
  });

  it("passes cwd and env to tmux command execution", () => {
    childProcess.execFileSync.mockReturnValue("ok");

    const runner = new TmuxCommandRunner("/opt/homebrew/bin/tmux");
    expect(runner.run(["display-message", "-p", "hello"], { cwd: "/tmp/work", env: { PATH: "/bin" } })).toBe("ok");

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      "/opt/homebrew/bin/tmux",
      ["display-message", "-p", "hello"],
      expect.objectContaining({
        cwd: "/tmp/work",
        env: { PATH: "/bin" },
      }),
    );
  });

  it("builds tmux environment args from valid variables", () => {
    expect(
      tmuxEnvironmentArgs({
        TERM: "xterm-256color",
        "BAD-NAME": "nope",
        EMPTY: "",
        UNSET: undefined,
      }),
    ).toEqual(["-e", "TERM=xterm-256color", "-e", "EMPTY="]);
  });

  it("quotes shell commands safely for tmux new-session", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("has ' quote")).toBe("'has '\\'' quote'");
    expect(shellCommand("node", ["/tmp/fake agent.mjs", "--name='Claude'"])).toBe("'node' '/tmp/fake agent.mjs' '--name='\\''Claude'\\'''");
  });
});
