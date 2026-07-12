import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand, type WorkspaceSettings } from "@exo/core";

import type { TerminalManager } from "./terminal-manager";
import { InvocationRunner, InvocationRunnerError } from "./invocation-runner";
import { DirectInvocationProcessFactory, type InvocationProcess, type InvocationProcessFactory } from "./invocation-process";
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

  it("runs inline invocations headlessly and delivers the current note body and frontmatter once", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo" };
    const terminalManager = new FakeTerminalManager();
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), terminalManager, processFactory);
    const prepared = await runner.prepare({
      context: "note",
      handle: command.handle,
      documentPath: path.join(root, "note.md"),
      mentionText: "@echo",
      message: "Summarize this note.",
      documentFrontmatter: { tags: ["project"] },
      documentBody: "# Current note\n\nThis is the current editor content.",
      allowUntrustedOneShot: true,
    });

    const result = await runner.authorizeAndStart(prepared);

    expect(result.terminal).toBeUndefined();
    expect(terminalManager.created).toBe(0);
    expect(processFactory.process.prompts).toHaveLength(1);
    expect(processFactory.process.prompts[0]).toContain("This is the current editor content.");
    expect(processFactory.process.prompts[0]).toContain('"project"');
  });

  it("executes a configured note command through stdin without creating a terminal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const promptPath = path.join(root, "received-prompt.txt");
    await writeFile(notePath, "# Before\n", "utf8");
    const command = {
      ...createDefaultClaudeAgentCommand(), id: "fake-headless", handle: "fake-headless", label: "Fake headless",
      command: `/bin/sh -c 'cat > "${promptPath}"; printf "# After\\n" > "${notePath}"'`,
    };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager, new DirectInvocationProcessFactory());
    const updated = new Promise<unknown>((resolve) => runner.once("updated", resolve));

    const result = await runner.authorizeAndStart(await runner.prepare({
      context: "note", handle: command.handle, documentPath: notePath, mentionText: "@fake-headless",
      message: "Replace the title.", documentBody: "# Before\n", allowUntrustedOneShot: true,
    }));

    expect(result.terminal).toBeUndefined();
    expect(terminalManager.created).toBe(0);
    await expect(updated).resolves.toMatchObject({ status: "process-exited", changedFileRefs: [{ path: notePath, kind: "modified" }] });
    await expect(readFile(promptPath, "utf8")).resolves.toContain("Replace the title.");
  });

  it("records a failed headless command instead of implying it completed without changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    await writeFile(notePath, "# Before\n", "utf8");
    const command = {
      ...createDefaultClaudeAgentCommand(), id: "fails", handle: "fails", label: "Fails",
      command: "/bin/sh -c 'exit 17'",
    };
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), new DirectInvocationProcessFactory());
    const updated = new Promise<unknown>((resolve) => runner.once("updated", resolve));

    await runner.authorizeAndStart(await runner.prepare({
      context: "note", handle: command.handle, documentPath: notePath, mentionText: "@fails",
      message: "Test failure.", documentBody: "# Before\n", allowUntrustedOneShot: true,
    }));

    await expect(updated).resolves.toMatchObject({
      status: "failed",
      exitCode: 17,
      failureReason: "Command exited with code 17.",
    });
  });
});

function createRunner(
  workspaceSettings: WorkspaceSettings,
  terminalManager: EventEmitter = new EventEmitter(),
  invocationProcessFactory: InvocationProcessFactory = new FakeInvocationProcessFactory(),
): InvocationRunner {
  const watcher = { subscribe: () => () => undefined };
  return new InvocationRunner({
    getWorkspaceSettings: () => workspaceSettings,
    trustStateRoot: workspaceSettings.workspaceRoot,
    terminalManager: terminalManager as TerminalManager,
    invocationProcessFactory,
    workspaceWatcherService: watcher as unknown as WorkspaceWatcherService,
  });
}

class FakeTerminalManager extends EventEmitter {
  created = 0;
  messages: string[] = [];

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

  async sendMessage(_id: string, message: string) {
    this.messages.push(message);
    return { ok: true, delivery: "sent" as const };
  }

  async kill() {}
}

class FakeInvocationProcessFactory implements InvocationProcessFactory {
  readonly process = new FakeInvocationProcess();

  launch(): InvocationProcess {
    return this.process;
  }
}

class FakeInvocationProcess implements InvocationProcess {
  prompts: string[] = [];

  async send(prompt: string): Promise<void> {
    this.prompts.push(prompt);
  }

  onExit(_handler: (event: { exitCode: number | null }) => void): void {}

  kill(): void {}
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
