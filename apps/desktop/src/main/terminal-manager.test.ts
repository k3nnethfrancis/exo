import { mkdtemp, rm } from "node:fs/promises";
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

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
  execFileSync: vi.fn(() => ""),
}));

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

    expect(manager.readBuffer(terminal.id)).toBe(lines.slice(-500).join("\n"));
    expect(manager.readTranscript(terminal.id)).toContain("line-1");
  });

  it("launches Codex with an explicit Exo MCP config for the current checkout", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    await manager.create({ kind: "codex", cwd: workspaceRoot });

    const pty = ptyState.spawned[0];
    const exoRoot = path.resolve(process.cwd(), "../..");
    expect(pty.command).toBe("codex");
    expect(pty.args).toContain("-c");
    expect(pty.args).toContain(`mcp_servers.exo.command="node"`);
    expect(pty.args).toContain(`mcp_servers.exo.args=["${exoRoot}/packages/mcp/bin/exo-mcp.mjs"]`);
    expect(pty.args).toContain(
      `mcp_servers.exo.env={EXO_MCP_AUTOSTART="1", EXO_MCP_SEARCH_TIMEOUT_MS="30000", EXO_MCP_START_COMMAND="${exoRoot}/bin/exo dev"}`,
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
