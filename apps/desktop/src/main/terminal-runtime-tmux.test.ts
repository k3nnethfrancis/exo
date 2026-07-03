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
    expect(runtime.captureTailForDisplay({
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
    const tmuxArgs = childProcess.execFileSync.mock.calls.map((call) => call[1] as string[]);
    expect(tmuxArgs[0]).toEqual(expect.arrayContaining(["new-session", "-x", "80", "-y", "24"]));
    expect(tmuxArgs).toContainEqual(["-u", "resize-window", "-t", createdSessionName, "-x", "80", "-y", "24"]);
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

  it("resizes the detached tmux window before control-mode attach", () => {
    childProcess.execFileSync.mockReturnValue("");
    childProcess.spawn.mockReturnValue(fakeControlProcess());

    const runtime = new TmuxTerminalRuntime();
    runtime.attachSession({
      sessionName: "exo-existing",
      paneId: "%3",
      cwd: "/tmp/workspace",
      env: { PATH: "/bin" },
      cols: 181.9,
      rows: 47.2,
    });

    const resizeOrder = childProcess.execFileSync.mock.invocationCallOrder[0];
    const attachOrder = childProcess.spawn.mock.invocationCallOrder[0];
    expect(resizeOrder).toBeLessThan(attachOrder);
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      "/custom/tmux",
      ["-u", "resize-window", "-t", "exo-existing", "-x", "181", "-y", "47"],
      expect.objectContaining({
        cwd: "/tmp/workspace",
        env: { PATH: "/bin" },
      }),
    );
    expect(childProcess.spawn).toHaveBeenCalledWith("/custom/tmux", ["-u", "-C", "attach-session", "-t", "exo-existing"], expect.any(Object));
  });

  it("captures restore snapshots byte-faithfully and appends cursor position in the same string", () => {
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("display-message")) {
        return "181	47	0	default	2	4\n";
      }
      if (args.includes("capture-pane")) {
        return "line with trailing spaces   \n\n";
      }
      return "";
    });

    const runtime = new TmuxTerminalRuntime();
    const snapshot = runtime.captureRestoreSnapshot({
      sessionName: "exo-existing",
      paneId: "%3",
      historyLimit: 500,
      liveScrollbackLines: 80,
    });

    expect(snapshot).toEqual({
      content: "line with trailing spaces   \n\n\x1b[5;3H",
      cols: 181,
      rows: 47,
      altScreen: false,
    });
    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      "/custom/tmux",
      ["-u", "capture-pane", "-e", "-p", "-J", "-t", "%3", "-S", "-80"],
      expect.any(Object),
    );
  });

  it("skips restore content for alternate-screen panes", () => {
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("display-message")) {
        return "120	32	1	default	0	0\n";
      }
      if (args.includes("capture-pane")) {
        throw new Error("alternate screen should not be captured");
      }
      return "";
    });

    const runtime = new TmuxTerminalRuntime();

    expect(runtime.captureRestoreSnapshot({
      sessionName: "exo-existing",
      paneId: "%3",
      historyLimit: 500,
      liveScrollbackLines: 500,
    })).toEqual({
      content: "",
      cols: 120,
      rows: 32,
      altScreen: true,
    });
    expect(childProcess.execFileSync.mock.calls.map((call) => call[1] as string[]).some((args) => args.includes("capture-pane"))).toBe(false);
  });

  it("keeps tmux virtual right-edge cursor state usable for restore snapshots", () => {
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("display-message")) {
        return "120	32	0	default	120	5\n";
      }
      if (args.includes("capture-pane")) {
        return "full-width-final-line";
      }
      return "";
    });

    const runtime = new TmuxTerminalRuntime();

    expect(runtime.captureRestoreSnapshot({
      sessionName: "exo-existing",
      paneId: "%3",
      historyLimit: 500,
      liveScrollbackLines: 500,
    }).content).toBe("full-width-final-line\x1b[3;120H");
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
