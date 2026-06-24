import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { TmuxTerminalRuntime } from "./terminal-runtime-tmux";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv("EXO_TMUX_PATH", "/custom/tmux");
  childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "tmux 3.5a\n", stderr: "" });
});

describe("TmuxTerminalRuntime", () => {
  it("caches tmux detection across runtime calls", () => {
    childProcess.execFileSync.mockReturnValue("");
    const runtime = new TmuxTerminalRuntime();

    expect(runtime.availability()).toEqual({ available: true });
    expect(runtime.listPanes()).toEqual([]);
    expect(runtime.captureTail({
      sessionName: "exo-test",
      paneId: "%1",
      historyLimit: 500,
    })).toBe("");

    expect(childProcess.spawnSync).toHaveBeenCalledTimes(1);
    expect(childProcess.spawnSync).toHaveBeenCalledWith("/custom/tmux", ["-V"], { encoding: "utf8" });
  });

  it("refreshes tmux detection when EXO_TMUX_PATH changes", () => {
    const runtime = new TmuxTerminalRuntime();

    expect(runtime.availability()).toEqual({ available: true });
    vi.stubEnv("EXO_TMUX_PATH", "/other/tmux");
    expect(runtime.availability()).toEqual({ available: true });

    expect(childProcess.spawnSync).toHaveBeenCalledTimes(2);
    expect(childProcess.spawnSync.mock.calls.map((call) => call[0])).toEqual(["/custom/tmux", "/other/tmux"]);
  });

  it("continues terminal creation when tmux session options fail", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let createdSessionName = "";
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("new-session")) {
        createdSessionName = args[args.indexOf("-s") + 1] ?? "";
        return "";
      }
      if (args.includes("set-option")) {
        throw new Error("unsupported option");
      }
      if (args.includes("list-panes")) {
        return `${createdSessionName}\t@1\t%1\t0\tzsh\t/tmp/workspace\n`;
      }
      return "";
    });
    childProcess.spawn.mockReturnValue(fakeControlProcess());

    const runtime = new TmuxTerminalRuntime();
    const session = runtime.createSession({
      sessionToken: "term-1",
      workspaceRoot: "/tmp/workspace",
      command: "/bin/zsh",
      args: [],
      cwd: "/tmp/workspace",
      env: {},
      cols: 80,
      rows: 24,
      historyLimit: 500,
    });

    expect(session).toMatchObject({
      sessionName: createdSessionName,
      paneId: "%1",
    });
    expect(childProcess.spawn).toHaveBeenCalledWith("/custom/tmux", ["-u", "-C", "attach-session", "-t", createdSessionName], expect.any(Object));
    expect(childProcess.execFileSync.mock.calls.map((call) => call[1] as string[])).not.toContainEqual(expect.arrayContaining(["kill-session"]));
    expect(warnSpy).toHaveBeenCalledWith(
      "[exo] failed to set tmux session option",
      expect.objectContaining({
        sessionName: createdSessionName,
        option: "history-limit",
      }),
    );
    warnSpy.mockRestore();
  });

  it("cleans up a created tmux session when pane discovery fails", () => {
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        return "";
      }
      return "";
    });

    const runtime = new TmuxTerminalRuntime();

    expect(() =>
      runtime.createSession({
        sessionToken: "term-1",
        workspaceRoot: "/tmp/workspace",
        command: "/bin/zsh",
        args: [],
        cwd: "/tmp/workspace",
        env: {},
        cols: 80,
        rows: 24,
        historyLimit: 500,
      }),
    ).toThrow(/Unable to find live tmux pane/);

    const tmuxArgs = childProcess.execFileSync.mock.calls.map((call) => call[1] as string[]);
    expect(tmuxArgs[0]).toEqual(expect.arrayContaining(["new-session"]));
    expect(tmuxArgs).toContainEqual(expect.arrayContaining(["list-panes"]));
    expect(tmuxArgs.at(-1)).toEqual(expect.arrayContaining(["kill-session"]));
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

function fakeControlProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: { writable: boolean; write: (data: string) => void };
    kill: () => void;
  };
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    writable: true,
    write: vi.fn(),
  };
  child.kill = vi.fn(() => child.emit("exit", 0));
  return child;
}
