import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRuntimeConfig, SemanticTraceStore, semanticTraceEventsToAgentAnswerText, type AgentHarnessDependencyStatus } from "@exo/core";

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
  paneOutput: new Map<string, string>(),
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
      return ptyState.tmuxSessions.map((session) => `${session.sessionName}\t@1\t${session.paneId}\t0\t120\t32\t120\t32\tzsh\t${session.cwd}`).join("\n");
    }
    if (args.includes("capture-pane")) {
      const paneId = args[args.indexOf("-t") + 1] ?? "";
      return ptyState.paneOutput.get(paneId) ?? "";
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
      emitData: (data: string) => {
        const paneId = paneIdForSession(args.at(-1) ?? "");
        ptyState.paneOutput.set(paneId, `${ptyState.paneOutput.get(paneId) ?? ""}${data}`);
        stdout.emit("data", `%output ${paneId} ${tmuxControlEncode(data)}\n`);
      },
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
        deliverControlInput(args.at(-1) ?? "", data, state.writes);
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

  function deliverControlInput(sessionName: string, data: string, writes: string[]) {
    const paneId = paneIdForSession(sessionName);
    for (const line of data.split("\n")) {
      if (!line.trim().startsWith("send-keys ")) {
        continue;
      }
      const tokens = line.trim().split(/\s+/);
      if (tokens[tokens.indexOf("-t") + 1] !== paneId) {
        continue;
      }
      if (tokens.includes("-H")) {
        const hexStart = tokens.indexOf("--") + 1;
        const bytes = tokens.slice(hexStart).map((hex) => Number.parseInt(hex, 16));
        writes.push(unwrapBracketedPaste(Buffer.from(bytes).toString("utf8")));
        continue;
      }
      const key = tokens.at(-1) ?? "";
      writes.push(key === "Enter" ? "\r" : key);
    }
  }

  function unwrapBracketedPaste(value: string): string {
    const match = /^\u001b\[200~([\s\S]*)\u001b\[201~$/.exec(value);
    return match ? match[1] : value;
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
  ptyState.paneOutput.clear();
  ptyState.pasteBuffers.clear();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("TerminalManager session identity", () => {
  it("exposes terminal substrate and harness identity separately from the legacy kind field", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const shell = await manager.create({ terminalKind: "shell", cwd: workspaceRoot });
    const codex = await manager.create({ terminalKind: "agent", harnessId: "codex", cwd: workspaceRoot });

    expect(shell).toMatchObject({
      kind: "shell",
      terminalKind: "shell",
      harnessId: null,
    });
    expect(codex).toMatchObject({
      kind: "codex",
      terminalKind: "agent",
      harnessId: "codex",
    });
  });

  it("rejects mismatched terminal kind and harness id before launching", async () => {
    const workspaceRoot = await workspaceFixture();
    const runtime = fakeRuntime();
    stubWorkspaceEnv(workspaceRoot);
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    await expect(manager.create({ kind: "shell", harnessId: "codex", cwd: workspaceRoot })).rejects.toThrow(
      "Agent harness terminal kind mismatch: codex resolves to codex, not shell.",
    );

    await expect(manager.create({ terminalKind: "shell", harnessId: "codex", cwd: workspaceRoot })).rejects.toThrow(
      "Agent harness terminal substrate mismatch: codex resolves to agent, not shell.",
    );

    expect(manager.list()).toEqual([]);
    expect(runtime.calls.createSession).toEqual([]);
  });
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

  it("submits multiple queued Codex messages with only one delayed Enter", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });

    await expect(manager.sendMessage(agent.id, "First queued prompt", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });
    await expect(manager.sendMessage(agent.id, "Second queued prompt", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 2,
    });

    runtime.emitData("\nAsk Codex\n");

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(runtime.calls.writes).toEqual([
      bracketedPaste("First queued prompt"),
      bracketedPaste("Second queued prompt"),
    ]);

    vi.advanceTimersByTime(120);

    expect(runtime.calls.writes).toEqual([
      bracketedPaste("First queued prompt"),
      bracketedPaste("Second queued prompt"),
      "\r",
    ]);
  });

  it("drops queued Codex messages instead of flushing into a detached bridge", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });

    await expect(manager.sendMessage(agent.id, "Do not lose this invisibly", true)).resolves.toMatchObject({
      delivery: "queued",
      queuedInputCount: 1,
    });

    runtime.emitExit(1);
    expect(manager.diagnostics()[0]).toMatchObject({
      bridgeStatus: "detached",
    });
    expect(manager.getInfo(agent.id)).toMatchObject({ queuedInputCount: 1 });

    vi.advanceTimersByTime(1_500);

    expect(runtime.calls.writes).toEqual([]);
    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "ready",
      queuedInputCount: 0,
    });
    expect(warnSpy).toHaveBeenCalledWith("[exo] dropped queued terminal input", expect.objectContaining({
      discardedWrites: 1,
      id: agent.id,
      reason: "terminal bridge is detached",
    }));
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

  it("keeps coalesced raw input scheduled when readiness timers are cleared", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });

    await expect(manager.write(agent.id, "y")).resolves.toMatchObject({ delivery: "sent" });
    runtime.emitData("Do you trust the files in this folder?");
    vi.advanceTimersByTime(40);

    expect(manager.getInfo(agent.id)).toMatchObject({
      readiness: "blocked",
    });
    expect(runtime.calls.writes).toEqual(["y"]);
  });

  it("explicitly discards coalesced raw input when killing a terminal", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });

    await expect(manager.write(terminal.id, "abc")).resolves.toMatchObject({ delivery: "sent" });
    await manager.kill(terminal.id);
    vi.advanceTimersByTime(40);

    expect(runtime.calls.writes).toEqual([]);
    expect(manager.list()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("[exo] dropped buffered terminal input", expect.objectContaining({
      discardedChars: 3,
      id: terminal.id,
      reason: "terminal was killed before buffered input could be delivered",
    }));
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

  it("marks input degraded while keeping the output bridge attached", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    runtime.emitInputDegraded("control stdin closed");

    expect(manager.diagnostics()[0]).toMatchObject({
      health: "unhealthy",
      healthDetail: "Terminal output is still attached, but input delivery failed; reconnect the terminal.",
      bridgeStatus: "attached",
    });

    runtime.emitData("output still streams\n");

    expect(manager.readTranscript(terminal.id)).toContain("output still streams");
    await expect(manager.write(terminal.id, "\r")).resolves.toEqual({ ok: false, delivery: "not-found" });
  });

  it("preserves alternate-screen escapes while stripping embedded mouse tracking modes", async () => {
    const workspaceRoot = await workspaceFixture();
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("capture-pane")) {
        throw new Error("capture unavailable");
      }
      return childProcess.defaultExecFileSync(command, args);
    });
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    pty.emitData("before\x1b[?1000h\x1b[?1049hinside-alt-screen\x1b[?1049l\x1b[?1000lofter");

    expect(manager.readTail(terminal.id)).toBe("before\x1b[?1049hinside-alt-screen\x1b[?1049lofter");
    expect(manager.readTranscript(terminal.id)).toContain("\x1b[?1049hinside-alt-screen\x1b[?1049l");
    expect(manager.readTranscript(terminal.id)).not.toContain("\x1b[?1000h");
  });

  it("falls back to configured append-cache lines while transcripts keep receiving data", async () => {
    const workspaceRoot = await workspaceFixture();
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("capture-pane")) {
        throw new Error("capture unavailable");
      }
      return childProcess.defaultExecFileSync(command, args);
    });
    stubWorkspaceEnv(workspaceRoot);
    const manager = new TerminalManager(workspaceRoot, 500);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const lines = Array.from({ length: 505 }, (_, index) => `line-${index + 1}`);
    const largeChunk = lines.join("\n");

    pty.emitData(largeChunk);

    expect(manager.readTail(terminal.id)).toBe(lines.slice(-500).join("\n"));
    expect(manager.readTranscript(terminal.id)).toContain("line-1");
  });

  it("honors explicit fallback tail line limits without shrinking the internal buffer", async () => {
    const workspaceRoot = await workspaceFixture();
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("capture-pane")) {
        throw new Error("capture unavailable");
      }
      return childProcess.defaultExecFileSync(command, args);
    });
    stubWorkspaceEnv(workspaceRoot);
    const manager = new TerminalManager(workspaceRoot, 500);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const lines = Array.from({ length: 80 }, (_, index) => `line-${index + 1}`);

    pty.emitData(lines.join("\n"));

    expect(manager.readTail(terminal.id, { maxLines: 12 })).toBe(lines.slice(-12).join("\n"));
    expect(manager.readTail(terminal.id)).toBe(lines.join("\n"));
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

  it("passes explicit live tail line limits to tmux capture", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const capturedTail = Array.from({ length: 12 }, (_, index) => `captured-${index + 1}`).join("\r\n");
    const runtime = fakeRuntime(capturedTail);
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(manager.readTail(terminal.id, { maxLines: 4 })).toBe("captured-9\r\ncaptured-10\r\ncaptured-11\r\ncaptured-12");
    expect(runtime.calls.captureTailForDisplay).toEqual([
      {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        historyLimit: 500,
        lineLimit: 4,
      },
    ]);
    expect(manager.readTail(terminal.id)).toBe(capturedTail);
  });

  it("prefers fresh bounded tmux capture over longer stale buffered output", async () => {
    const workspaceRoot = await workspaceFixture();
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("capture-pane")) {
        return "fresh-1\nfresh-2\n";
      }
      return childProcess.defaultExecFileSync(command, args);
    });
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const staleLines = Array.from({ length: 80 }, (_, index) => `stale-${index + 1}`);
    ptyState.spawned[0].emitData(staleLines.join("\n"));

    expect(manager.readTail(terminal.id, { maxLines: 4 })).toBe("fresh-1\r\nfresh-2\r\n");
    expect(manager.readTail(terminal.id)).toBe("fresh-1\r\nfresh-2\r\n");
  });

  it("applies configured live scrollback to tmux history", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const manager = new TerminalManager(workspaceRoot, 24_000);

    await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["-u", "set-option", "-t", spawnedTmuxSessionName(0), "history-limit", "24000"],
      expect.any(Object),
    ]);

    manager.setBufferLineLimit(500);

    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["-u", "set-option", "-t", spawnedTmuxSessionName(0), "history-limit", "500"],
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
      ["-u", "set-option", "-t", sessionName, "status", "off"],
      expect.any(Object),
    ]);
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["-u", "set-option", "-t", sessionName, "mouse", "off"],
      expect.any(Object),
    ]);
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["-u", "set-option", "-t", sessionName, "focus-events", "on"],
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

  it("rejects non-launchable Pi harnesses before context sync, allocation, or runtime creation", async () => {
    const workspaceRoot = await workspaceFixture();
    const piCommand = path.join(workspaceRoot, "pi");
    await writeFile(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    await chmodExecutable(piCommand);
    stubWorkspaceEnv(workspaceRoot);
    vi.stubEnv("EXO_PI_COMMAND", piCommand);
    vi.stubEnv("EXO_PI_REPO_PATH", workspaceRoot);
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    await expect(manager.create({ kind: "pi", cwd: workspaceRoot })).rejects.toThrow(
      "Agent harness is not launchable: pi (Missing dependency).",
    );

    expect(manager.list()).toEqual([]);
    expect(runtime.calls.createSession).toEqual([]);
    await expect(readFile(path.join(workspaceRoot, ".exo", "instructions", "AGENTS.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("auto-starts configured Pi backend dependencies before validating launchability", async () => {
    const workspaceRoot = await workspaceFixture();
    const piCommand = path.join(workspaceRoot, "pi");
    await writeFile(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    await chmodExecutable(piCommand);
    stubWorkspaceEnv(workspaceRoot);
    vi.stubEnv("EXO_PI_COMMAND", piCommand);
    vi.stubEnv("EXO_PI_REPO_PATH", workspaceRoot);
    vi.stubEnv("EXO_PI_BACKEND_URL", "http://127.0.0.1:18080");
    vi.stubEnv("EXO_PI_BACKEND_COMMAND", "pi-backend --port 18080");
    const runtime = fakeRuntime();
    const starter = {
      calls: [] as unknown[],
      ensureStarted: vi.fn(async (dependencies: AgentHarnessDependencyStatus[]) => {
        starter.calls.push(dependencies);
        return { EXO_PI_BACKEND_READY: "1" };
      }),
    };
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime, starter);

    const terminal = await manager.create({ kind: "pi", cwd: workspaceRoot });

    expect(terminal.kind).toBe("pi");
    expect(starter.ensureStarted).toHaveBeenCalledTimes(1);
    expect(starter.calls[0]).toEqual([
      expect.objectContaining({
        id: "pi-inference-backend",
        satisfied: false,
        autoStart: expect.objectContaining({
          command: "pi-backend --port 18080",
          probeUrl: "http://127.0.0.1:18080",
          readyEnv: { EXO_PI_BACKEND_READY: "1" },
        }),
      }),
    ]);
    expect(process.env.EXO_PI_BACKEND_READY).not.toBe("1");
    expect(runtime.calls.createSession).toHaveLength(1);
    expect(runtime.calls.createSession[0]).toMatchObject({
      command: piCommand,
      env: expect.objectContaining({
        EXO_PI_BACKEND_READY: "1",
        EXO_AGENT_KIND: "pi",
      }),
    });
    await expect(readFile(path.join(workspaceRoot, ".exo", "instructions", "AGENTS.md"), "utf8")).resolves.toContain("# Exo Runtime");
  });

  it("provisions Pi-compatible trace sidecars and ingests stream-json events through session wiring", async () => {
    const workspaceRoot = await workspaceFixture();
    const piCommand = path.join(workspaceRoot, "pi");
    await writeFile(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    await chmodExecutable(piCommand);
    stubWorkspaceEnv(workspaceRoot);
    vi.stubEnv("EXO_PI_COMMAND", piCommand);
    vi.stubEnv("EXO_PI_REPO_PATH", workspaceRoot);
    vi.stubEnv("EXO_PI_BACKEND_URL", "http://127.0.0.1:18080");
    vi.stubEnv("EXO_PI_BACKEND_READY", "1");
    const runtime = fakeRuntime();
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "pi", cwd: workspaceRoot });
    const createCall = runtime.calls.createSession[0] as { env: Record<string, string | undefined> };
    const sidecarPath = createCall.env.EXO_PI_SEMANTIC_TRACE_PATH;

    expect(sidecarPath).toBe(path.join(workspaceRoot, ".exo", "traces", "sidecars", `${terminal.id}.ndjson`));
    expect(createCall.env.EXO_SEMANTIC_TRACE_PATH).toBe(sidecarPath);
    expect(createCall.env.EXO_SEMANTIC_TRACE_SESSION_ID).toBe(terminal.id);
    expect(createCall.env.EXO_SEMANTIC_TRACE_HARNESS_ID).toBe("pi");

    await writeFile(
      sidecarPath!,
      `${JSON.stringify({
        type: "assistant-text",
        text: "PI_FIXTURE_ANSWER OK",
        turnId: "turn-1",
        timestamp: "2026-07-04T12:00:00.000Z",
      })}\n`,
      "utf8",
    );
    runtime.emitExit(0);

    await vi.waitFor(async () => {
      const events = await new SemanticTraceStore(path.join(workspaceRoot, ".exo")).readEvents(terminal.id);
      expect(semanticTraceEventsToAgentAnswerText(events)).toBe("PI_FIXTURE_ANSWER OK");
    });
  });

  it("provisions Claude trace sidecars and ingests fake Claude stream-json events through the declared path", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime("runtime-captured\r\n", (options) => {
      const sidecarPath = options.env.EXO_CLAUDE_SEMANTIC_TRACE_PATH;
      expect(sidecarPath).toBe(path.join(workspaceRoot, ".exo", "traces", "sidecars", "term-1.ndjson"));
      expect(options.env.EXO_SEMANTIC_TRACE_PATH).toBe(sidecarPath);
      expect(options.env.EXO_SEMANTIC_TRACE_SESSION_ID).toBe("term-1");
      expect(options.env.EXO_SEMANTIC_TRACE_HARNESS_ID).toBe("claude");
      writeFileSync(
        sidecarPath!,
        [
          {
            type: "session-start",
            command: "fake-claude --stream-json",
            cwd: workspaceRoot,
            timestamp: "2026-07-04T12:00:00.000Z",
          },
          {
            type: "assistant-text",
            text: "CLAUDE_FIXTURE_ANSWER OK",
            turnId: "turn-1",
            timestamp: "2026-07-04T12:00:01.000Z",
          },
          {
            type: "tool-call",
            name: "read_file",
            toolCallId: "tool-1",
            turnId: "turn-1",
            input: { path: "tasks.md" },
            status: "started",
            timestamp: "2026-07-04T12:00:02.000Z",
          },
          {
            type: "tool-result",
            name: "read_file",
            toolCallId: "tool-1",
            turnId: "turn-1",
            output: { bytes: 42 },
            status: "succeeded",
            timestamp: "2026-07-04T12:00:03.000Z",
          },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n",
        "utf8",
      );
    });
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "claude", cwd: workspaceRoot });
    runtime.emitExit(0);

    await vi.waitFor(async () => {
      const events = await new SemanticTraceStore(path.join(workspaceRoot, ".exo")).readEvents(terminal.id);
      expect(events.map((event) => event.kind)).toEqual(["session.started", "message", "tool.call", "tool.result"]);
      expect(semanticTraceEventsToAgentAnswerText(events)).toBe("CLAUDE_FIXTURE_ANSWER OK");
      expect(events[0]).toMatchObject({
        schemaVersion: "exo.semantic-trace.v1",
        sessionId: terminal.id,
        harnessId: "claude",
        visibility: "private",
        payload: {
          rawKind: "session-start",
          command: "fake-claude --stream-json",
          cwd: workspaceRoot,
        },
      });
      expect(events[2]).toMatchObject({
        kind: "tool.call",
        actor: { id: "read_file", kind: "tool" },
        refs: {
          tools: [
            expect.objectContaining({
              name: "read_file",
              callId: "tool-1",
              status: "started",
            }),
          ],
        },
      });
    });
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
    expect(killCommand).toEqual(["-u", "kill-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i)]);
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
        geometry: expect.objectContaining({
          cols: 120,
          rows: 32,
          source: "initial-default",
        }),
      }),
    ]);
    expect(registry.sessions[0]?.transcriptPath).toMatch(/term-1-shell-\d{4}-/);
  });

  it("does not carry readiness fixture terminals into a new runtime registry after settings apply", async () => {
    const readinessWorkspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(readinessWorkspaceRoot);
    await manager.create({ kind: "shell", cwd: readinessWorkspaceRoot });

    const realWorkspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-real-workspace-"));
    tempPaths.push(realWorkspaceRoot);
    await mkdir(realWorkspaceRoot, { recursive: true });
    stubWorkspaceEnv(realWorkspaceRoot);
    manager.setRuntimeConfig(resolveRuntimeConfig());
    manager.setDefaultCwd(realWorkspaceRoot);

    const realTerminal = await manager.create({ kind: "shell", cwd: realWorkspaceRoot });
    const readinessRegistry = JSON.parse(
      await readFile(path.join(readinessWorkspaceRoot, ".exo", "terminal-sessions.json"), "utf8"),
    ) as { sessions: Array<{ cwd: string }> };
    const realRegistry = JSON.parse(
      await readFile(path.join(realWorkspaceRoot, ".exo", "terminal-sessions.json"), "utf8"),
    ) as { sessions: Array<{ id: string; cwd: string }> };

    expect(readinessRegistry.sessions).toEqual([expect.objectContaining({ cwd: readinessWorkspaceRoot })]);
    expect(realRegistry.sessions).toEqual([expect.objectContaining({ id: realTerminal.id, cwd: realWorkspaceRoot })]);
    expect(JSON.stringify(realRegistry)).not.toContain("exo-codex-readiness-");
    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: realTerminal.id,
        cwd: realWorkspaceRoot,
      }),
    ]);
  });

  it("records renderer geometry exactly and uses it on reconnect", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    await manager.resize(terminal.id, 12, 4);
    const registryPath = path.join(workspaceRoot, ".exo", "terminal-sessions.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as { sessions: Array<Record<string, unknown>> };

    expect(ptyState.spawned[0]?.stdinWrites).toContain("refresh-client -C 12x4\n");
    expect(manager.getInfo(terminal.id)?.geometry).toMatchObject({
      cols: 12,
      rows: 4,
      source: "renderer-fit",
    });
    expect(registry.sessions[0]?.geometry).toMatchObject({
      cols: 12,
      rows: 4,
      source: "renderer-fit",
    });

    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);
    ptyState.spawned[0].emitExit(1);
    await manager.reconnect(terminal.id);

    expect(ptyState.spawned[1]?.stdinWrites.slice(0, 2)).toEqual([
      expect.stringMatching(/^resize-window -t .+ -x 12 -y 4\n$/),
      "refresh-client -C 12x4\n",
    ]);
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
            geometry: {
              cols: 181,
              rows: 47,
              reportedAt: "2026-07-02T12:00:00.000Z",
              source: "renderer-fit",
            },
          },
        ],
      }),
    );
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        const generated = childProcess.defaultExecFileSync(command, args);
        return `${tmuxSessionName}\t@1\t%2\t0\t181\t47\t181\t47\tzsh\t${workspaceRoot}\n${generated}`;
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
    expect(ptyState.spawned[0]?.args).toEqual(["-u", "-C", "attach-session", "-t", tmuxSessionName]);
    expect(ptyState.spawned[0]?.stdinWrites.slice(0, 2)).toEqual([
      `resize-window -t ${tmuxSessionName} -x 181 -y 47\n`,
      "refresh-client -C 181x47\n",
    ]);

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
        return `${tmuxSessionName}\t@1\t%2\t0\t120\t32\t120\t32\tzsh\t${workspaceRoot}\n`;
      }
      if (args.includes("capture-pane")) {
        return args[args.indexOf("-t") + 1] === "%2" ? "restored-history-001\nrestored-history-002\n" : "";
      }
      return childProcess.defaultExecFileSync(command, args);
    });

    const manager = managerForWorkspace(workspaceRoot);

    expect(manager.getInfo("term-7")?.geometry).toMatchObject({
      cols: 120,
      rows: 32,
      source: "initial-default",
    });
    expect(ptyState.spawned[0]?.stdinWrites.slice(0, 2)).toEqual([
      `resize-window -t ${tmuxSessionName} -x 120 -y 32\n`,
      "refresh-client -C 120x32\n",
    ]);
    expect(manager.readTail("term-7")).toContain("restored-history-001\r\nrestored-history-002");
    expect(childProcess.execFileSync.mock.calls).toContainEqual([
      "tmux",
      ["-u", "capture-pane", "-p", "-e", "-t", "%2", "-S", "-100000"],
      expect.any(Object),
    ]);
  });

  it("keeps missing persisted running sessions visible as unhealthy transcript records", async () => {
    const workspaceRoot = await workspaceFixture();
    const runtimeRoot = path.join(workspaceRoot, ".exo");
    const tmuxSessionName = "exo-abc1234567-term-7";
    const transcriptPath = path.join(runtimeRoot, "terminal-transcripts", "term-7-shell.ansi.log");
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
            transcriptPath,
            createdAt: new Date().toISOString(),
            lastAttachedAt: null,
            status: "running",
          },
        ],
      }),
    );
    childProcess.execFileSync.mockImplementation((command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        return "";
      }
      return childProcess.defaultExecFileSync(command, args);
    });

    const manager = managerForWorkspace(workspaceRoot);

    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: "term-7",
        status: "running",
        health: "unhealthy",
        healthDetail: "Tmux session is missing; transcript remains available.",
        transcriptPath,
      }),
    ]);
    expect(manager.diagnostics()).toEqual([
      expect.objectContaining({
        id: "term-7",
        bridgeStatus: "detached",
        paneStatus: "missing",
        tmuxSessionName,
        tmuxPaneId: null,
        safeAttachCommand: `tmux attach-session -t '${tmuxSessionName}'`,
        debugAttach: {
          tmuxSessionName,
          tmuxPaneId: null,
          safeAttachCommand: `tmux attach-session -t '${tmuxSessionName}'`,
        },
        bufferedChars: 0,
        transcriptPath,
      }),
    ]);
    await expect(manager.write("term-7", "input")).resolves.toEqual({ ok: false, delivery: "not-found" });
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
      tmuxPaneId: "%1",
      safeAttachCommand: expect.stringMatching(/^tmux attach-session -t 'exo-[a-f0-9]{10}-term-1-\d{4}-/i),
      debugAttach: {
        tmuxSessionName: expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i),
        tmuxPaneId: "%1",
        safeAttachCommand: expect.stringMatching(/^tmux attach-session -t 'exo-[a-f0-9]{10}-term-1-\d{4}-/i),
      },
      bridgeStatus: "attached",
      paneStatus: "alive",
      geometry: {
        renderer: expect.objectContaining({ cols: 120, rows: 32, source: "initial-default" }),
        tmuxPane: { width: 120, height: 32 },
        tmuxClient: { width: 120, height: 32 },
        divergent: false,
        divergentSinceMs: null,
        attachGeneration: expect.any(Number),
      },
      command: expect.any(String),
      transcriptPath: expect.stringContaining("terminal-transcripts"),
    });
    expect(diagnostic).not.toHaveProperty("transport");
  });

  it("surfaces terminal geometry divergence in diagnostics", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    await manager.resize(terminal.id, 181, 47);
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)], { width: 120, height: 32 });

    expect(manager.diagnostics()[0]).toMatchObject({
      geometry: {
        renderer: expect.objectContaining({ cols: 181, rows: 47, source: "renderer-fit" }),
        tmuxPane: { width: 120, height: 32 },
        tmuxClient: { width: 120, height: 32 },
        divergent: true,
        divergentSinceMs: expect.any(Number),
        attachGeneration: expect.any(Number),
      },
    });
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
        command: path.join(workspaceRoot, "bin", "codex"),
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
        command: path.join(workspaceRoot, "bin", "codex"),
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
    expect(ptyState.spawned[1].args).toEqual(["-u", "-C", "attach-session", "-t", spawnedTmuxSessionName(0)]);
    expect(manager.diagnostics()[0]).toMatchObject({
      bridgeStatus: "attached",
      paneStatus: "alive",
    });
  });

  it("replaces an attached bridge and emits only current-generation data", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);
    const dataEvents: Array<{ id: string; generation: number; data: string }> = [];
    manager.on("data", (event) => dataEvents.push(event));

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const firstGeneration = terminal.attachGeneration;
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);

    await expect(manager.reconnect(terminal.id)).resolves.toMatchObject({
      id: terminal.id,
      attachGeneration: firstGeneration + 1,
      status: "running",
    });
    expect(ptyState.spawned).toHaveLength(2);
    expect(ptyState.spawned[1].args).toEqual(["-u", "-C", "attach-session", "-t", spawnedTmuxSessionName(0)]);

    ptyState.spawned[0].emitData("stale output");
    ptyState.spawned[1].emitData("after reconnect");

    expect(dataEvents).toEqual([
      {
        id: terminal.id,
        generation: firstGeneration + 1,
        data: "after reconnect",
      },
    ]);
  });

  it("ignores stale bridge exits after reconnecting a detached bridge", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    mockLiveTmuxPanes(workspaceRoot, [spawnedTmuxSessionName(0)]);
    ptyState.spawned[0].emitExit(1);

    await manager.reconnect(terminal.id);
    expect(ptyState.spawned).toHaveLength(2);
    expect(manager.diagnostics()[0]).toMatchObject({
      bridgeStatus: "attached",
      paneStatus: "alive",
    });

    ptyState.spawned[0].emitExit(1);

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

    await vi.waitFor(() => expect(ptyState.spawned).toHaveLength(2));
    expect(ptyState.spawned[1].args).toEqual(["-u", "-C", "attach-session", "-t", spawnedTmuxSessionName(0)]);
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
    expect(ptyState.spawned[0]?.args).toEqual(["-u", "-C", "attach-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1-\d{4}-/i)]);
    expect(shellLaunch).toContain(`'${path.join(workspaceRoot, "bin", "codex")}'`);
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
    expect(runtime.calls.captureTailForDisplay).toEqual([]);
    expect(manager.readTail(terminal.id)).toContain("runtime-captured");
    expect(runtime.calls.captureTailForDisplay).toEqual([
      {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        historyLimit: 500,
      },
    ]);
    expect(manager.readRestoreSnapshot(terminal.id)).toBe("restore-content\x1b[2;3H");
    expect(runtime.calls.captureRestoreSnapshot).toEqual([
      {
        sessionName: "runtime-session-1",
        paneId: "%runtime-1",
        historyLimit: 500,
        liveScrollbackLines: 500,
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

  it("does not deliver a live restore snapshot when tmux geometry disagrees with the renderer record", async () => {
    const workspaceRoot = await workspaceFixture();
    stubWorkspaceEnv(workspaceRoot);
    const runtime = fakeRuntime();
    runtime.captureRestoreSnapshot = (options) => {
      runtime.calls.captureRestoreSnapshot.push(options);
      return {
        content: "wrong-size-content",
        cols: 99,
        rows: 12,
        altScreen: false,
      };
    };
    const manager = new TerminalManager(workspaceRoot, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });

    expect(manager.readRestoreSnapshot(terminal.id)).toBe("");
    expect(manager.getInfo(terminal.id)).toMatchObject({
      health: "unhealthy",
      healthDetail: expect.stringContaining("did not match renderer geometry 120x32"),
    });
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
  const binRoot = path.join(workspaceRoot, "bin");
  await mkdir(binRoot, { recursive: true });
  await Promise.all(
    ["claude", "codex"].map(async (command) => {
      const commandPath = path.join(binRoot, command);
      await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmodExecutable(commandPath);
    }),
  );
  return workspaceRoot;
}

async function chmodExecutable(filePath: string): Promise<void> {
  await chmod(filePath, 0o755);
}

function managerForWorkspace(workspaceRoot: string): TerminalManager {
  stubWorkspaceEnv(workspaceRoot);
  return new TerminalManager(workspaceRoot);
}

function stubWorkspaceEnv(workspaceRoot: string): void {
  for (const key of PI_HARNESS_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv("EXO_WORKSPACE_ROOT", workspaceRoot);
  vi.stubEnv("EXO_NOTE_ROOTS", path.join(workspaceRoot, "notes"));
  vi.stubEnv("EXO_PROJECT_ROOTS", path.join(workspaceRoot, "projects"));
  vi.stubEnv("EXO_DEFAULT_TERMINAL_CWD", workspaceRoot);
  vi.stubEnv("EXO_RUNTIME_ROOT", path.join(workspaceRoot, ".exo"));
  vi.stubEnv("EXO_CLAUDE_COMMAND", path.join(workspaceRoot, "bin", "claude"));
  vi.stubEnv("EXO_CODEX_COMMAND", path.join(workspaceRoot, "bin", "codex"));
  vi.stubEnv("EXO_PI_BACKEND_URL", undefined);
  vi.stubEnv("EXO_PI_BACKEND_COMMAND", undefined);
  vi.stubEnv("EXO_PI_BACKEND_READY", undefined);
}

const PI_HARNESS_ENV_KEYS = [
  "EXO_PI_ENABLED",
  "EXO_PI_LABEL",
  "EXO_PI_COMMAND",
  "EXO_PI_REPO_PATH",
  "EXO_PI_ARGS",
  "EXO_PI_CHANNEL",
  "EXO_PI_BUILD",
  "EXO_PI_BACKEND_URL",
  "EXO_PI_BACKEND_COMMAND",
  "EXO_PI_BACKEND_LABEL",
  "EXO_PI_BACKEND_KIND",
  "EXO_PI_BACKEND_READY",
] as const;

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

function mockLiveTmuxPanes(
  workspaceRoot: string,
  tmuxSessionNames: string[],
  geometry: { width: number; height: number; clientWidth?: number; clientHeight?: number } = { width: 120, height: 32, clientWidth: 120, clientHeight: 32 },
) {
  const clientWidth = geometry.clientWidth ?? geometry.width;
  const clientHeight = geometry.clientHeight ?? geometry.height;
  childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
    if (!args.includes("list-panes")) {
      return "";
    }
    return tmuxSessionNames
      .map((sessionName) => `${sessionName}\t@1\t%2\t0\t${geometry.width}\t${geometry.height}\t${clientWidth}\t${clientHeight}\tzsh\t${workspaceRoot}`)
      .join("\n");
  });
}

function fakeRuntime(
  capturedTail = "runtime-captured\r\n",
  onCreate?: (options: Parameters<TerminalRuntime["createSession"]>[0]) => void,
): TerminalRuntime & {
  calls: {
    createSession: unknown[];
    captureTailForDisplay: unknown[];
    captureRestoreSnapshot: unknown[];
    terminate: string[];
    writes: string[];
  };
  emitData: (data: string) => void;
  emitExit: (exitCode?: number) => void;
  emitInputDegraded: (reason: string) => void;
} {
  const calls = {
    createSession: [] as unknown[],
    captureTailForDisplay: [] as unknown[],
    captureRestoreSnapshot: [] as unknown[],
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
      onCreate?.(options);
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
        width: 120,
        height: 32,
        clientWidth: 120,
        clientHeight: 32,
        currentCommand: "zsh",
        currentPath: "/tmp/work",
      },
    ],
    applySessionOptions: () => {},
    captureTailForDisplay: (options) => {
      calls.captureTailForDisplay.push(options);
      return capturedTail;
    },
    captureRestoreSnapshot: (options) => {
      calls.captureRestoreSnapshot.push(options);
      return {
        content: "restore-content\x1b[2;3H",
        cols: 120,
        rows: 32,
        altScreen: false,
      };
    },
    terminate: (sessionName) => {
      calls.terminate.push(sessionName);
    },
    emitData: process.emitData,
    emitExit: process.emitExit,
    emitInputDegraded: process.emitInputDegraded,
  };
}

function fakeRuntimeProcess(writes: string[]): TerminalRuntimeProcess & {
  emitData: (data: string) => void;
  emitExit: (exitCode?: number) => void;
  emitInputDegraded: (reason: string) => void;
} {
  const events = new EventEmitter();
  return {
    onData: (handler) => events.on("data", handler),
    onExit: (handler) => events.on("exit", handler),
    onInputDegraded: (handler) => events.on("input-degraded", handler),
    write: (data) => writes.push(data),
    resize: () => {},
    kill: () => events.emit("exit", { exitCode: 0 }),
    emitData: (data) => events.emit("data", data),
    emitExit: (exitCode) => events.emit("exit", { exitCode }),
    emitInputDegraded: (reason) => events.emit("input-degraded", { reason, command: "fake write" }),
  };
}
