import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ptyState = vi.hoisted(() => ({
  spawned: [] as Array<{
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
      spawn: vi.fn(() => {
        const fake = new FakePty();
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

    const writeResult = await manager.write(agent.id, "Fix the issue\r");

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

  it("flushes queued Codex text after the startup grace when no prompt appears", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.write(agent.id, "Start cleanly\r")).resolves.toMatchObject({
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

  it("lets raw non-submitted input through so a user can answer interstitials", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const agent = await manager.create({ kind: "codex", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];

    await expect(manager.write(agent.id, "y")).resolves.toMatchObject({ delivery: "sent" });

    expect(pty.writes).toEqual(["y"]);
  });

  it("caps live renderer buffers while transcripts keep receiving data", async () => {
    const workspaceRoot = await workspaceFixture();
    const manager = managerForWorkspace(workspaceRoot);

    const terminal = await manager.create({ kind: "shell", cwd: workspaceRoot });
    const pty = ptyState.spawned[0];
    const largeChunk = "x".repeat(300_000);

    pty.emitData(largeChunk);

    expect(manager.readBuffer(terminal.id)?.length).toBe(250_000);
    expect(manager.readTranscript(terminal.id)).toContain(largeChunk.slice(0, 100));
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
