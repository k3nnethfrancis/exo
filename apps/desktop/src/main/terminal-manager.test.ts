import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveRuntimeConfig } from "@exo/core";

import type { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from "./terminal-runtime";
import { TerminalManager } from "./terminal-manager";

describe("TerminalManager direct pty runtime", () => {
  it("creates shell terminals through the runtime", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
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

  it.each([
    {
      name: "an argument-free echo fixture",
      command: "/bin/cat",
      rawArgs: "",
      expectedArgs: [],
    },
    {
      name: "a scripted shell fixture",
      command: "/bin/sh",
      rawArgs: "-lc,printf 'fixture ready\\n'; cat",
      expectedArgs: ["-lc", "printf 'fixture ready\\n'; cat"],
    },
  ])("launches $name with the configured executable and arguments", async ({ command, rawArgs, expectedArgs }) => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    manager.setRuntimeConfig(resolveRuntimeConfig({
      ...process.env,
      EXO_WORKSPACE_ROOT: root,
      EXO_DEFAULT_TERMINAL_CWD: root,
      EXO_NOTE_ROOTS: root,
      EXO_RUNTIME_ROOT: path.join(root, ".exo"),
      EXO_SHELL: command,
      EXO_SHELL_ARGS: rawArgs,
    }));

    await manager.create({ kind: "shell", cwd: root });

    expect(runtime.created[0]).toMatchObject({
      command,
      args: expectedArgs,
    });
  });

  it.each(["/bin/zsh", "/bin/bash"])("keeps the ordinary user shell launcher %s when no Exo test override is configured", async (userShell) => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    manager.setRuntimeConfig(resolveRuntimeConfig({
      ...process.env,
      SHELL: userShell,
      EXO_SHELL: undefined,
      EXO_SHELL_ARGS: undefined,
      EXO_WORKSPACE_ROOT: root,
      EXO_DEFAULT_TERMINAL_CWD: root,
      EXO_NOTE_ROOTS: root,
      EXO_RUNTIME_ROOT: path.join(root, ".exo"),
    }));

    await manager.create({ kind: "shell", cwd: root });

    expect(runtime.created[0]).toMatchObject({
      command: userShell,
      args: ["-l"],
    });
  });

  it("passes spaces and printable input through byte-for-byte", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
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
      const runtime = new FakeTerminalProcessFactory();
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

  it("streams output to the bounded live tail used for reload and operator reads", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });

    runtime.processes[0].emitData("line-1\nline-2\n");

    expect(manager.readTail(terminal.id)).toBe("line-1\nline-2\n");
    expect(manager.readRestoreSnapshot(terminal.id)).toBe("line-1\nline-2\n");
    expect(manager.readTranscript(terminal.id)).toBe("line-1\nline-2\n");
    expect(manager.getInfo(terminal.id)?.transcriptPath).toBeUndefined();
  });

  it("keeps a character-bounded replay tail even when pty output has no newlines", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 1_024, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });

    const output = `${"a".repeat(16)}${"b".repeat(1_024)}`;
    runtime.processes[0].emitData(output);

    expect(manager.readTail(terminal.id)).toBe("b".repeat(1_024));
  });

  it("passes terminal control bytes through unchanged, including mouse-mode sequences", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });
    const data = "\u001b[?1000h\u001b[?1006h";
    const received: string[] = [];
    manager.on("data", (event) => received.push(event.data));

    runtime.processes[0].emitData(data);

    expect(received).toEqual([data]);
    expect(manager.readTail(terminal.id)).toBe(data);
  });

  it("resizes the pty from renderer geometry", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 500, 0, {}, runtime);
    const terminal = await manager.create({ kind: "shell", cwd: root });
    const process = runtime.processes[0];

    await manager.resize(terminal.id, 120, 36);

    expect(process.resizes.at(-1)).toEqual({ cols: 120, rows: 36 });
    expect(manager.getInfo(terminal.id)?.geometry).toMatchObject({ cols: 120, rows: 36 });
  });

  it("marks exited terminals and rejects later writes", async () => {
    const root = await tempWorkspace();
    const runtime = new FakeTerminalProcessFactory();
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

class FakeTerminalProcessFactory implements TerminalProcessFactory {
  readonly created: TerminalProcessOptions[] = [];
  readonly processes: FakeTerminalProcess[] = [];

  create(options: TerminalProcessOptions): TerminalProcess {
    this.created.push(options);
    const process = new FakeTerminalProcess();
    this.processes.push(process);
    return process;
  }
}

class FakeTerminalProcess implements TerminalProcess {
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
