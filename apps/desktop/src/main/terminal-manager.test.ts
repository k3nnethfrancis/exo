import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TerminalRuntime, TerminalRuntimeCreateSessionOptions, TerminalRuntimeProcess, TerminalRuntimeSession } from "./terminal-runtime";
import { TerminalManager } from "./terminal-manager";

describe("TerminalManager direct pty runtime", () => {
  it("creates shell terminals through the runtime", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalRuntime();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);

    const terminal = await manager.create({ kind: "shell", cwd: root });

    expect(terminal).toMatchObject({
      id: "term-1",
      terminalKind: "shell",
      harnessId: null,
      kind: "shell",
      cwd: root,
      status: "running",
      readiness: "ready",
    });
    expect(runtime.created[0]).toMatchObject({
      cwd: root,
      cols: expect.any(Number),
      rows: expect.any(Number),
    });
    expect(manager.diagnostics()[0]).toMatchObject({
      id: terminal.id,
      runtime: "pty",
      bridgeStatus: "attached",
      paneStatus: "alive",
      transcriptPath: undefined,
    });
  });

  it("passes spaces and printable input through byte-for-byte", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalRuntime();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });
    const process = runtime.processes[0];

    await manager.write(terminal.id, "hello world with spaces");

    expect(process.writes).toEqual(["hello world with spaces"]);
  });

  it("submits semantic messages with a carriage return after the prompt", async () => {
    vi.useFakeTimers();
    try {
      const root = await tempWorkspace();
      const runtime = new FakeTerminalRuntime();
      const manager = new TerminalManager(root, 500, 0, { agentSubmitDelayMs: 25 }, runtime);
      const terminal = await manager.create({ kind: "shell", cwd: root });
      const process = runtime.processes[0];

      await manager.sendMessage(terminal.id, "read this document", true);
      expect(process.writes).toEqual(["read this document"]);
      await vi.advanceTimersByTimeAsync(25);
      expect(process.writes).toEqual(["read this document", "\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams output to live tails without transcript persistence", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalRuntime();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });

    runtime.processes[0].emitData("line-1\nline-2\n");

    expect(manager.readTail(terminal.id)).toBe("line-1\nline-2\n");
    expect(manager.readTranscript(terminal.id)).toBe("line-1\nline-2\n");
    expect(manager.getInfo(terminal.id)?.transcriptPath).toBeUndefined();
  });

  it("resizes the pty from renderer geometry", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalRuntime();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });
    const process = runtime.processes[0];

    await manager.resize(terminal.id, 120, 36);

    expect(process.resizes.at(-1)).toEqual({ cols: 120, rows: 36 });
    expect(manager.getInfo(terminal.id)?.geometry).toMatchObject({ cols: 120, rows: 36 });
  });

  it("marks exited terminals and rejects later writes", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalRuntime();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });

    runtime.processes[0].emitExit(0);

    expect(manager.getInfo(terminal.id)).toMatchObject({ status: "exited", exitCode: 0 });
    await expect(manager.write(terminal.id, "after exit")).resolves.toMatchObject({ ok: false, delivery: "not-found" });
  });
});

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "exo-terminal-manager-"));
}

class FakeTerminalRuntime implements TerminalRuntime {
  readonly kind = "pty" as const;
  readonly created: TerminalRuntimeCreateSessionOptions[] = [];
  readonly processes: FakeTerminalProcess[] = [];

  availability() {
    return { available: true as const };
  }

  createSession(options: TerminalRuntimeCreateSessionOptions): TerminalRuntimeSession {
    this.created.push(options);
    const process = new FakeTerminalProcess();
    this.processes.push(process);
    return {
      sessionName: `fake-${this.processes.length}`,
      paneId: `fake-pane-${this.processes.length}`,
      process,
    };
  }

  attachSession(): TerminalRuntimeProcess {
    throw new Error("not supported");
  }

  listPanes() {
    return [];
  }

  applySessionOptions(): void {}

  captureTailForDisplay(): string {
    return "";
  }

  captureRestoreSnapshot() {
    return { content: "", cols: 0, rows: 0, altScreen: false };
  }

  terminate(sessionName: string): void {
    const index = Number(sessionName.replace("fake-", "")) - 1;
    this.processes[index]?.kill();
  }
}

class FakeTerminalProcess implements TerminalRuntimeProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(event: { exitCode?: number }) => void>();

  onData(handler: (data: string) => void): void {
    this.dataHandlers.add(handler);
  }

  onExit(handler: (event: { exitCode?: number }) => void): void {
    this.exitHandlers.add(handler);
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.emitExit(undefined);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }

  emitExit(exitCode?: number): void {
    for (const handler of this.exitHandlers) {
      handler({ exitCode });
    }
  }
}
