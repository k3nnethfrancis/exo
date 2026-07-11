import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  AgentCommandTrustStore,
  agentCommandSnapshot,
  formatCliInvocationPrompt,
  formatNoteInvocationPrompt,
  InvocationStore,
  normalizeAgentHandle,
  type AgentCommand,
  type InvocationRecord,
  type WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo } from "../shared/api";
import type { InvocationObservationService } from "./invocation-observation-service";
import type { TerminalManager } from "./terminal-manager";

export interface SpawnAgentCommandInput {
  handle: string;
  task: string;
}

export interface LaunchNoteInvocationInput {
  handle: string;
  documentPath: string;
  mentionText: string;
  message: string;
  allowUntrustedOneShot?: boolean;
  persistTrust?: boolean;
}

export interface AgentCommandInvocationResult {
  ok: true;
  invocation: InvocationRecord;
  terminal: TerminalSessionInfo;
}

export class AgentCommandInvocationError extends Error {
  constructor(
    readonly code:
      | "agent-command-not-found"
      | "agent-command-disabled"
      | "agent-command-untrusted"
      | "agent-command-unsupported-prompt-delivery"
      | "agent-command-invalid-cwd-policy",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class AgentCommandInvocationService {
  constructor(
    private readonly options: {
      getWorkspaceSettings: () => WorkspaceSettings;
      trustStateRoot: string;
      terminalManager: TerminalManager;
      observationService?: InvocationObservationService;
    },
  ) {}

  async spawnFromCli(input: SpawnAgentCommandInput): Promise<AgentCommandInvocationResult> {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, input.handle);
    this.assertLaunchable(command);
    if (command.cwdPolicy === "note_dir") {
      throw new AgentCommandInvocationError(
        "agent-command-invalid-cwd-policy",
        "`note_dir` AgentCommand cwd policy cannot be used from CLI spawn.",
        { handle: command.handle, cwdPolicy: command.cwdPolicy },
      );
    }
    const cwd = resolveInvocationCwd(command, settings.workspaceRoot);
    await this.assertTrusted(settings.workspaceRoot, command);
    const prompt = formatCliInvocationPrompt({ task: input.task, workspaceRoot: settings.workspaceRoot });
    const terminal = await this.options.terminalManager.createAgentCommand(command, cwd);
    await this.options.terminalManager.sendMessage(terminal.id, prompt, true);
    const now = new Date().toISOString();
    const invocation: InvocationRecord = {
      id: randomUUID(),
      status: "running",
      context: "cli",
      mentionProvenance: "unknown",
      message: input.task,
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command),
      cwd,
      createdAt: now,
      startedAt: now,
      terminalSessionId: terminal.id,
      changedFileRefs: [],
      diffRefs: [],
      attribution: { status: "pending" },
    };
    await new InvocationStore(settings.workspaceRoot).writeRecord(invocation);
    return { ok: true, invocation, terminal };
  }

  async launchNoteInvocation(input: LaunchNoteInvocationInput): Promise<AgentCommandInvocationResult> {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, input.handle);
    this.assertLaunchable(command);
    const cwd = command.cwdPolicy === "note_dir"
      ? path.dirname(input.documentPath)
      : resolveInvocationCwd(command, settings.workspaceRoot);
    if (input.persistTrust) {
      await new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).trust(command);
    } else if (input.allowUntrustedOneShot) {
      // One-shot note invocation is intentionally not persisted. Persistent trust
      // is a separate explicit action because command config is executable code.
    } else {
      await this.assertTrusted(settings.workspaceRoot, command);
    }
    const before = await this.options.observationService?.snapshotTaggedDocument(input.documentPath);
    const prompt = formatNoteInvocationPrompt({ documentPath: input.documentPath, mentionText: input.mentionText });
    const terminal = await this.options.terminalManager.createAgentCommand(command, cwd);
    await this.options.terminalManager.sendMessage(terminal.id, prompt, true);
    const now = new Date().toISOString();
    const invocation: InvocationRecord = {
      id: randomUUID(),
      status: "running",
      context: "note",
      taggedDocumentPath: input.documentPath,
      originalMentionText: input.mentionText,
      mentionProvenance: "human-authored",
      message: input.message,
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command),
      cwd,
      createdAt: now,
      startedAt: now,
      terminalSessionId: terminal.id,
      changedFileRefs: [],
      diffRefs: [],
      attribution: { status: "pending" },
    };
    await new InvocationStore(settings.workspaceRoot).writeRecord(invocation);
    await this.options.observationService?.observe(invocation, before);
    return { ok: true, invocation, terminal };
  }

  private resolveCommand(settings: WorkspaceSettings, handleInput: string): AgentCommand {
    const handle = normalizeAgentHandle(handleInput);
    const command = settings.agentCommands?.find((entry) => entry.handle === handle);
    if (!handle || !command) {
      throw new AgentCommandInvocationError("agent-command-not-found", `No AgentCommand is configured for @${handleInput.replace(/^@/, "")}.`, {
        handle: handleInput,
      });
    }
    return command;
  }

  private assertLaunchable(command: AgentCommand): void {
    if (!command.enabled) {
      throw new AgentCommandInvocationError("agent-command-disabled", `AgentCommand @${command.handle} is disabled.`, {
        handle: command.handle,
      });
    }
    if (command.promptDelivery !== "terminalInputAfterLaunch") {
      throw new AgentCommandInvocationError(
        "agent-command-unsupported-prompt-delivery",
        `AgentCommand @${command.handle} uses unsupported V1 prompt delivery: ${command.promptDelivery}.`,
        { handle: command.handle, promptDelivery: command.promptDelivery },
      );
    }
  }

  private async assertTrusted(workspaceRoot: string, command: AgentCommand): Promise<void> {
    const trust = await new AgentCommandTrustStore(this.options.trustStateRoot, workspaceRoot).status(command);
    if (!trust.trusted) {
      throw new AgentCommandInvocationError(
        "agent-command-untrusted",
        `AgentCommand @${command.handle} must be trusted in Exo before it can launch.`,
        {
          handle: command.handle,
          executableFingerprint: trust.executableFingerprint,
        },
      );
    }
  }
}

function resolveInvocationCwd(command: AgentCommand, workspaceRoot: string): string {
  return command.cwdPolicy === "fixed" ? command.fixedCwd ?? workspaceRoot : workspaceRoot;
}
