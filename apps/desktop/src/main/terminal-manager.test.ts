import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ptyState = vi.hoisted(() => ({
  spawned: [] as Array<{
    command: string;
    args: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    writes: string[];
    emitData: (data: string) => void;
    emitExit: (exitCode?: number) => void;
  }>,
}));

const childProcess = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: "tmux 3.5a\n", stderr: "" })),
  execFileSync: vi.fn((_command: string, _args: string[]) => ""),
}));

vi.mock("node:child_process", () => childProcess);

vi.mock("node-pty", () => {
  class FakePty {
    command = "";
    args: string[] = [];
    options: { cwd?: string; env?: Record<string, string | undefined> } = {};
    writes: string[] = [];
    private dataHandlers: Array<(data: string) => void> = [];
    private exitHandlers: Array<(event: { exitCode?: number }) => void> = [];

    onData(handler: (data: string) => void) {
      this.dataHandlers.push(handler);
    }

    onExit(handler: (event: { exitCode?: number }) => void) {
      this.exitHandlers.push(handler);
    }

    write(data: string) {
      this.writes.push(data);
    }

    resize() {}

    kill() {
      this.emitExit(0);
    }

    emitData(data: string) {
      for (const handler of this.dataHandlers) {
        handler(data);
      }
    }

    emitExit(exitCode?: number) {
      for (const handler of this.exitHandlers) {
        handler({ exitCode });
      }
    }
  }

  return {
    default: {
      spawn: vi.fn((command: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined> }) => {
        const fake = new FakePty();
        fake.command = command;
        fake.args = args;
        fake.options = options;
        ptyState.spawned.push(fake);
        return fake;
      }),
    },
  };
});

import { TerminalManager } from "./terminal-manager";

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
  childProcess.execFileSync.mockReturnValue("");
  ptyState.spawned.splice(0);
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
    expect(pty.writes).toEqual([bracketedPaste("Fix the issue")]);

    vi.advanceTimersByTime(120);

    expect(pty.writes).toEqual([bracketedPaste("Fix the issue"), "\r"]);
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
    expect(pty.writes).toEqual([bracketedPaste("Start cleanly")]);

    vi.advanceTimersByTime(120);

    expect(pty.writes).toEqual([bracketedPaste("Start cleanly"), "\r"]);
  });

  it("sends semantic messages with bracketed paste to preserve whitespace", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "claude", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const message = "Please keep   spaces.\nAnd newlines.";

    await expect(manager.sendMessage(agent.id, message, true)).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual([bracketedPaste(message)]);
    vi.advanceTimersByTime(120);
    expect(pty.writes).toEqual([bracketedPaste(message), "\r"]);
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
    expect(pty.writes).toEqual([bracketedPaste(message)]);
  });

  it("lets raw non-submitted input through so a user can answer interstitials", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.write(agent.id, "y")).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual(["y"]);
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
    expect(killCommand).toEqual(["kill-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1$/)]);
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
        tmuxSessionName: expect.stringMatching(/^exo-[a-f0-9]{10}-term-1$/),
        transcriptPath: expect.stringContaining("terminal-transcripts"),
        status: "running",
      }),
    ]);
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
    childProcess.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes("list-panes")) {
        return `${tmuxSessionName}\t@1\t%2\t0\tzsh\t${workspaceRoot}\n`;
      }
      return "";
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
    expect(ptyState.spawned[0]?.args).toEqual(["attach-session", "-t", tmuxSessionName]);

    await manager.create({ kind: "shell", cwd: workspaceRoot });
    expect(manager.list().map((session) => session.id)).toContain("term-8");
  });

  it("reports process diagnostics without exposing legacy transport fields", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "shell", cwd: workspaceRoot });

    const [diagnostic] = manager.diagnostics();
    expect(diagnostic).toMatchObject({
      kind: "shell",
      status: "running",
      runtime: "tmux",
      tmuxSessionName: expect.stringMatching(/^exo-[a-f0-9]{10}-term-1$/),
      bridgeStatus: "attached",
      command: expect.any(String),
      transcriptPath: expect.stringContaining("terminal-transcripts"),
    });
    expect(diagnostic).not.toHaveProperty("transport");
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
    expect(ptyState.spawned[0]?.args).toEqual(["attach-session", "-t", expect.stringMatching(/^exo-[a-f0-9]{10}-term-1$/)]);
    expect(shellLaunch).toContain("'codex'");
    expect(shellLaunch).toContain("'-c'");
    expect(shellLaunch).toContain(`'mcp_servers.exo.command=\"node\"'`);
    expect(shellLaunch).toContain(`'mcp_servers.exo.args=[\"${exoRoot}/packages/mcp/bin/exo-mcp.mjs\"]'`);
    expect(shellLaunch).toContain(
      `'mcp_servers.exo.env={EXO_MCP_AUTOSTART=\"1\", EXO_MCP_SEARCH_TIMEOUT_MS=\"30000\", EXO_MCP_START_COMMAND=\"${exoRoot}/bin/exo dev\"}'`,
    );
  });
});

async function workspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-codex-readiness-"));
  tempPaths.push(workspaceRoot);
  return workspaceRoot;
}

function managerForWorkspace(workspaceRoot: string): TerminalManager {
  vi.stubEnv("EXO_WORKSPACE_ROOT", workspaceRoot);
  vi.stubEnv("EXO_NOTE_ROOTS", path.join(workspaceRoot, "notes"));
  vi.stubEnv("EXO_PROJECT_ROOTS", path.join(workspaceRoot, "projects"));
  vi.stubEnv("EXO_DEFAULT_TERMINAL_CWD", workspaceRoot);
  vi.stubEnv("EXO_RUNTIME_ROOT", path.join(workspaceRoot, ".exo"));
  vi.stubEnv("EXO_CODEX_COMMAND", "codex");
  return new TerminalManager(workspaceRoot);
}

function bracketedPaste(data: string): string {
  return `\x1b[200~${data}\x1b[201~`;
}
