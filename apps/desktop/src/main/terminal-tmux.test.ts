import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { terminalRenderStabilityBody, terminalRenderStabilityIssues } from "../../tests/terminalRenderStability";

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
    const panes = parseTmuxPaneList("exo-a\t@1\t%2\t0\t120\t32\t118\t31\tzsh\t/tmp/work\nexo-b\t@3\t%4\t1\t80\t24\t\t\tclaude\t/tmp/other\n");

    expect(panes).toEqual([
      {
        sessionName: "exo-a",
        windowId: "@1",
        paneId: "%2",
        dead: false,
        width: 120,
        height: 32,
        clientWidth: 118,
        clientHeight: 31,
        currentCommand: "zsh",
        currentPath: "/tmp/work",
      },
      {
        sessionName: "exo-b",
        windowId: "@3",
        paneId: "%4",
        dead: true,
        width: 80,
        height: 24,
        clientWidth: undefined,
        clientHeight: undefined,
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
      ["-u", "display-message", "-p", "hello"],
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
    expect(decodeTmuxControlValue("\\342\\224\\200\\342\\224\\200 \\360\\237\\231\\202")).toBe("── 🙂");
    expect(decodeTmuxControlValue("literal ─ 🙂")).toBe("literal ─ 🙂");
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
    fake.emitStdout("%output %3 \\342\\224\\200\\342\\224\\200 \\360\\237\\231\\202\\015\\012\n");

    expect(received).toEqual(["hello\r\n", "── 🙂\r\n"]);
    expect(fake.stdinWrites.slice(0, 2)).toEqual([
      "resize-window -t exo-session -x 100 -y 30\n",
      "refresh-client -C 100x30\n",
    ]);
  });

  it("preserves UTF-8 glyphs when tmux splits escaped bytes across output records and stdout chunks", () => {
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

    fake.emitStdout("%output %2 \\342\\224\n");
    fake.emitStdout("%output %3 Claude ");
    fake.emitStdout("\\342\\224\n");
    fake.emitStdout("%output %2 \\200 ignored\\015\\012\n");
    fake.emitStdout("%output %3 \\200");
    fake.emitStdout("\\342\\224\\202 ");
    fake.emitStdout("\\360\n");
    fake.emitStdout("%output %3 \\237\\231\n");
    fake.emitStdout("%output %3 \\202 prompt\\015\\012\n");

    expect(received.join("")).toBe("Claude ─│ 🙂 prompt\r\n");
    expect(received.join("")).not.toContain("�");
  });

  it("preserves literal UTF-8 glyphs split across stdout byte chunks", () => {
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

    const line = Buffer.from("%output %3 literal ─ 🙂 prompt\\015\\012\n", "utf8");
    fake.emitStdoutBytes(line.subarray(0, 20));
    fake.emitStdoutBytes(line.subarray(20, 23));
    fake.emitStdoutBytes(line.subarray(23));

    expect(received.join("")).toBe("literal ─ 🙂 prompt\r\n");
    expect(received.join("")).not.toContain("�");
  });

  it("preserves the terminal render-stability corpus across tmux output records", () => {
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

    const renderStabilityOutput = terminalRenderStabilityBody();
    const encoded = tmuxControlEncode(renderStabilityOutput);

    for (const part of splitControlValue(encoded, [11, 5, 1, 19, 7, 2, 23, 3])) {
      fake.emitStdout(`%output %3 ${part}\n`);
    }

    const decoded = received.join("");
    expect(decoded).toBe(renderStabilityOutput);
    expect(terminalRenderStabilityIssues(decoded, { requireExpectedFragments: true })).toEqual([]);
  });

  it("maps terminal input to tmux keys without treating escape sequences as text", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("hello world\u001b[A\u007f\r");

    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(inputWrites(fake)).toEqual([
      sendHexCommand("hello world"),
      "send-keys -t %3 Up\n",
      "send-keys -t %3 BSpace\n",
      "send-keys -t %3 Enter\n",
    ]);
  });

  it("passes unknown escape sequences through as literal bytes instead of shredding them into typed text", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("a\u001b[15~b\u001bb\u001b]1337;SetMark\u0007c\u001b");

    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(inputWrites(fake)).toEqual([
      sendHexCommand("a\u001b[15~b\u001bb\u001b]1337;SetMark\u0007c"),
      "send-keys -t %3 Escape\n",
    ]);
  });

  it("keeps whitespace, Unicode, backspace, delete, and modifier keys on the tmux send-keys path", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("  λ🙂\t\u007f\u001b[3~\u001b[1;5D\u001b[1;2C");

    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(inputWrites(fake)).toEqual([
      sendHexCommand("  λ🙂\t"),
      "send-keys -t %3 BSpace\n",
      "send-keys -t %3 Delete\n",
      "send-keys -t %3 C-Left\n",
      "send-keys -t %3 S-Right\n",
    ]);
  });

  it("retries and degrades input without detaching the output bridge when control stdin write fails", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);
    const exits: Array<{ exitCode?: number }> = [];
    const inputFailures: Array<{ reason: string; command: string }> = [];

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });
    process.onExit((event) => exits.push(event));
    process.onInputDegraded((event) => inputFailures.push(event));
    fake.failInputWritesAfterResize(() => {
      throw new Error("no server running");
    });

    expect(() => process.write("abc")).not.toThrow();
    process.write("def");

    expect(exits).toEqual([]);
    expect(inputFailures).toEqual([{ reason: "no server running", command: "tmux control stdin write" }]);
    expect(fake.child.kill).not.toHaveBeenCalled();
    expect(fake.stdinWrites).toEqual([
      "resize-window -t exo-session -x 100 -y 30\n",
      "refresh-client -C 100x30\n",
    ]);
    expect(process.inputDiagnostics()).toMatchObject({
      degraded: true,
      commandCount: 0,
      latestWriteLatencyMs: null,
      spikeBaselineP50Ms: 25,
    });
  });

  it("pastes semantic agent messages as literal text", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

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

    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(inputWrites(fake)).toEqual([sendHexCommand("\u001b[200~line one\n  line two\u001b[201~")]);
  });

  it("can paste bracketed content embedded between ordinary typed literals", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("prefix \u001b[200~line one\n  line two\u001b[201~ suffix");

    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(inputWrites(fake)).toEqual([
      sendHexCommand("prefix "),
      sendHexCommand("\u001b[200~line one\n  line two\u001b[201~"),
      sendHexCommand(" suffix"),
    ]);
  });

  it("records stdin write latency diagnostics for successful input commands", () => {
    const fake = fakeControlProcess();
    childProcess.spawn.mockReturnValue(fake.child);

    const process = new TmuxControlModeProcess({
      tmuxPath: "/opt/homebrew/bin/tmux",
      sessionName: "exo-session",
      paneId: "%3",
      cwd: "/tmp/work",
      env: { PATH: "/bin" },
      cols: 100,
      rows: 30,
    });

    process.write("a\u001b[A");

    expect(process.inputDiagnostics()).toMatchObject({
      degraded: false,
      commandCount: 2,
      spikeBaselineP50Ms: 25,
    });
    expect(process.inputDiagnostics().latestWriteLatencyMs).toEqual(expect.any(Number));
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
  const stdoutDecoder = new StringDecoder("utf8");
  const stdinWrites: string[] = [];
  let inputWriteFailure: (() => void) | null = null;
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    writable: true,
    write: (data: string) => {
      if (inputWriteFailure) {
        inputWriteFailure();
      }
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
    failInputWritesAfterResize: (failure: () => void) => {
      inputWriteFailure = failure;
    },
    emitStdout: (data: string) => stdout.emit("data", data),
    emitStdoutBytes: (data: Buffer) => {
      const decoded = stdoutDecoder.write(data);
      if (decoded.length > 0) {
        stdout.emit("data", decoded);
      }
    },
  };
}

function inputWrites(fake: ReturnType<typeof fakeControlProcess>): string[] {
  return fake.stdinWrites.slice(2);
}

function sendHexCommand(data: string): string {
  return `send-keys -H -t %3 -- ${Array.from(Buffer.from(data, "utf8"), (byte) => byte.toString(16).padStart(2, "0")).join(" ")}\n`;
}

function tmuxControlEncode(data: string): string {
  return Array.from(Buffer.from(data, "utf8"))
    .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
    .join("");
}

function splitControlValue(value: string, pattern: number[]): string[] {
  const chunks: string[] = [];
  let offset = 0;
  let patternIndex = 0;
  while (offset < value.length) {
    const byteCount = pattern[patternIndex % pattern.length] ?? 1;
    const length = byteCount * 4;
    chunks.push(value.slice(offset, offset + length));
    offset += length;
    patternIndex += 1;
  }
  return chunks;
}
