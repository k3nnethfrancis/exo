import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand, type WorkspaceSettings } from "@exo/core";

import type { TerminalManager } from "./terminal-manager";
import { InvocationRunner, InvocationRunnerError } from "./invocation-runner";
import type { WorkspaceWatcherService } from "./workspace-watchers";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("InvocationRunner readiness parity", () => {
  it("uses the same facts and cwd as prepare", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo" };
    const runner = createRunner(settings(root, command));

    const facts = await runner.getCommandLaunchFacts(command.id);
    const prepared = await runner.prepare({ context: "cli", handle: command.handle, message: "test" });

    expect(facts.launchable).toBe(true);
    expect(prepared.cwd).toBe(facts.cwd);
    expect(prepared.command.id).toBe(facts.commandId);
  });

  it("blocks prepare when the readiness facts block launch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "missing", handle: "missing", command: "definitely-not-an-executable" };
    const runner = createRunner(settings(root, command));

    await expect(runner.getCommandLaunchFacts(command.id)).resolves.toMatchObject({
      launchable: false,
      block: "executable-missing",
    });
    await expect(runner.prepare({ context: "cli", handle: command.handle, message: "test" })).rejects.toMatchObject({
      code: "executable-missing",
    } satisfies Partial<InvocationRunnerError>);
  });

  it("rejects fingerprint drift before creating a terminal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo" };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager);

    await expect(runner.testCommand(command.id, "stale-fingerprint")).rejects.toMatchObject({ code: "fingerprint-drift" });
    expect(terminalManager.created).toBe(0);
  });

  it("creates a normal visible CLI invocation record after confirmed one-shot authorization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo" };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager);
    const facts = await runner.getCommandLaunchFacts(command.id);

    const result = await runner.testCommand(command.id, facts.fingerprint);

    expect(terminalManager.created).toBe(1);
    expect(result.terminal).toMatchObject({ id: "terminal-1", status: "running" });
    expect(result.invocation).toMatchObject({
      status: "running",
      context: "cli",
      message: "Test @echo in terminal",
      terminalSessionId: "terminal-1",
      command: { id: command.id },
    });
  });
});

function createRunner(workspaceSettings: WorkspaceSettings, terminalManager: EventEmitter = new EventEmitter()): InvocationRunner {
  const watcher = { subscribe: () => () => undefined };
  return new InvocationRunner({
    getWorkspaceSettings: () => workspaceSettings,
    trustStateRoot: workspaceSettings.workspaceRoot,
    terminalManager: terminalManager as TerminalManager,
    workspaceWatcherService: watcher as unknown as WorkspaceWatcherService,
  });
}

class FakeTerminalManager extends EventEmitter {
  created = 0;

  async createAgentCommand(_command: unknown, cwd: string) {
    this.created += 1;
    return {
      id: `terminal-${this.created}`,
      title: "Echo",
      cwd,
      kind: "shell" as const,
      command: "/bin/echo",
      status: "running" as const,
      attachGeneration: 1,
    };
  }

  async sendMessage() {
    return { ok: true, delivery: "sent" as const };
  }

  async kill() {}
}

function settings(workspaceRoot: string, command: ReturnType<typeof createDefaultClaudeAgentCommand>): WorkspaceSettings {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [workspaceRoot],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    agentCommands: [command],
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    explorerScale: 1,
    exploreIndexSearchOnEnter: true,
    indexUpdateStrategy: "manual",
  };
}
