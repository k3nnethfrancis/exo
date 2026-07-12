import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
  AgentCommandTrustStore,
  agentCommandSnapshot,
  createDefaultClaudeAgentCommand,
  deriveAgentCommandLaunch,
  formatCliInvocationPrompt,
  formatNoteInvocationPrompt,
  InvocationStore,
  normalizeAgentHandle,
  resolveInvocationStoreLayout,
  safeStoreSegment,
  type AgentCommand,
  type InvocationRecord,
  type WorkspaceSettings,
} from "@exo/core";

import type { TerminalSessionInfo } from "../shared/api";
import type { AgentCommandLaunchFacts } from "../shared/api";
import { inspectAgentCommandLaunchFacts } from "./agent-command-launch-facts";
import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceChangeEvent, WorkspaceWatcherService } from "./workspace-watchers";

export interface InvocationRequest {
  context: "cli" | "note";
  handle: string;
  task?: string;
  documentPath?: string;
  mentionText?: string;
  documentFrontmatter?: Record<string, unknown>;
  documentBody?: string;
  message: string;
  allowUntrustedOneShot?: boolean;
  persistTrust?: boolean;
}

export interface PreparedInvocation {
  id: string;
  request: InvocationRequest;
  command: AgentCommand;
  cwd: string;
  before?: FileSnapshot;
  pending: InvocationRecord;
}

export interface InvocationResult {
  ok: true;
  invocation: InvocationRecord;
  terminal: TerminalSessionInfo;
}

export class InvocationRunnerError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

interface ActiveObservation {
  record: InvocationRecord;
  before: FileSnapshot;
  observedPaths: Set<string>;
  overlapAtStart: boolean;
  finalizing: boolean;
}

interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  sha256: string | null;
}

const OBSERVATION_EXIT_GRACE_MS = 500;

/** The single lifecycle boundary for agent processes and their review records. */
export class InvocationRunner extends EventEmitter {
  private readonly active = new Map<string, ActiveObservation>();
  private readonly byTerminal = new Map<string, string>();

  constructor(private readonly options: {
    getWorkspaceSettings: () => WorkspaceSettings;
    trustStateRoot: string;
    terminalManager: TerminalManager;
    workspaceWatcherService: WorkspaceWatcherService;
  }) {
    super();
    options.workspaceWatcherService.subscribe((event) => this.onWorkspaceChange(event));
    options.terminalManager.on("exit", (event: { id: string; exitCode?: number }) => {
      const id = this.byTerminal.get(event.id);
      if (id) setTimeout(() => void this.settle(id, "process-exited", event.exitCode), OBSERVATION_EXIT_GRACE_MS).unref?.();
    });
  }

  async prepare(request: InvocationRequest): Promise<PreparedInvocation> {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, request.handle);
    const context = request.context === "note"
      ? { kind: "note" as const, workspaceRoot: settings.workspaceRoot, documentPath: request.documentPath }
      : { kind: "cli" as const, workspaceRoot: settings.workspaceRoot };
    const derived = deriveAgentCommandLaunch(command, context);
    if (!derived.launchable) {
      throw new InvocationRunnerError(derived.block, derived.detail, { handle: command.handle });
    }
    const facts = await inspectAgentCommandLaunchFacts(command, context);
    if (!facts.launchable) {
      throw new InvocationRunnerError(facts.block ?? "not-launchable", facts.detail, { handle: command.handle });
    }
    const cwd = derived.cwd;
    const now = new Date().toISOString();
    const id = randomUUID();
    const pending: InvocationRecord = {
      id, status: "pending", context: request.context,
      ...(request.context === "note" ? { taggedDocumentPath: request.documentPath, originalMentionText: request.mentionText, mentionProvenance: "human-authored" as const } : { mentionProvenance: "unknown" as const }),
      message: request.message,
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command), cwd, createdAt: now,
      changedFileRefs: [], diffRefs: [], attribution: { status: "pending" },
    };
    const before = request.context === "note" ? await snapshotTextFile(request.documentPath!) : undefined;
    return { id, request, command, cwd, before, pending };
  }

  async authorizeAndStart(prepared: PreparedInvocation): Promise<InvocationResult> {
    const settings = this.options.getWorkspaceSettings();
    const store = new InvocationStore(settings.workspaceRoot);
    if (prepared.request.persistTrust) {
      await new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).trust(prepared.command);
    } else if (!prepared.request.allowUntrustedOneShot) {
      const trust = await new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).status(prepared.command);
      if (!trust.trusted) throw new InvocationRunnerError("untrusted", `AgentCommand @${prepared.command.handle} must be trusted before launch.`, { handle: prepared.command.handle });
    }
    await store.writeRecord(prepared.pending);
    let terminal: TerminalSessionInfo | undefined;
    try {
      terminal = await this.options.terminalManager.createAgentCommand(prepared.command, prepared.cwd);
      const prompt = prepared.request.context === "note"
        ? formatNoteInvocationPrompt({
            documentPath: prepared.request.documentPath!,
            mentionText: prepared.request.mentionText ?? "",
            message: prepared.request.message,
            frontmatter: prepared.request.documentFrontmatter,
            body: prepared.request.documentBody,
          })
        : formatCliInvocationPrompt({ task: prepared.request.task ?? prepared.request.message, workspaceRoot: settings.workspaceRoot });
      const delivered = await this.options.terminalManager.sendMessage(terminal.id, prompt, true);
      if (!delivered.ok) throw new InvocationRunnerError("prompt-delivery-failed", "Agent prompt could not be delivered.");
      const startedAt = new Date().toISOString();
      const running = { ...prepared.pending, status: "running" as const, startedAt, terminalSessionId: terminal.id };
      await store.writeRecord(running);
      if (prepared.before) this.observe(running, prepared.before);
      return { ok: true, invocation: running, terminal };
    } catch (error) {
      if (terminal) await this.options.terminalManager.kill(terminal.id).catch(() => undefined);
      const failed: InvocationRecord = { ...prepared.pending, status: "failed", endedAt: new Date().toISOString(), failureReason: error instanceof Error ? error.message : String(error) };
      await store.writeRecord(failed).catch(() => undefined);
      throw error;
    }
  }

  async getCommandLaunchFacts(commandId: string): Promise<AgentCommandLaunchFacts> {
    const settings = this.options.getWorkspaceSettings();
    const command = settings.agentCommands?.find((entry) => entry.id === commandId);
    if (!command) {
      throw new InvocationRunnerError("not-found", `No saved Command has id ${commandId}.`, { commandId });
    }
    return inspectAgentCommandLaunchFacts(command, { kind: "cli", workspaceRoot: settings.workspaceRoot });
  }

  async testCommand(commandId: string, expectedFingerprint: string): Promise<InvocationResult> {
    const facts = await this.getCommandLaunchFacts(commandId);
    if (facts.fingerprint !== expectedFingerprint) {
      throw new InvocationRunnerError("fingerprint-drift", `Command @${facts.handle} changed after confirmation. Review it and try again.`);
    }
    const prepared = await this.prepare({
      context: "cli",
      handle: facts.handle,
      task: `Verify that @${facts.handle} can launch from Exo. Respond briefly, then remain available in this terminal.`,
      message: `Test @${facts.handle} in terminal`,
      allowUntrustedOneShot: true,
    });
    if (prepared.pending.command.executableFingerprint !== expectedFingerprint) {
      throw new InvocationRunnerError("fingerprint-drift", `Command @${facts.handle} changed after confirmation. Review it and try again.`);
    }
    return this.authorizeAndStart(prepared);
  }

  async getCommandTrust(handleInput: string) {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, handleInput);
    return new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).status(command);
  }

  async endObservation(id: string): Promise<InvocationRecord | null> { return this.settle(id, "user-ended"); }
  async get(id: string): Promise<InvocationRecord | null> { return new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot).readRecord(id); }
  async review(id: string): Promise<InvocationRecord | null> { return this.get(id); }

  async markOrphanedRunningInvocations(): Promise<void> {
    const store = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
    for (const record of await store.listRecords()) if (record.status === "pending" || record.status === "running") {
      await store.writeRecord({ ...record, status: "orphaned", endedAt: new Date().toISOString(), attribution: { status: "ambiguous", reason: "Attribution incomplete because Exo restarted during this invocation." } });
    }
  }

  private observe(record: InvocationRecord, before: FileSnapshot): void {
    if (!record.taggedDocumentPath) return;
    const overlapAtStart = [...this.active.values()].some((entry) => entry.record.taggedDocumentPath === record.taggedDocumentPath);
    this.active.set(record.id, { record, before, observedPaths: new Set(), overlapAtStart, finalizing: false });
    if (record.terminalSessionId) this.byTerminal.set(record.terminalSessionId, record.id);
  }

  private onWorkspaceChange(event: WorkspaceChangeEvent): void {
    if (event.filePath) for (const observation of this.active.values()) observation.observedPaths.add(path.resolve(event.filePath));
  }

  private async settle(id: string, status: "process-exited" | "user-ended", exitCode?: number): Promise<InvocationRecord | null> {
    const observation = this.active.get(id); if (!observation || observation.finalizing) return null;
    observation.finalizing = true;
    const after = await snapshotTextFile(observation.before.path);
    const store = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
    const changed = observation.before.sha256 !== after.sha256;
    const changedFileRefs = [...observation.record.changedFileRefs];
    const diffRefs = [...observation.record.diffRefs];
    if (changed) {
      const diffId = "diff-1";
      const diffRef = path.join(".exo", "invocations", safeStoreSegment(id), "diffs", `${diffId}.patch`);
      const diffPath = path.join(resolveInvocationStoreLayout(store.layout.workspaceRoot).invocationsDir, safeStoreSegment(id), "diffs", `${diffId}.patch`);
      await mkdir(path.dirname(diffPath), { recursive: true });
      await writeFile(diffPath, wholeFileDiff(observation.before, after), "utf8");
      diffRefs.push({ id: diffId, path: observation.before.path, format: "unified", ref: diffRef });
      changedFileRefs.push({ path: observation.before.path, kind: after.exists ? observation.before.exists ? "modified" : "created" : "deleted", observedAt: new Date().toISOString(), attribution: observation.overlapAtStart || !observation.observedPaths.has(path.resolve(observation.before.path)) ? "ambiguous" : "likely", diffRefId: diffId });
    }
    const next = { ...observation.record, status, endedAt: new Date().toISOString(), ...(exitCode === undefined ? {} : { exitCode }), changedFileRefs, diffRefs, attribution: changed ? { status: changedFileRefs.some((f) => f.attribution === "ambiguous") ? "ambiguous" as const : "likely" as const } : { status: "unattributed" as const, reason: "No tagged document changes observed." } };
    await store.writeRecord(next); this.active.delete(id); if (observation.record.terminalSessionId) this.byTerminal.delete(observation.record.terminalSessionId); this.emit("updated", next); return next;
  }

  private resolveCommand(settings: WorkspaceSettings, handleInput: string): AgentCommand {
    const handle = normalizeAgentHandle(handleInput);
    const command = settings.agentCommands?.find((entry) => entry.handle === handle)
      ?? (handle === "claude" ? createDefaultClaudeAgentCommand() : undefined);
    if (!handle || !command) throw new InvocationRunnerError("not-found", `No AgentCommand is configured for @${handleInput.replace(/^@/, "")}.`);
    return command;
  }
}

async function snapshotTextFile(filePath: string): Promise<FileSnapshot> { try { await stat(filePath); const content = await readFile(filePath, "utf8"); return { path: filePath, exists: true, content, sha256: createHash("sha256").update(content).digest("hex") }; } catch { return { path: filePath, exists: false, content: "", sha256: null }; } }
function wholeFileDiff(before: FileSnapshot, after: FileSnapshot): string { return [`--- a/${path.basename(before.path)}`, `+++ b/${path.basename(after.path)}`, `@@ -1 +1 @@`, ...before.content.split("\n").map((line) => `-${line}`), ...after.content.split("\n").map((line) => `+${line}`), ""].join("\n"); }
