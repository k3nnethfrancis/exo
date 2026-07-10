import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  AgentCommandTrustStore,
  createDefaultClaudeAgentCommand,
  type WorkspaceSettings,
} from "@exo/core";

import { AgentCommandInvocationError, AgentCommandInvocationService } from "./agent-command-invocation-service";
import type { InvocationObservationService } from "./invocation-observation-service";
import type { TerminalManager } from "./terminal-manager";

describe("AgentCommandInvocationService", () => {
  it("rejects CLI spawn until app-local trust exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-workspace-"));
    const trustStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-trust-"));
    const terminalManager = fakeTerminalManager();
    const service = new AgentCommandInvocationService({
      getWorkspaceSettings: () => workspaceSettings(workspaceRoot),
      trustStateRoot,
      terminalManager,
      observationService: fakeObservationService(),
    });

    await expect(service.spawnFromCli({ handle: "@claude", task: "review this" })).rejects.toMatchObject({
      code: "agent-command-untrusted",
    } satisfies Partial<AgentCommandInvocationError>);

    await new AgentCommandTrustStore(trustStateRoot, workspaceRoot).trust(createDefaultClaudeAgentCommand());
    await expect(service.spawnFromCli({ handle: "@claude", task: "review this" })).resolves.toMatchObject({
      ok: true,
      invocation: { context: "cli", message: "review this" },
      terminal: { id: "terminal-1" },
    });
  });

  it("runs note invocations one-shot without persisting trust", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-workspace-"));
    const trustStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-trust-"));
    const command = createDefaultClaudeAgentCommand();
    const service = new AgentCommandInvocationService({
      getWorkspaceSettings: () => workspaceSettings(workspaceRoot),
      trustStateRoot,
      terminalManager: fakeTerminalManager(),
      observationService: fakeObservationService(),
    });

    await expect(service.launchNoteInvocation({
      handle: "@claude",
      documentPath: path.join(workspaceRoot, "note.md"),
      mentionText: "@claude summarize this",
      message: "summarize this",
      allowUntrustedOneShot: true,
    })).resolves.toMatchObject({
      ok: true,
      invocation: { context: "note", message: "summarize this" },
    });

    await expect(new AgentCommandTrustStore(trustStateRoot, workspaceRoot).status(command)).resolves.toMatchObject({
      trusted: false,
    });
  });

  it("persists note invocation trust only when explicitly requested", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-workspace-"));
    const trustStateRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-command-service-trust-"));
    const command = createDefaultClaudeAgentCommand();
    const service = new AgentCommandInvocationService({
      getWorkspaceSettings: () => workspaceSettings(workspaceRoot),
      trustStateRoot,
      terminalManager: fakeTerminalManager(),
      observationService: fakeObservationService(),
    });

    await service.launchNoteInvocation({
      handle: "@claude",
      documentPath: path.join(workspaceRoot, "note.md"),
      mentionText: "@claude summarize this",
      message: "summarize this",
      persistTrust: true,
    });

    await expect(new AgentCommandTrustStore(trustStateRoot, workspaceRoot).status(command)).resolves.toMatchObject({
      trusted: true,
    });
  });
});

function workspaceSettings(workspaceRoot: string): WorkspaceSettings {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [workspaceRoot],
    projectRoots: [],
    agentCommands: [createDefaultClaudeAgentCommand()],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "filesystem" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryLines: 100_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}

function fakeTerminalManager(): TerminalManager {
  return {
    createAgentCommand: vi.fn(async (command, cwd) => ({
      id: "terminal-1",
      terminalKind: "shell",
      harnessId: null,
      kind: "shell",
      title: command.label,
      cwd,
      command: command.command,
      status: "running",
      transcriptPath: path.join(cwd, ".exo", "terminal-transcripts", "terminal-1.ansi.log"),
      attachGeneration: 1,
    })),
    sendMessage: vi.fn(async () => ({ ok: true, delivery: "sent" })),
  } as unknown as TerminalManager;
}

function fakeObservationService(): InvocationObservationService {
  return {
    snapshotTaggedDocument: vi.fn(async () => null),
    observe: vi.fn(async () => {}),
  } as unknown as InvocationObservationService;
}
