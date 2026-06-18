import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
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
  TmuxControlModeProcess,
  TmuxCommandRunner,
  decodeTmuxControlValue,
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

  it("decodes tmux control output escapes", () => {
    expect(decodeTmuxControlValue("hello\\015\\012path\\\\name")).toBe("hello\r\npath\\name");
  });

  it("streams only the selected pane from tmux control mode", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);
    const received: string[] = [];

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });
    process.onData((data) => received.push(data));

    fake.emitStdout("%output %2 ignored\\015\\012\n");
    fake.emitStdout("%output %3 hello\\015\\012\n");

    expect(received).toEqual(["hello\r\n"]);
    expect(fake.stdinWrites).toContain("refresh-client -C 100x30\n");
  });

  it("maps terminal input to tmux keys without treating escape sequences as text", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);
    childProcess.execFileSync.mockReturnValue("");

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("abc\u001b[A\u007f\r");

    expect(childProcess.execFileSync.mock.calls.map((call) => call[1])).toEqual([
      ["send-keys", "-t", "%3", "-l", "abc"],
      ["send-keys", "-t", "%3", "Up"],
      ["send-keys", "-t", "%3", "BSpace"],
      ["send-keys", "-t", "%3", "Enter"],
    ]);
  });

  it("pastes semantic agent messages as literal text", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);
    childProcess.execFileSync.mockReturnValue("");

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("\u001b[200~line one\n  line two\u001b[201~");

    expect(childProcess.execFileSync.mock.calls.map((call) => call[1])).toContainEqual(["load-buffer", "-b", "exo-3", "-"]);
    expect(childProcess.execFileSync.mock.calls.find((call) => call[1]?.includes("load-buffer"))?.[2]).toMatchObject({ input: "line one\n  line two" });
    expect(childProcess.execFileSync.mock.calls.map((call) => call[1])).toContainEqual(["paste-buffer", "-b", "exo-3", "-t", "%3", "-d"]);
  });
});

function fakeControlProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: { writable: boolean; write: (data: string) => void };
    killed: boolean;
    kill: () => void;
  };
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  const stdinWrites: string[] = [];
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    writable: true,
    write: (data: string) => {
      stdinWrites.push(data);
    },
  };
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.emit("exit", 0);
  });

  return {
    child,
    stdinWrites,
    emitStdout: (data: string) => stdout.emit("data", data),
  };
}
