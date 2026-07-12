import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from "./terminal-runtime";
import { TerminalManager } from "./terminal-manager";

describe("TerminalManager direct PTY", () => {
  it("keeps byte-faithful input and a bounded in-memory tail", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-terminal-manager-"));
    const factory = new FakeTerminalProcessFactory();
    const manager = new TerminalManager(root, 1_024, {}, factory);
    const terminal = await manager.create({ terminalKind: "shell", cwd: root });

    await manager.write(terminal.id, "hello world\u001b[?1000h");
    factory.process.emitData(`${"a".repeat(16)}${"b".repeat(1_024)}`);

    expect(factory.process.writes).toEqual(["hello world\u001b[?1000h"]);
    expect(manager.readTail(terminal.id)).toBe("b".repeat(1_024));
    expect(terminal).toMatchObject({ kind: "shell", cwd: root, status: "running" });
  });
});

class FakeTerminalProcessFactory implements TerminalProcessFactory {
  readonly process = new FakeTerminalProcess();
  create(_options: TerminalProcessOptions): TerminalProcess { return this.process; }
}

class FakeTerminalProcess implements TerminalProcess {
  readonly writes: string[] = [];
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(event: { exitCode?: number }) => void>();
  onData(handler: (data: string) => void): void { this.dataHandlers.add(handler); }
  onExit(handler: (event: { exitCode?: number }) => void): void { this.exitHandlers.add(handler); }
  write(data: string): void { this.writes.push(data); }
  resize(): void {}
  kill(): void { for (const handler of this.exitHandlers) handler({ exitCode: 0 }); }
  emitData(data: string): void { for (const handler of this.dataHandlers) handler(data); }
}
