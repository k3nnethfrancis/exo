import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentCommandTrustStore, agentCommandExecutableFingerprint, createDefaultClaudeAgentCommand, formatDocumentAgentInvocation, InvocationContinuityStore, type WorkspaceSettings } from "@exo/core";

import type { TerminalManager } from "./terminal-manager";
import { commandForClaudeResume, commandForHeadlessInvocation, extractClaudeSessionId, InvocationRunner, InvocationRunnerError } from "./invocation-runner";
import { DirectInvocationProcessFactory, type InvocationProcess, type InvocationProcessExit, type InvocationProcessFactory } from "./invocation-process";
import type { WorkspaceWatcherService } from "./workspace-watchers";

const temporaryRoots: string[] = [];
const TEST_PROTOCOL_INVOCATION_ID = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("InvocationRunner readiness parity", () => {
  it("uses the same facts and cwd as prepare", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
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
    const command = { ...createDefaultClaudeAgentCommand(), id: "missing", handle: "missing", command: "definitely-not-an-executable", adapter: "generic" as const, continuityPolicy: "fresh" as const };
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
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager);

    await expect(runner.testCommand(command.id, "stale-fingerprint")).rejects.toMatchObject({ code: "fingerprint-drift" });
    expect(terminalManager.created).toBe(0);
  });

  it("creates a normal visible CLI invocation record after confirmed one-shot authorization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
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

  it("derives note authorization facts and trust from the exact main-process context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-authorization-"));
    temporaryRoots.push(root);
    const noteDirectory = path.join(root, "notes");
    const notePath = path.join(noteDirectory, "note.md");
    await mkdir(noteDirectory);
    await writeFile(notePath, "# Note\n", "utf8");
    const command = {
      ...createDefaultClaudeAgentCommand(),
      command: process.execPath,
      cwdPolicy: "note_dir" as const,
    };
    const runner = createRunner(settings(root, command));

    await expect(runner.getInvocationAuthorization(command.handle, notePath)).resolves.toMatchObject({
      command,
      cwd: noteDirectory,
      fingerprint: agentCommandExecutableFingerprint(command),
      launchable: true,
      trusted: false,
    });
    await new AgentCommandTrustStore(root, root).trust(command);
    await expect(runner.getInvocationAuthorization(command.handle, notePath)).resolves.toMatchObject({ trusted: true });
  });

  it("runs once without persisting Command trust", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-run-once-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath, continuityPolicy: "fresh" as const };
    const documentBody = protocolNoteBody("# Note\n", command.handle, "Review this.");
    await writeFile(notePath, documentBody, "utf8");
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);
    const prepared = await runner.prepare(invocationRequest(notePath, documentBody));

    await runner.authorizeAndStart(prepared, authorizationFor(prepared, "run-once"));

    expect(processFactory.processes).toHaveLength(1);
    await expect(new AgentCommandTrustStore(root, root).status(command)).resolves.toMatchObject({ trusted: false });
  });

  it("persists trust only for the exact always-allowed Command fingerprint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-always-allow-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath, continuityPolicy: "fresh" as const };
    const documentBody = protocolNoteBody("# Note\n", command.handle, "Review this.");
    await writeFile(notePath, documentBody, "utf8");
    const runner = createRunner(settings(root, command));
    const prepared = await runner.prepare(invocationRequest(notePath, documentBody));

    await runner.authorizeAndStart(prepared, authorizationFor(prepared, "always-allow"));

    const store = new AgentCommandTrustStore(root, root);
    await expect(store.status(command)).resolves.toMatchObject({
      trusted: true,
      executableFingerprint: agentCommandExecutableFingerprint(command),
    });
    await expect(store.status({ ...command, command: "/bin/echo" })).resolves.toMatchObject({ trusted: false });
    await expect(runner.resetCommandTrust(command.handle)).resolves.toEqual({ revoked: true });
    await expect(store.status(command)).resolves.toMatchObject({ trusted: false });
  });

  it.each(["run-once", "always-allow"] as const)(
    "rejects %s after Command drift without launching or persisting trust",
    async (kind) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-fingerprint-drift-"));
      temporaryRoots.push(root);
      const notePath = path.join(root, "note.md");
      const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath, continuityPolicy: "fresh" as const };
      const documentBody = protocolNoteBody("# Note\n", command.handle, "Review this.");
      await writeFile(notePath, documentBody, "utf8");
      let currentSettings = settings(root, command);
      const processFactory = new FakeInvocationProcessFactory();
      const runner = new InvocationRunner({
        getWorkspaceSettings: () => currentSettings,
        trustStateRoot: root,
        terminalManager: new FakeTerminalManager() as unknown as TerminalManager,
        invocationProcessFactory: processFactory,
        workspaceWatcherService: { subscribe: () => () => undefined } as unknown as WorkspaceWatcherService,
      });
      const prepared = await runner.prepare(invocationRequest(notePath, documentBody));
      const changed = { ...command, command: "/bin/echo" };
      currentSettings = { ...currentSettings, agentCommands: [changed] };

      await expect(runner.authorizeAndStart(prepared, authorizationFor(prepared, kind))).rejects.toMatchObject({
        code: "fingerprint-drift",
      });
      expect(processFactory.processes).toHaveLength(0);
      const store = new AgentCommandTrustStore(root, root);
      await expect(store.status(command)).resolves.toMatchObject({ trusted: false });
      await expect(store.status(changed)).resolves.toMatchObject({ trusted: false });
    },
  );

  it("runs inline invocations headlessly and delivers the current note body and frontmatter once", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
    const terminalManager = new FakeTerminalManager();
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), terminalManager, processFactory);
    const documentBody = protocolNoteBody("# Current note\n\nThis is the current editor content.", command.handle, "Summarize this note.");
    await writeFile(
      path.join(root, "note.md"),
      `---\ntags:\n  - project\n---\n${documentBody}`,
      "utf8",
    );
    const prepared = await runner.prepare({
      context: "note",
      handle: command.handle,
      documentPath: path.join(root, "note.md"),
      mentionText: "@echo",
      message: "Summarize this note.",
      protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID,
      documentFrontmatter: { tags: ["project"] },
      documentBody,
    });

    const result = await runner.authorizeAndStart(prepared, authorizationFor(prepared));

    expect(result.terminal).toBeUndefined();
    expect(terminalManager.created).toBe(0);
    expect(processFactory.process.prompts).toHaveLength(1);
    expect(processFactory.process.prompts[0]).toContain("This is the current editor content.");
    expect(processFactory.process.prompts[0]).toContain('"project"');
    expect(processFactory.process.prompts[0]).toContain("Exo document-agent protocol:");
    expect(processFactory.process.prompts[0]).toContain(`<exo-agent-response invocation="${TEST_PROTOCOL_INVOCATION_ID}" agent="echo">`);
  });

  it("pins record settlement to the Workspace where the invocation was prepared", async () => {
    const workspaceA = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-workspace-a-"));
    const workspaceB = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-workspace-b-"));
    temporaryRoots.push(workspaceA, workspaceB);
    const notePath = path.join(workspaceA, "note.md");
    const documentBody = protocolNoteBody("# Workspace A\n", "echo", "Update this note.");
    await writeFile(notePath, documentBody, "utf8");
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
    let activeSettings = settings(workspaceA, command);
    const processFactory = new FakeInvocationProcessFactory();
    const runner = new InvocationRunner({
      getWorkspaceSettings: () => activeSettings,
      trustStateRoot: workspaceA,
      terminalManager: new FakeTerminalManager() as unknown as TerminalManager,
      invocationProcessFactory: processFactory,
      workspaceWatcherService: { subscribe: () => () => undefined } as unknown as WorkspaceWatcherService,
    });
    const prepared = await runner.prepare({
      context: "note",
      handle: command.handle,
      documentPath: notePath,
      mentionText: "@echo",
      message: "Update this note.",
      protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID,
      documentBody,
    });
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    await runner.authorizeAndStart(prepared, authorizationFor(prepared));
    activeSettings = settings(workspaceB, command);
    await writeFile(notePath, "# Changed in Workspace A\n", "utf8");
    processFactory.process.exit(0, "done");

    const completed = await updated;
    expect(completed).toMatchObject({ status: "process-exited", workspaceRoot: workspaceA, review: { status: "pending" } });
    await expect(readFile(path.join(workspaceA, ".exo", "invocations", prepared.id, "record.json"), "utf8"))
      .resolves.toContain('"status": "process-exited"');
    await expect(readFile(path.join(workspaceB, ".exo", "invocations", prepared.id, "record.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(runner.getReview(prepared.id)).resolves.toMatchObject({
      invocation: { workspaceRoot: workspaceA },
      before: documentBody,
      after: "# Changed in Workspace A\n",
    });
    await runner.rejectReview(prepared.id, completed.review?.afterSha256 ?? null);
    await expect(readFile(notePath, "utf8")).resolves.toBe(documentBody);
  });

  it("continues a Claude conversation from the validated Workspace-local head", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-continuity-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const documentBody = protocolNoteBody("# Context\n", command.handle, "Remember this.");
    await writeFile(notePath, documentBody, "utf8");
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);

    const firstUpdated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));
    const firstPrepared = await runner.prepare(invocationRequest(notePath, documentBody));
    await runner.authorizeAndStart(firstPrepared, authorizationFor(firstPrepared));
    processFactory.process.exit(0, JSON.stringify({ session_id: "ce4b9e26-2574-4433-a054-1110cd403792" }));
    const first = await firstUpdated;
    expect(first.continuity).toEqual({ policy: "continuous", outcome: "fresh" });

    const secondUpdated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));
    const secondPrepared = await runner.prepare(invocationRequest(notePath, documentBody));
    await runner.authorizeAndStart(secondPrepared, authorizationFor(secondPrepared));
    expect(processFactory.inputs.at(-1)?.command).toContain("--resume 'ce4b9e26-2574-4433-a054-1110cd403792'");
    processFactory.process.exit(0, JSON.stringify({ session_id: "ce4b9e26-2574-4433-a054-1110cd403792" }));
    await expect(secondUpdated).resolves.toMatchObject({
      continuity: { policy: "continuous", outcome: "resumed", resumedFromInvocationId: first.id },
    });
  });

  it("falls back fresh once only for the proven pre-turn stale Claude signature", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-stale-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const documentBody = protocolNoteBody("# Context\n", command.handle, "Continue this.");
    await writeFile(notePath, documentBody, "utf8");
    const staleId = "ce4b9e26-2574-4433-a054-1110cd403792";
    const freshId = "de4b9e26-2574-4433-a054-1110cd403793";
    const continuityStore = new InvocationContinuityStore(root);
    await continuityStore.writeHead({
      workspaceRoot: root,
      commandId: command.id,
      commandFingerprint: agentCommandExecutableFingerprint(command),
      adapter: "claude-code",
      cwd: root,
    }, { providerSessionId: staleId, sourceInvocationId: "prior-invocation" });
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    const prepared = await runner.prepare(invocationRequest(notePath, documentBody));
    await runner.authorizeAndStart(prepared, authorizationFor(prepared));
    processFactory.process.exit(1, "", `No conversation found with session ID: ${staleId}\n`);
    await expect.poll(() => processFactory.processes.length).toBe(2);
    expect(processFactory.inputs.at(-1)?.command).not.toContain("--resume");
    processFactory.process.exit(0, JSON.stringify({ session_id: freshId }));

    await expect(updated).resolves.toMatchObject({
      providerSessionId: freshId,
      continuity: { policy: "continuous", outcome: "resume-failed-fresh", resumedFromInvocationId: "prior-invocation" },
    });
  });

  it("does not retry or advance the head after an unknown resume failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-resume-failure-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const documentBody = protocolNoteBody("# Context\n", command.handle, "Continue this.");
    await writeFile(notePath, documentBody, "utf8");
    const staleId = "ce4b9e26-2574-4433-a054-1110cd403792";
    const lane = {
      workspaceRoot: root,
      commandId: command.id,
      commandFingerprint: agentCommandExecutableFingerprint(command),
      adapter: "claude-code" as const,
      cwd: root,
    };
    const continuityStore = new InvocationContinuityStore(root);
    await continuityStore.writeHead(lane, { providerSessionId: staleId, sourceInvocationId: "prior-invocation" });
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    const prepared = await runner.prepare(invocationRequest(notePath, documentBody));
    await runner.authorizeAndStart(prepared, authorizationFor(prepared));
    processFactory.process.exit(1, "", "Authentication failed\n");

    await expect(updated).resolves.toMatchObject({
      status: "failed",
      continuity: { policy: "continuous", outcome: "resume-failed", resumedFromInvocationId: "prior-invocation" },
    });
    expect(processFactory.processes).toHaveLength(1);
    await expect(continuityStore.readHead(lane)).resolves.toMatchObject({
      providerSessionId: staleId,
      sourceInvocationId: "prior-invocation",
    });
  });

  it("rejects concurrent work in one continuity lane and releases the lane after exit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-busy-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const documentBody = protocolNoteBody("# Context\n", command.handle, "Work.");
    await writeFile(notePath, documentBody, "utf8");
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);
    const first = await runner.prepare(invocationRequest(notePath, documentBody));
    await runner.authorizeAndStart(first, authorizationFor(first));

    const second = await runner.prepare(invocationRequest(notePath, documentBody));
    await expect(runner.authorizeAndStart(second, authorizationFor(second))).rejects.toMatchObject({ code: "continuity-busy" });
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));
    processFactory.process.exit(0, JSON.stringify({ session_id: "ce4b9e26-2574-4433-a054-1110cd403792" }));
    await updated;

    const third = await runner.prepare(invocationRequest(notePath, documentBody));
    await expect(runner.authorizeAndStart(third, authorizationFor(third))).resolves.toMatchObject({ ok: true });
  });

  it("reports and resets only the current Workspace Command context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-reset-"));
    temporaryRoots.push(root);
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const lane = {
      workspaceRoot: root,
      commandId: command.id,
      commandFingerprint: agentCommandExecutableFingerprint(command),
      adapter: "claude-code" as const,
      cwd: root,
    };
    await new InvocationContinuityStore(root).writeHead(lane, {
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      sourceInvocationId: "prior-invocation",
    });
    const runner = createRunner(settings(root, command));

    await expect(runner.getCommandContinuityStatus(command.id)).resolves.toMatchObject({
      commandId: command.id,
      supported: true,
      policy: "continuous",
      hasHead: true,
      active: false,
    });
    await expect(runner.resetCommandContinuity(command.id)).resolves.toEqual({ cleared: 1 });
    await expect(runner.getCommandContinuityStatus(command.id)).resolves.toMatchObject({ hasHead: false });
  });

  it("refuses to baseline an editor snapshot that is not the saved document", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    await writeFile(notePath, "# Saved\n", "utf8");
    const command = { ...createDefaultClaudeAgentCommand(), id: "echo", handle: "echo", label: "Echo", command: "/bin/echo", adapter: "generic" as const, continuityPolicy: "fresh" as const };
    const runner = createRunner(settings(root, command));

    await expect(runner.prepare({
      context: "note",
      handle: "echo",
      documentPath: notePath,
      mentionText: "@echo",
      message: "Update this.",
      documentBody: "# Stale editor body\n",
    })).rejects.toMatchObject({ code: "document-drift" });
  });

  it("executes a configured note command through stdin without creating a terminal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const promptPath = path.join(root, "received-prompt.txt");
    const documentBody = protocolNoteBody("# Before\n", "fake-headless", "Replace the title.");
    await writeFile(notePath, documentBody, "utf8");
    const command = {
      ...createDefaultClaudeAgentCommand(), id: "fake-headless", handle: "fake-headless", label: "Fake headless",
      adapter: "generic" as const, continuityPolicy: "fresh" as const,
      command: `/bin/sh -c 'cat > "${promptPath}"; printf "# After\\n" > "${notePath}"'`,
    };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager, new DirectInvocationProcessFactory());
    const updated = new Promise<unknown>((resolve) => runner.once("updated", resolve));

    const result = await startPrepared(runner, {
      context: "note", handle: command.handle, documentPath: notePath, mentionText: "@fake-headless",
      message: "Replace the title.", protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID, documentBody,
    });

    expect(result.terminal).toBeUndefined();
    expect(terminalManager.created).toBe(0);
    await expect(updated).resolves.toMatchObject({ status: "process-exited", changedFileRefs: [{ path: notePath, kind: "modified" }] });
    await expect(readFile(promptPath, "utf8")).resolves.toContain("Replace the title.");
  });

  it("records a failed headless command instead of implying it completed without changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const documentBody = protocolNoteBody("# Before\n", "fails", "Test failure.");
    await writeFile(notePath, documentBody, "utf8");
    const command = {
      ...createDefaultClaudeAgentCommand(), id: "fails", handle: "fails", label: "Fails",
      adapter: "generic" as const, continuityPolicy: "fresh" as const,
      command: "/bin/sh -c 'exit 17'",
    };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager, new DirectInvocationProcessFactory());
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    await startPrepared(runner, {
      context: "note", handle: command.handle, documentPath: notePath, mentionText: "@fails",
      message: "Test failure.", protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID, documentBody,
    });

    await expect(updated).resolves.toMatchObject({
      status: "failed",
      exitCode: 17,
      failureReason: "Command exited with code 17.",
    });
  });

  it("captures only a real Claude JSON session id and stores it with the reviewed change", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const documentBody = protocolNoteBody("# Before\n", "claude", "Update this.");
    await writeFile(notePath, documentBody, "utf8");
    const sessionId = "ce4b9e26-2574-4433-a054-1110cd403792";
    const command = {
      ...createDefaultClaudeAgentCommand(),
      command: `/bin/sh -c 'printf "# After\\n" > "${notePath}"; printf "{\\\"session_id\\\":\\\"${sessionId}\\\"}\\n"'`,
    };
    const terminalManager = new FakeTerminalManager();
    const runner = createRunner(settings(root, command), terminalManager, new DirectInvocationProcessFactory());
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));
    await startPrepared(runner, {
      context: "note", handle: "claude", documentPath: notePath, mentionText: "@claude", message: "Update this.", protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID, documentBody,
    });
    const completed = await updated;
    expect(completed).toMatchObject({
      providerSessionId: sessionId,
      review: { status: "pending" },
    });
    const review = await runner.getReview(completed.id);
    expect(review).toMatchObject({ canReject: true, before: documentBody, after: "# After\n" });
    expect(review?.patch).toContain("-# Before");
    const rejected = await runner.rejectReview(completed.id, completed.review?.afterSha256 ?? null);
    expect(rejected.review).toMatchObject({ status: "rejected" });
    await expect(readFile(notePath, "utf8")).resolves.toBe(documentBody);
    await runner.resumeInTerminal(completed.id);
    expect(terminalManager.commands).toContainEqual(expect.objectContaining({ command: expect.stringContaining(`--resume '${sessionId}'`) }));
  });

  it("does not guess session provenance from malformed output", () => {
    const sessionId = "ce4b9e26-2574-4433-a054-1110cd403792";
    expect(extractClaudeSessionId('{"session_id":"not-a-session"}')).toBeNull();
    expect(extractClaudeSessionId(`ordinary output\n{"session_id":"${sessionId}"}`)).toBe(sessionId);
    expect(extractClaudeSessionId(JSON.stringify([
      { type: "system", session_id: sessionId },
      { type: "result", session_id: sessionId, permission_denials: [] },
    ]))).toBe(sessionId);
    expect(commandForHeadlessInvocation(createDefaultClaudeAgentCommand()))
      .toBe('claude -p --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep" --output-format stream-json --verbose');
    expect(commandForHeadlessInvocation({ ...createDefaultClaudeAgentCommand(), command: "claude -p --permission-mode bypassPermissions" }))
      .toBe("claude -p --permission-mode bypassPermissions --output-format stream-json --verbose");
  });

  it("reports structured Claude permission denials as failures instead of successful no-change runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const documentBody = protocolNoteBody("# Before\n", "claude", "Update this.");
    await writeFile(notePath, documentBody, "utf8");
    const processFactory = new FakeInvocationProcessFactory();
    // This test exercises Claude's structured output semantics, not a locally
    // installed Claude binary. An explicit executable keeps it deterministic
    // on CI and on machines without Claude installed.
    const command = { ...createDefaultClaudeAgentCommand(), command: process.execPath };
    const runner = createRunner(settings(root, command), new FakeTerminalManager(), processFactory);
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    await startPrepared(runner, {
      context: "note", handle: "claude", documentPath: notePath, mentionText: "@claude",
      message: "Update this.", protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID, documentBody,
    });
    processFactory.process.exit(0, JSON.stringify([{ type: "result", subtype: "success", permission_denials: [{ tool_name: "Edit" }] }]));

    await expect(updated).resolves.toMatchObject({
      status: "failed",
      failureReason: "Claude could not edit the document because its write permission was denied.",
    });
  });

  it("fails a protocol invocation when the command prints a response but never writes it into the note", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-runner-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "note.md");
    const documentBody = protocolNoteBody("# Before\n", "claude", "What do you think?");
    await writeFile(notePath, documentBody, "utf8");
    const processFactory = new FakeInvocationProcessFactory();
    const runner = createRunner(settings(root, { ...createDefaultClaudeAgentCommand(), command: process.execPath }), new FakeTerminalManager(), processFactory);
    const updated = new Promise<import("@exo/core").InvocationRecord>((resolve) => runner.once("updated", resolve));

    await startPrepared(runner, {
      context: "note", handle: "claude", documentPath: notePath, mentionText: "@claude",
      message: "What do you think?", protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID, documentBody,
    });
    processFactory.process.exit(0, `<exo-agent-response invocation="${TEST_PROTOCOL_INVOCATION_ID}" agent="claude">Chat only</exo-agent-response>`);

    await expect(updated).resolves.toMatchObject({
      status: "failed",
      failureReason: "@claude finished without writing its linked response into the note.",
      changedFileRefs: [],
    });
  });

  it("resumes with the configured Claude executable, not an assumed global binary", () => {
    const command = { ...createDefaultClaudeAgentCommand(), command: '"/Applications/Claude/bin/claude" -p --output-format json' };
    expect(commandForClaudeResume(command, "ce4b9e26-2574-4433-a054-1110cd403792"))
      .toBe('"/Applications/Claude/bin/claude" --resume \'ce4b9e26-2574-4433-a054-1110cd403792\'');
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

function protocolNoteBody(prefix: string, handle: string, message: string): string {
  return `${prefix.replace(/\n?$/, "\n\n")}${formatDocumentAgentInvocation({
    id: TEST_PROTOCOL_INVOCATION_ID,
    agent: handle,
    message: `@${handle} ${message}`,
  })}\n`;
}

function invocationRequest(notePath: string, documentBody: string) {
  return {
    context: "note" as const,
    handle: "claude",
    documentPath: notePath,
    mentionText: "@claude",
    message: "Continue this.",
    protocolInvocationId: TEST_PROTOCOL_INVOCATION_ID,
    documentBody,
  };
}

function authorizationFor(
  prepared: Awaited<ReturnType<InvocationRunner["prepare"]>>,
  kind: "trusted" | "run-once" | "always-allow" = "run-once",
) {
  return {
    decision: { kind },
    expectedFingerprint: prepared.pending.command.executableFingerprint,
  } as const;
}

async function startPrepared(
  runner: InvocationRunner,
  request: Parameters<InvocationRunner["prepare"]>[0],
) {
  const prepared = await runner.prepare(request);
  return runner.authorizeAndStart(prepared, authorizationFor(prepared));
}

class FakeTerminalManager extends EventEmitter {
  created = 0;
  messages: string[] = [];
  commands: unknown[] = [];

  async createAgentCommand(command: unknown, cwd: string) {
    this.created += 1;
    this.commands.push(command);
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
  readonly processes: FakeInvocationProcess[] = [];
  readonly inputs: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }> = [];

  get process(): FakeInvocationProcess {
    const process = this.processes.at(-1);
    if (!process) throw new Error("No invocation process has launched.");
    return process;
  }

  launch(input: { command: string; cwd: string; env: NodeJS.ProcessEnv }): InvocationProcess {
    this.inputs.push(input);
    const process = new FakeInvocationProcess();
    this.processes.push(process);
    return process;
  }
}

class FakeInvocationProcess implements InvocationProcess {
  prompts: string[] = [];
  private exitHandler: ((event: InvocationProcessExit) => void) | null = null;

  async send(prompt: string): Promise<void> {
    this.prompts.push(prompt);
  }

  onExit(handler: (event: InvocationProcessExit) => void): void {
    this.exitHandler = handler;
  }

  exit(exitCode: number | null, stdout: string, stderr = ""): void {
    this.exitHandler?.({ exitCode, stdout, stderr });
  }

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
