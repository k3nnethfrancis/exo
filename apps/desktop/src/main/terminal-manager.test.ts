import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ptyState = vi.hoisted(() => ({
  spawned: [] as Array<{
    command: string;
    args: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    writes: string[];
    stdinWrites: string[];
    emitData: (data: string) => void;
    emitExit: (exitCode?: number) => void;
    resize: () => void;
  }>,
  tmuxSessions: [] as Array<{ sessionName: string; paneId: string; cwd: string }>,
  pasteBuffers: new Map<string, string>(),
}));

const childProcess = vi.hoisted(() => {
  function findAttachedProcess(paneId: string) {
    return ptyState.spawned.find((process) => process.args.includes("-t") && ptyState.tmuxSessions.some((session) => session.sessionName === process.args.at(-1) && session.paneId === paneId));
  }

  function execFileSync(_command: string, args: string[], options?: { input?: string }) {
    if (args.includes("new-session")) {
      const sessionName = args[args.indexOf("-s") + 1] ?? `exo-test-${ptyState.tmuxSessions.length + 1}`;
      const cwd = args[args.indexOf("-c") + 1] ?? "";
      ptyState.tmuxSessions.push({
        sessionName,
        paneId: `%${ptyState.tmuxSessions.length + 1}`,
        cwd,
      });
      return "";
    }
    if (args.includes("list-panes")) {
      return ptyState.tmuxSessions.map((session) => `${session.sessionName}\t@1\t${session.paneId}\t0\tzsh\t${session.cwd}`).join("\n");
    }
    if (args.includes("send-keys")) {
      const paneId = args[args.indexOf("-t") + 1] ?? "";
      const process = findAttachedProcess(paneId);
      if (process) {
        const payload = args.at(-1) ?? "";
        if (args.includes("-l")) {
          process.writes.push(payload);
        } else if (payload === "Enter") {
          process.writes.push("\r");
        } else {
          process.writes.push(payload);
        }
      }
      return "";
    }
    if (args.includes("load-buffer")) {
      const bufferName = args[args.indexOf("-b") + 1] ?? "";
      ptyState.pasteBuffers.set(bufferName, options?.input ?? "");
      return "";
    }
    if (args.includes("paste-buffer")) {
      const paneId = args[args.indexOf("-t") + 1] ?? "";
      const bufferName = args[args.indexOf("-b") + 1] ?? "";
      const process = findAttachedProcess(paneId);
      if (process) {
        process.writes.push(ptyState.pasteBuffers.get(bufferName) ?? "");
      }
      return "";
    }
    if (args.includes("kill-session")) {
      const sessionName = args[args.indexOf("-t") + 1] ?? "";
      const index = ptyState.tmuxSessions.findIndex((session) => session.sessionName === sessionName);
      if (index >= 0) {
        ptyState.tmuxSessions.splice(index, 1);
      }
      return "";
    }
    return "";
  }

  function spawn(command: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined> }) {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: (encoding: string) => void };
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdin: { writable: boolean; write: (data: string) => void };
      killed: boolean;
      kill: () => void;
    };
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    const state = {
      command,
      args,
      options,
      writes: [] as string[],
      stdinWrites: [] as string[],
      emitData: (data: string) => stdout.emit("data", `%output ${paneIdForSession(args.at(-1) ?? "")} ${tmuxControlEncode(data)}\n`),
      emitExit: (exitCode?: number) => child.emit("exit", exitCode),
      resize: () => {
        child.stdin.write("refresh-client -C 120x32\n");
      },
    };
    stdout.setEncoding = vi.fn();
    stderr.setEncoding = vi.fn();
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      writable: true,
      write: (data: string) => {
        state.stdinWrites.push(data);
      },
    };
    child.killed = false;
    child.kill = vi.fn(() => {
      child.killed = true;
      child.emit("exit", 0);
    });
    ptyState.spawned.push(state);
    return child;
  }

  function paneIdForSession(sessionName: string): string {
    return ptyState.tmuxSessions.find((session) => session.sessionName === sessionName)?.paneId ?? "%1";
  }

  function tmuxControlEncode(data: string): string {
    return data.replace(/[\\\r\n\x1b]/g, (char) => `\\${char.charCodeAt(0).toString(8).padStart(3, "0")}`);
  }

  return {
    spawn,
    spawnSync: vi.fn(() => ({ status: 0, stdout: "tmux 3.5a\n", stderr: "" })),
    execFileSync: vi.fn(execFileSync),
    defaultExecFileSync: execFileSync,
  };
});

vi.mock("node:child_process", () => childProcess);

import { TerminalManager } from "./terminal-manager";
import type { TerminalRuntime, TerminalRuntimeProcess } from "./terminal-runtime";

const tempPaths: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
  vi.clearAllMocks();
  childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "tmux 3.5a\n", stderr: "" });
  childProcess.execFileSync.mockImplementation(childProcess.defaultExecFileSync);
  ptyState.spawned.splice(0);
  ptyState.tmuxSessions.splice(0);
  ptyState.pasteBuffers.clear();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("TerminalManager Codex readiness", () => {
  it("queues submitted Codex task text across startup trust prompts", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    const writeResult = await manager.sendMessage(agent.id, "Fix the issue", true);

    expect(writeResult.delivery).toBe("queued");
    expect(pty.writes).toEqual([]);

    pty.emitData("Do you trust the files in this folder?");
    vi.advanceTimersByTime(2_000);

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "blocked",
      queuedInputCount: 1,
    });
    expect(pty.writes).toEqual([]);

    pty.emitData("\nAsk Codex\n");

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(pty.writes).toEqual(["Fix the issue"]);

    vi.advanceTimersByTime(120);

    expect(pty.writes).toEqual(["Fix the issue", "\r"]);
  });

  it("blocks queued Codex task text across startup update prompts", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.sendMessage(agent.id, "Do useful work", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });

    pty.emitData("Update available! 0.134.0 -> 0.139.0\n1. Update now\n2. Skip\n3. Skip until next version");
    vi.advanceTimersByTime(2_000);

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      queuedInputCount: 1,
    });
    expect(pty.writes).toEqual([]);

    pty.emitData("\nOpenAI Codex\n› ");

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(pty.writes).toEqual(["Do useful work"]);
  });

  it("does not treat a Codex header as ready when a later startup update prompt is active", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.sendMessage(agent.id, "Wait for chat input", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });

    pty.emitData("OpenAI Codex\nUpdate available! 0.134.0 -> 0.139.0\n3. Skip until next version");
    vi.advanceTimersByTime(2_000);

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      queuedInputCount: 1,
    });
    expect(pty.writes).toEqual([]);

    pty.emitData("\nAsk Codex\n› ");

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(pty.writes).toEqual(["Wait for chat input"]);
  });

  it("flushes queued Codex text after the startup grace when no prompt appears", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.sendMessage(agent.id, "Start cleanly", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });

    vi.advanceTimersByTime(1_500);

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(pty.writes).toEqual(["Start cleanly"]);

    vi.advanceTimersByTime(120);

    expect(pty.writes).toEqual(["Start cleanly", "\r"]);
  });

  it("sends semantic messages with bracketed paste to preserve whitespace", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "claude", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const message = "Please keep   spaces.\nAnd newlines.";

    await expect(manager.sendMessage(agent.id, message, true)).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual([message]);
    vi.advanceTimersByTime(120);
    expect(pty.writes).toEqual([message, "\r"]);
  });

  it("sends semantic shell messages as plain text because shells may not support bracketed paste", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const message = "printf 'shell semantic: %s\\n' 'one   two'";

    await expect(manager.sendMessage(terminal.id, message, true)).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual([message]);
    vi.advanceTimersByTime(120);
    expect(pty.writes).toEqual([message, "\r"]);
  });

  it("can paste semantic messages without submitting", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "claude", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const message = "Draft with   spaces\nand a second line.";

    await expect(manager.sendMessage(agent.id, message, false)).resolves.toMatchObject({ delivery: "sent" });

    vi.advanceTimersByTime(500);
    expect(pty.writes).toEqual([message]);
  });

  it("lets raw non-submitted input through so a user can answer interstitials", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.write(agent.id, "y")).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(pty.writes).toEqual(["y"]);
  });

  it("reports missing or exited write targets as not delivered", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await expect(manager.write("missing", "input")).resolves.toEqual({ ok: false, delivery: "not-found" });
    await expect(manager.sendMessage("missing", "input", true)).resolves.toEqual({ ok: false, delivery: "not-found" });

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    ptyState.spawned[0].emitExit(0);

    await expect(manager.write(terminal.id, "input")).resolves.toEqual({ ok: false, delivery: "not-found" });
    await expect(manager.sendMessage(terminal.id, "input", true)).resolves.toEqual({ ok: false, delivery: "not-found" });
  });

  it("preserves alternate-screen escapes while stripping embedded mouse tracking modes", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    pty.emitData("before\x1b[?1000h\x1b[?1049hinside-alt-screen\x1b[?1049l\x1b[?1000lofter");

    expect(manager.readTail(terminal.id)).toBe("before\x1b[?1049hinside-alt-screen\x1b[?1049lofter");
    expect(manager.readTranscript(terminal.id)).toContain("\x1b[?1049hinside-alt-screen\x1b[?1049l");
    expect(manager.readTranscript(terminal.id)).not.toContain("\x1b[?1000h");
  });

  it("uses configured live scrollback lines while transcripts keep receiving data", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = new TerminalManager(workspaceRoot, 500);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const lines = Array.from({ length: 505 }, (_, index) => `line-${index + 1}`);
    const largeChunk = lines.join("\n");

    pty.emitData(largeChunk);

    expect(manager.readTail(terminal.id)).toBe(lines.slice(-500).join("\n"));
    expect(manager.readTranscript(terminal.id)).toContain("line-1");
  });

  it("hydrates bounded terminal tail from tmux history before live attach output", async () => {
    const workspaceRoot = await workspaceFixture();
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("capture-pane")) {
        return "captured-001\ncaptured-002\n";
      }
      return childProcess.defaultExecFileSync(command, args);
    });
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(manager.readTail(terminal.id)).toContain("captured-001\r\ncaptured-002");
    expect(manager.diagnostics()[0]).toMatchObject({
      bufferedLines: 3,
      bufferedChars: "captured-001\r\ncaptured-002\r\n".length,
    });
    expect(manager.readTranscript(terminal.id)).not.toContain("captured-001\r\ncaptured-002");
  });

  it("applies configured live scrollback to tmux history", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = new TerminalManager(workspaceRoot, 24_000);

    await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", spawnedTmuxSessionName(0), "history-limit", "24000"],
      expect.any(Object),
    ]);

    manager.setBufferLineLimit(500);

    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", spawnedTmuxSessionName(0), "history-limit", "500"],
      expect.any(Object),
    ]);
  });

  it("configures embedded tmux sessions without disabling normal terminal capabilities", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });

    const sessionName = spawnedTmuxSessionName(0);
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", sessionName, "status", "off"],
      expect.any(Object),
    ]);
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", sessionName, "mouse", "off"],
      expect.any(Object),
    ]);
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", sessionName, "focus-events", "on"],
      expect.any(Object),
    ]);
    expect(childProcess.execFileSync.mock.calls).not.toContainEqual([
      "tmux",
      ["set-option", "-t", sessionName, "alternate-screen", expect.any(String)],
      expect.any(Object),
    ]);
  });

  it("fails terminal creation clearly when tmux is unavailable", async () => {
    childProcess.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await expect(manager.create({ kind: "shell", cwd: workspaceRoot })).rejects.toThrow("tmux was not found");
    expect(ptyState.spawned).toEqual([]);
  });

  it("terminates the tmux session when killing a terminal", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    await manager.kill(terminal.id);

    const killCommand = childProcess.execFileSync.mock.calls
      .map((call) => call as unknown as [string, string[]])
      .find(([, args]) => args.includes("kill-session"))?.[1];
    if (!killCommand) {
      throw new Error("Expected tmux kill-session command");
    }
    expect(killCommand).toEqual(["kill-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i)]);
    expect(manager.list()).toEqual([]);
  });

  it("persists Exo-to-tmux session mappings when creating terminals", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const registryPath = path.join(workspaceRoot, ".exo", "terminal-sessions.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as { sessions: Array<Record<string, unknown>> };

    expect(registry.sessions).toEqual([
      expect.objectContaining({
        id: terminal.id,
        kind: "shell",
        cwd: workspaceRoot,
        tmuxSessionName: expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i),
        transcriptPath: expect.stringContaining("terminal-transcripts"),
        status: "running",
      }),
    ]);
    expect(registry.sessions[0]?.transcriptPath).toMatch(/term-1-shell-\d{4}-/);
  });

  it("does not reuse terminal display ids across app launches after explicit close", async () => {
    const workspaceRoot = await workspaceFixture();
    const firstManager = managerForWorkspace(workspaceRoot);

    const firstTerminal = await firstManager.create({ kind: "shell", cwd: workspaceRoot });
    await firstManager.kill(firstTerminal.id);
    const firstRegistry = JSON.parse(await readFile(path.join(workspaceRoot, ".exo", "terminal-sessions.json"), "utf8")) as {
      nextId: number;
      sessions: Array<Record<string, string>>;
    };

    const secondManager = managerForWorkspace(workspaceRoot);
    await secondManager.create({ kind: "shell", cwd: workspaceRoot });
    const secondRegistry = JSON.parse(await readFile(path.join(workspaceRoot, ".exo", "terminal-sessions.json"), "utf8")) as {
      nextId: number;
      sessions: Array<Record<string, string>>;
    };

    expect(firstRegistry.nextId).toBe(2);
    expect(firstRegistry.sessions).toEqual([]);
    expect(secondRegistry.sessions[0]?.id).toBe("term-2");
    expect(secondRegistry.nextId).toBe(3);
  });

  it("reattaches persisted running sessions when tmux still has the pane", async () => {
    const workspaceRoot = await workspaceFixture();
    const runtimeRoot = path.join(workspaceRoot, ".exo");
    const tmuxSessionName = "exo-abc1234567-term-7";
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      path.join(runtimeRoot, "terminal-sessions.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "term-7",
            title: "Shell",
            cwd: workspaceRoot,
            kind: "shell",
            command: "/bin/zsh",
            tmuxSessionName,
            transcriptPath: path.join(runtimeRoot, "terminal-transcripts", "term-7-shell.ansi.log"),
            createdAt: new Date().toISOString(),
            lastAttachedAt: null,
            status: "running",
          },
        ],
      }),
    );
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        const generated = childProcess.defaultExecFileSync(command, args);
        return `${tmuxSessionName}\t@1\t%2\t0\tzsh\t${workspaceRoot}\n${generated}`;
      }
      return childProcess.defaultExecFileSync(command, args);
    });

    const manager = managerForWorkspace(workspaceRoot);

    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: "term-7",
        kind: "shell",
        status: "running",
      }),
    ]);
    expect(ptyState.spawned[0]?.command).toBe("tmux");
    expect(ptyState.spawned[0]?.args).toEqual(["-C", "attach-session", "-t", tmuxSessionName]);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    expect(manager.list().map((session) => session.id)).toContain("term-8");
  });

  it("hydrates restored tmux sessions by capturing the live pane id", async () => {
    const workspaceRoot = await workspaceFixture();
    const runtimeRoot = path.join(workspaceRoot, ".exo");
    const tmuxSessionName = "exo-abc1234567-term-7";
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      path.join(runtimeRoot, "terminal-sessions.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "term-7",
            title: "Shell",
            cwd: workspaceRoot,
            kind: "shell",
            command: "/bin/zsh",
            tmuxSessionName,
            transcriptPath: path.join(runtimeRoot, "terminal-transcripts", "term-7-shell.ansi.log"),
            createdAt: new Date().toISOString(),
            lastAttachedAt: null,
            status: "running",
          },
        ],
      }),
    );
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        return `${tmuxSessionName}\t@1\t%2\t0\tzsh\t${workspaceRoot}\n`;
      }
      if (args.includes("capture-pane")) {
        return args[args.indexOf("-t") + 1] === "%2" ? "restored-history-001\nrestored-history-002\n" : "";
      }
      return childProcess.defaultExecFileSync(command, args);
    });

    const manager = managerForWorkspace(workspaceRoot);

    expect(manager.readTail("term-7")).toContain("restored-history-001\r\nrestored-history-002");
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["capture-pane", "-p", "-e", "-t", "%2", "-S", "-100000"],
      expect.any(Object),
    ]);
  });

  it("reports process diagnostics without exposing legacy transport fields", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);

    const [diagnostic] = manager.diagnostics();
    expect(diagnostic).toMatchObject({
      kind: "shell",
      status: "running",
      runtime: "tmux",
      tmuxSessionName: expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i),
      bridgeStatus: "attached",
      paneStatus: "alive",
      command: expect.any(String),
      transcriptPath: expect.stringContaining("terminal-transcripts"),
    });
    expect(diagnostic).not.toHaveProperty("transport");
  });

  it("marks missing tmux sessions as unhealthy in diagnostics", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        return "";
      }
      return "";
    });

    expect(manager.diagnostics()[0]).toMatchObject({
      health: "unhealthy",
      paneStatus: "missing",
      healthDetail: "Tmux session is missing; transcript remains available.",
    });
  });

  it("retains fast-exiting agent sessions with diagnostics until explicit kill", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);
    const exitEvents: Array<{ id: string; exitCode?: number }> = [];
    manager.on("exit", (event) => exitEvents.push(event));

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const transcriptPath = manager.diagnostics()[0]?.transcriptPath;
    ptyState.tmuxSessions.splice(0);
    ptyState.spawned[0].emitExit(1);

    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: agent.id,
        kind: "codex",
        status: "exited",
        exitCode: 1,
        transcriptPath,
        cwd: workspaceRoot,
        command: "codex",
        readiness: "starting",
        health: "exited",
        healthDetail: "Process exited with code 1.",
      }),
    ]);
    expect(manager.diagnostics()).toEqual([
      expect.objectContaining({
        id: agent.id,
        kind: "codex",
        status: "exited",
        exitCode: 1,
        transcriptPath,
        cwd: workspaceRoot,
        command: "codex",
        health: "exited",
        healthDetail: "Process exited with code 1.",
      }),
    ]);
    expect(exitEvents).toEqual([{ id: agent.id, exitCode: 1 }]);

    await manager.kill(agent.id);
    expect(manager.list()).toEqual([]);
  });

  it("handles stale pty resize failures without throwing through IPC", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    const originalStdinWrite = ptyState.spawned[0].stdinWrites.push.bind(ptyState.spawned[0].stdinWrites);
    ptyState.spawned[0].stdinWrites.push = () => {
      throw new Error("ioctl(2) failed, EBADF");
    };

    await expect(manager.resize("term-1", 120, 32)).resolves.toBeUndefined();
    ptyState.spawned[0].stdinWrites.push = originalStdinWrite;
    expect(manager.diagnostics()[0]).toMatchObject({
      health: "unhealthy",
      bridgeStatus: "detached",
    });
  });

  it("reconnects a detached bridge when the tmux pane is still alive", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);
    ptyState.spawned[0].emitExit(1);

    expect(manager.diagnostics()[0]).toMatchObject({
      health: "unhealthy",
      bridgeStatus: "detached",
      paneStatus: "alive",
    });

    await expect(manager.reconnect(terminal.id)).resolves.toMatchObject({
      id: terminal.id,
      status: "running",
    });
    expect(ptyState.spawned).toHaveLength(2);
    expect(ptyState.spawned[1].args).toEqual(["-C", "attach-session", "-t", spawnedTmuxSessionName(0)]);
    expect(manager.diagnostics()[0]).toMatchObject({
      bridgeStatus: "attached",
      paneStatus: "alive",
    });
  });

  it("reattaches live bridges during resume recovery even before they report detached", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);

    manager.reconnectRecoverableTerminals();

    expect(ptyState.spawned).toHaveLength(2);
    expect(ptyState.spawned[1].args).toEqual(["-C", "attach-session", "-t", spawnedTmuxSessionName(0)]);
    expect(manager.diagnostics()[0]).toMatchObject({
      bridgeStatus: "attached",
      paneStatus: "alive",
      health: "idle",
    });
  });

  it("ignores legacy persisted terminal-state files", async () => {
    const workspaceRoot = await workspaceFixture();
    const runtimeRoot = path.join(workspaceRoot, ".exo");
    await mkdir(runtimeRoot, { recursive: true });
    await writeFile(
      path.join(runtimeRoot, "terminal-state.json"),
      JSON.stringify({
        agents: [
          {
            id: "term-legacy",
            kind: "codex",
            cwd: workspaceRoot,
            tmuxSession: "exo-legacy",
            title: "Codex",
            command: "codex",
          },
        ],
      }),
    );

    const manager = managerForWorkspace(workspaceRoot);

    expect(manager.list()).toEqual([]);
    expect(manager.diagnostics()).toEqual([]);
  });

  it("launches Codex with an explicit Exo MCP config for the current checkout", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "codex", cwd: workspaceRoot });

    const exoRoot = path.resolve(process.cwd(), "../..");
    const tmuxCommand = childProcess.execFileSync.mock.calls
      .map((call) => call as unknown as [string, string[]])
      .find(([, args]) => args.includes("new-session"))?.[1];
    if (!tmuxCommand) {
      throw new Error("Expected tmux new-session command");
    }
    const shellLaunch = tmuxCommand.at(-1) ?? "";
    expect(ptyState.spawned[0]?.command).toBe("tmux");
    expect(ptyState.spawned[0]?.args).toEqual(["-C", "attach-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i)]);
    expect(shellLaunch).toContain("'codex'");
    expect(shellLaunch).toContain("'-c'");
    expect(shellLaunch).toContain(`'mcp_servers.exo.command=\"node\"'`);
    expect(shellLaunch).toContain(`'mcp_servers.exo.args=[\"${exoRoot}/packages/mcp/bin/exo-mcp.mjs\"]'`);
    expect(shellLaunch).toContain(
      `'mcp_servers.exo.env={EXO_MCP_AUTOSTART=\"1\", EXO_MCP_SEARCH_TIMEOUT_MS=\"30000\", EXO_MCP_START_COMMAND=\"${exoRoot}/bin/exo start\"}'`,
    );
  });

  it("delegates terminal lifecycle through the runtime boundary", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(runtime.calls.createSession).toEqual([
      expect.objectContaining({
        workspaceRoot,
        cwd: workspaceRoot,
        historyLimit: 500,
      }),
    ]);
    expect(runtime.calls.captureTail).toEqual([]);
    expect(manager.readTail(terminal.id)).toContain("runtime-captured");
    expect(runtime.calls.captureTail).toEqual([
      {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        historyLimit: 500,
      },
    ]);

    await manager.kill(terminal.id);

    expect(runtime.calls.terminate).toEqual(["runtime-session-1"]);
    expect(
      childProcess.execFileSync.mock.calls
        .map((call) => call as unknown as [string, string[]])
        .filter(([command, args]) => command === "tmux" || args.includes("new-session") || args.includes("kill-session") || args.includes("capture-pane")),
    ).toEqual([]);
  });

  it("uses captured runtime tails for diagnostics and readiness without transcript replay", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime("OpenAI Codex\n› \n");
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "codex", cwd: workspaceRoot });
    await expect(manager.sendMessage(terminal.id, "Use captured readiness", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });
    expect(manager.diagnostics()[0]).toMatchObject({
      bufferedLines: 0,
      bufferedChars: 0,
    });

    expect(manager.readTail(terminal.id)).toBe("OpenAI Codex\n› \n");

    expect(manager.diagnostics()[0]).toMatchObject({
      bufferedLines: 3,
      bufferedChars: "OpenAI Codex\n› \n".length,
    });
    expect(manager.getInfo(terminal.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(runtime.calls.writes).toEqual([bracketedPaste("Use captured readiness")]);
    expect(manager.readTranscript(terminal.id)).not.toContain("OpenAI Codex");
  });
});

async function workspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-codex-readiness-"));
  tempPaths.push(workspaceRoot);
  return workspaceRoot;
}

function managerForWorkspace(workspaceRoot: string): TerminalManager {
  stubWorkspaceEnv(workspaceRoot);
  return new TerminalManager(workspaceRoot);
}

function stubWorkspaceEnv(workspaceRoot: string): void {
  vi.stubEnv("EXO_WORKSPACE_ROOT", workspaceRoot);
  vi.stubEnv("EXO_NOTE_ROOTS", path.join(workspaceRoot, "notes"));
  vi.stubEnv("EXO_PROJECT_ROOTS", path.join(workspaceRoot, "projects"));
  vi.stubEnv("EXO_DEFAULT_TERMINAL_CWD", workspaceRoot);
  vi.stubEnv("EXO_RUNTIME_ROOT", path.join(workspaceRoot, ".exo"));
  vi.stubEnv("EXO_CODEX_COMMAND", "codex");
}

function bracketedPaste(data: string): string {
  return `\x1b[200~${data}\x1b[201~`;
}

function spawnedTmuxSessionName(index: number): string {
  const sessionName = ptyState.tmuxSessions[index]?.sessionName;
  if (!sessionName) {
    throw new Error(`Expected spawned tmux session at index ${index}`);
  }
  return sessionName;
}

function mockLiveTmuxPanes(workspaceRoot: string, tmuxSessionNames: string[]) {
  childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
    if (!args.includes("list-panes")) {
      return "";
    }
    return tmuxSessionNames
      .map((sessionName) => `${sessionName}\t@1\t%2\t0\tzsh\t${workspaceRoot}`)
      .join("\n");
  });
}

function fakeRuntime(capturedTail = "runtime-captured\r\n"): TerminalRuntime & {
  calls: {
    createSession: unknown[];
    captureTail: unknown[];
    terminate: string[];
    writes: string[];
  };
} {
  const calls = {
    createSession: [] as unknown[],
    captureTail: [] as unknown[],
    terminate: [] as string[],
    writes: [] as string[],
  };
  const process = fakeRuntimeProcess(calls.writes);
  return {
    kind: "tmux",
    calls,
    availability: () => ({ available: true }),
    createSession: (options) => {
      calls.createSession.push(options);
      return {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        process,
      };
    },
    attachSession: () => process,
    listPanes: () => [
      {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        dead: false,
        currentCommand: "zsh",
        currentPath: "/tmp/work",
      },
    ],
    applySessionOptions: () => {},
    captureTail: (options) => {
      calls.captureTail.push(options);
      return capturedTail;
    },
    terminate: (sessionName) => {
      calls.terminate.push(sessionName);
    },
  };
}

function fakeRuntimeProcess(writes: string[]): TerminalRuntimeProcess {
  const events = new EventEmitter();
  return {
    onData: (handler) => events.on("data", handler),
    onExit: (handler) => events.on("exit", handler),
    write: (data) => writes.push(data),
    resize: () => {},
    kill: () => events.emit("exit", { exitCode: 0 }),
  };
}
