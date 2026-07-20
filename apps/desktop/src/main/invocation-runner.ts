import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
  AgentCommandTrustStore,
  InvocationContinuityStore,
  agentCommandSnapshot,
  agentCommandExecutableFingerprint,
  createDefaultClaudeAgentCommand,
  deriveAgentCommandLaunch,
  formatCliInvocationPrompt,
  formatNoteInvocationPrompt,
  findDocumentAgentEnvelopes,
  InvocationStore,
  readWorkspaceDocument,
  WorkspaceFiles,
  normalizeAgentHandle,
  resolveInvocationStoreLayout,
  safeStoreSegment,
  type AgentCommand,
  type InvocationRecord,
  type InvocationContinuityLane,
  type InvocationConversationHead,
  type InvocationAuthorizationDecision,
  type WorkspaceSettings,
  isDocumentAgentProtocolId,
} from "@exo/core";
import { commandForClaudeResume as buildClaudeResumeCommand } from "@exo/core/provider-session";

import type { TerminalSessionInfo } from "../shared/api";
import type { AgentCommandContinuityStatus, AgentCommandLaunchFacts, AgentInvocationAuthorizationFacts } from "../shared/api";
import { inspectAgentCommandLaunchFacts } from "./agent-command-launch-facts";
import { DirectInvocationProcessFactory, type InvocationProcess, type InvocationProcessFactory } from "./invocation-process";
import {
  commandForHeadlessInvocation as buildHeadlessInvocationCommand,
  extractClaudeSessionId as extractStructuredClaudeSessionId,
  inspectInvocationAdapterResult,
  supportsAutomaticContinuity,
} from "./invocation-adapter";
import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceChangeEvent, WorkspaceWatcherService } from "./workspace-watchers";

export interface InvocationRequest {
  context: "cli" | "note";
  handle: string;
  task?: string;
  documentPath?: string;
  protocolInvocationId?: string;
  mentionText?: string;
  documentFrontmatter?: Record<string, unknown>;
  documentBody?: string;
  message: string;
}

export interface InvocationAuthorization {
  decision: InvocationAuthorizationDecision;
  expectedFingerprint: string;
}

export interface PreparedInvocation {
  id: string;
  request: InvocationRequest;
  command: AgentCommand;
  cwd: string;
  workspaceRoot: string;
  noteRoots: string[];
  promptTemplate?: string;
  continuityLane?: InvocationContinuityLane;
  before?: FileSnapshot;
  pending: InvocationRecord;
}

export interface InvocationResult {
  ok: true;
  invocation: InvocationRecord;
  terminal: TerminalSessionInfo;
}

export interface HeadlessInvocationResult {
  ok: true;
  invocation: InvocationRecord;
  terminal?: never;
}

export type InvocationStartResult = InvocationResult | HeadlessInvocationResult;

export interface InvocationReviewPayload {
  invocation: InvocationRecord;
  patch: string | null;
  before: string | null;
  after: string | null;
  canReject: boolean;
}

export class InvocationRunnerError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

interface ActiveObservation {
  record: InvocationRecord;
  before: FileSnapshot;
  workspaceRoot: string;
  continuityLockKey?: string;
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
  private readonly continuityLocks = new Map<string, { invocationId: string; workspaceRoot: string; commandId: string }>();
  private readonly invocationScopes = new Map<string, { workspaceRoot: string; noteRoots: string[] }>();

  constructor(private readonly options: {
    getWorkspaceSettings: () => WorkspaceSettings;
    trustStateRoot: string;
    terminalManager: TerminalManager;
    workspaceWatcherService: WorkspaceWatcherService;
    invocationProcessFactory?: InvocationProcessFactory;
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
    const command = { ...this.resolveCommand(settings, request.handle) };
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
      id, workspaceRoot: settings.workspaceRoot, status: "pending", context: request.context,
      ...(request.context === "note" ? { taggedDocumentPath: request.documentPath, originalMentionText: request.mentionText, mentionProvenance: "human-authored" as const } : { mentionProvenance: "unknown" as const }),
      ...(request.protocolInvocationId ? { protocolInvocationId: request.protocolInvocationId } : {}),
      message: request.message,
      continuity: { policy: command.continuityPolicy, outcome: "fresh" },
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command), cwd, createdAt: now,
      changedFileRefs: [], diffRefs: [], attribution: { status: "pending" },
    };
    let before = request.context === "note" ? await snapshotTextFile(request.documentPath!) : undefined;
    if (request.context === "note" && request.documentBody !== undefined) {
      const persisted = await readWorkspaceDocument(request.documentPath!);
      const verified = await snapshotTextFile(request.documentPath!);
      const frontmatterMatches = request.documentFrontmatter === undefined ||
        JSON.stringify(persisted.frontmatter) === JSON.stringify(request.documentFrontmatter);
      if (before?.sha256 !== verified.sha256 || persisted.body !== request.documentBody || !frontmatterMatches) {
        throw new InvocationRunnerError(
          "document-drift",
          "The editor and saved document changed before invocation. Save the current note and try again.",
        );
      }
      if (!request.protocolInvocationId || !isDocumentAgentProtocolId(request.protocolInvocationId)) {
        throw new InvocationRunnerError("protocol-invalid", "This invocation is missing its document protocol identity. Recompose the request and try again.");
      }
      const envelope = findDocumentAgentEnvelopes(persisted.body).find((candidate) =>
        candidate.kind === "invocation" &&
        candidate.id === request.protocolInvocationId &&
        candidate.agent === command.handle,
      );
      if (!envelope) {
        throw new InvocationRunnerError("protocol-invalid", "The saved document no longer contains this invocation envelope. Recompose the request and try again.");
      }
      before = verified;
    }
    const continuityLane = request.context === "note" && supportsAutomaticContinuity(command)
      ? {
          workspaceRoot: settings.workspaceRoot,
          commandId: command.id,
          commandFingerprint: agentCommandExecutableFingerprint(command),
          adapter: "claude-code" as const,
          cwd,
        }
      : undefined;
    this.invocationScopes.set(id, { workspaceRoot: settings.workspaceRoot, noteRoots: [...settings.noteRoots] });
    return {
      id,
      request,
      command,
      cwd,
      workspaceRoot: settings.workspaceRoot,
      noteRoots: [...settings.noteRoots],
      ...(settings.agentInvocationPrompt ? { promptTemplate: settings.agentInvocationPrompt } : {}),
      ...(continuityLane ? { continuityLane } : {}),
      before,
      pending,
    };
  }

  async authorizeAndStart(
    prepared: PreparedInvocation,
    authorization: InvocationAuthorization,
  ): Promise<InvocationStartResult> {
    const store = new InvocationStore(prepared.workspaceRoot);
    this.assertAuthorizationCurrent(prepared, authorization.expectedFingerprint);
    if (authorization.decision.kind === "always-allow") {
      await new AgentCommandTrustStore(this.options.trustStateRoot, prepared.workspaceRoot).trust(prepared.command);
    } else if (authorization.decision.kind === "trusted") {
      const trust = await new AgentCommandTrustStore(this.options.trustStateRoot, prepared.workspaceRoot).status(prepared.command);
      if (!trust.trusted) throw new InvocationRunnerError("untrusted", `AgentCommand @${prepared.command.handle} must be trusted before launch.`, { handle: prepared.command.handle });
    }
    const continuityLockKey = prepared.continuityLane
      ? new InvocationContinuityStore(prepared.workspaceRoot).headPath(prepared.continuityLane)
      : undefined;
    if (continuityLockKey && this.continuityLocks.has(continuityLockKey)) {
      throw new InvocationRunnerError(
        "continuity-busy",
        `${prepared.command.label} is already working in this context.`,
        { commandId: prepared.command.id },
      );
    }
    if (continuityLockKey) {
      this.continuityLocks.set(continuityLockKey, { invocationId: prepared.id, workspaceRoot: prepared.workspaceRoot, commandId: prepared.command.id });
    }
    let terminal: TerminalSessionInfo | undefined;
    let invocationProcess: InvocationProcess | undefined;
    let continuityHead: InvocationConversationHead | null = null;
    let observationReady = false;
    const queuedExitRef: { current: { event: Parameters<typeof inspectInvocationAdapterResult>[1]; attemptedHead: InvocationConversationHead | null; fallback: boolean } | null } = { current: null };
    const settleHeadlessProcess = (exitCode: number | null, failureReason: string | null) => {
      const status = exitCode !== 0 || failureReason ? "failed" : "process-exited";
      setTimeout(
        () => void this.settle(prepared.id, status, exitCode ?? undefined, failureReason ?? undefined),
        OBSERVATION_EXIT_GRACE_MS,
      ).unref?.();
    };
    try {
      continuityHead = prepared.continuityLane
        ? await new InvocationContinuityStore(prepared.workspaceRoot).readHead(prepared.continuityLane)
        : null;
      await store.writeRecord(prepared.pending);
      const prompt = prepared.request.context === "note"
        ? formatNoteInvocationPrompt({
            documentPath: prepared.request.documentPath!,
            mentionText: prepared.request.mentionText ?? "",
            message: prepared.request.message,
            protocolInvocationId: prepared.request.protocolInvocationId,
            agentHandle: prepared.command.handle,
            frontmatter: prepared.request.documentFrontmatter,
            body: prepared.request.documentBody,
            workspaceRoot: prepared.workspaceRoot,
            noteRoots: prepared.noteRoots,
            promptTemplate: prepared.promptTemplate,
          })
        : formatCliInvocationPrompt({ task: prepared.request.task ?? prepared.request.message, workspaceRoot: prepared.workspaceRoot });
      const handleHeadlessExit = async (
        event: Parameters<typeof inspectInvocationAdapterResult>[1],
        attemptedHead: InvocationConversationHead | null,
        fallback: boolean,
      ): Promise<void> => {
        const result = inspectInvocationAdapterResult(prepared.command, event, attemptedHead);
        const observation = this.active.get(prepared.id);
        if (result.staleResumeRejected && attemptedHead && !fallback && prepared.continuityLane && observation) {
          const current = await snapshotTextFile(observation.before.path);
          if (current.sha256 === observation.before.sha256 && observation.observedPaths.size === 0) {
            await new InvocationContinuityStore(prepared.workspaceRoot).clearHead(prepared.continuityLane);
            try {
              await launchHeadless(null, true);
              return;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              settleHeadlessProcess(null, reason);
              return;
            }
          }
        }
        if (observation) {
          const outcome = fallback
            ? "resume-failed-fresh"
            : attemptedHead
              ? result.failureReason ? "resume-failed" : "resumed"
              : "fresh";
          observation.record = {
            ...observation.record,
            ...(result.providerSessionId ? { providerSessionId: result.providerSessionId } : {}),
            continuity: {
              policy: prepared.command.continuityPolicy,
              outcome,
              ...((attemptedHead || fallback && continuityHead)
                ? { resumedFromInvocationId: (attemptedHead ?? continuityHead)!.sourceInvocationId }
                : {}),
            },
          };
          if (!result.failureReason && result.providerSessionId && prepared.continuityLane) {
            await new InvocationContinuityStore(prepared.workspaceRoot).writeHead(prepared.continuityLane, {
              providerSessionId: result.providerSessionId,
              sourceInvocationId: prepared.id,
            });
          }
        }
        settleHeadlessProcess(event.exitCode, result.failureReason);
      };
      const launchHeadless = async (head: InvocationConversationHead | null, fallback: boolean): Promise<void> => {
        invocationProcess = (this.options.invocationProcessFactory ?? new DirectInvocationProcessFactory()).launch({
          command: buildHeadlessInvocationCommand(prepared.command, head),
          cwd: prepared.cwd,
          env: globalThis.process.env,
        });
        invocationProcess.onExit((event) => {
          if (!observationReady) {
            queuedExitRef.current = { event, attemptedHead: head, fallback };
            return;
          }
          void handleHeadlessExit(event, head, fallback).catch((error) => {
            settleHeadlessProcess(event.exitCode, error instanceof Error ? error.message : String(error));
          });
        });
        await invocationProcess.send(prompt);
      };
      if (prepared.request.context === "note") {
        await launchHeadless(continuityHead, false);
      } else {
        terminal = await this.options.terminalManager.createAgentCommand(prepared.command, prepared.cwd);
        const delivered = await this.options.terminalManager.sendMessage(terminal.id, prompt, true);
        if (!delivered.ok) throw new InvocationRunnerError("prompt-delivery-failed", "Agent prompt could not be delivered.");
      }
      const startedAt = new Date().toISOString();
      const running = {
        ...prepared.pending,
        status: "running" as const,
        startedAt,
        ...(terminal ? { terminalSessionId: terminal.id } : {}),
      };
      await store.writeRecord(running);
      if (prepared.before) this.observe(running, prepared.before, prepared.workspaceRoot, continuityLockKey);
      if (invocationProcess && prepared.before) {
        observationReady = true;
        const exit = queuedExitRef.current;
        if (exit) {
          queuedExitRef.current = null;
          void handleHeadlessExit(exit.event, exit.attemptedHead, exit.fallback).catch((error) => {
            settleHeadlessProcess(exit.event.exitCode, error instanceof Error ? error.message : String(error));
          });
        }
      }
      return { ok: true, invocation: running, ...(terminal ? { terminal } : {}) };
    } catch (error) {
      if (terminal) await this.options.terminalManager.kill(terminal.id).catch(() => undefined);
      invocationProcess?.kill();
      if (continuityLockKey) this.continuityLocks.delete(continuityLockKey);
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

  async getInvocationAuthorization(handleInput: string, documentPath: string): Promise<AgentInvocationAuthorizationFacts> {
    const settings = this.options.getWorkspaceSettings();
    const command = { ...this.resolveCommand(settings, handleInput) };
    const facts = await inspectAgentCommandLaunchFacts(command, {
      kind: "note",
      workspaceRoot: settings.workspaceRoot,
      documentPath,
    });
    const trust = await new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).status(command);
    return { ...facts, command, trusted: trust.trusted };
  }

  async getCommandContinuityStatus(commandId: string): Promise<AgentCommandContinuityStatus> {
    const settings = this.options.getWorkspaceSettings();
    const command = settings.agentCommands?.find((entry) => entry.id === commandId);
    if (!command) throw new InvocationRunnerError("not-found", `No saved Command has id ${commandId}.`, { commandId });
    const supported = command.adapter === "claude-code";
    const store = new InvocationContinuityStore(settings.workspaceRoot);
    return {
      commandId,
      supported,
      policy: supported ? command.continuityPolicy : "fresh",
      hasHead: supported ? await store.hasCommandHead(commandId) : false,
      active: [...this.continuityLocks.values()].some((lock) => lock.workspaceRoot === settings.workspaceRoot && lock.commandId === commandId),
    };
  }

  async resetCommandContinuity(commandId: string): Promise<{ cleared: number }> {
    const settings = this.options.getWorkspaceSettings();
    const status = await this.getCommandContinuityStatus(commandId);
    if (!status.supported) throw new InvocationRunnerError("continuity-unavailable", "Context is unavailable for this Command.", { commandId });
    if (status.active) throw new InvocationRunnerError("continuity-busy", "This Command is still working.", { commandId });
    return { cleared: await new InvocationContinuityStore(settings.workspaceRoot).clearCommandHeads(commandId) };
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
    });
    if (prepared.pending.command.executableFingerprint !== expectedFingerprint) {
      throw new InvocationRunnerError("fingerprint-drift", `Command @${facts.handle} changed after confirmation. Review it and try again.`);
    }
    const result = await this.authorizeAndStart(prepared, {
      decision: { kind: "run-once" },
      expectedFingerprint,
    });
    if (!result.terminal) {
      throw new InvocationRunnerError("not-launchable", `Command @${facts.handle} did not open its visible test terminal.`);
    }
    return result;
  }

  async getCommandTrust(handleInput: string) {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, handleInput);
    return new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).status(command);
  }

  async resetCommandTrust(handleInput: string): Promise<{ revoked: boolean }> {
    const settings = this.options.getWorkspaceSettings();
    const command = this.resolveCommand(settings, handleInput);
    const revoked = await new AgentCommandTrustStore(this.options.trustStateRoot, settings.workspaceRoot).revoke(command);
    return { revoked };
  }

  async endObservation(id: string): Promise<InvocationRecord | null> { return this.settle(id, "user-ended"); }
  async get(id: string): Promise<InvocationRecord | null> {
    return new InvocationStore(this.scopeForInvocation(id).workspaceRoot).readRecord(id);
  }
  async review(id: string): Promise<InvocationRecord | null> { return this.get(id); }

  async getReview(id: string): Promise<InvocationReviewPayload | null> {
    const scope = this.scopeForInvocation(id);
    const store = new InvocationStore(scope.workspaceRoot);
    const invocation = await store.readRecord(id);
    if (!invocation?.taggedDocumentPath || invocation.diffRefs.length === 0) return null;
    const layout = resolveInvocationStoreLayout(store.layout.workspaceRoot);
    const base = path.join(layout.invocationsDir, safeStoreSegment(id));
    const [patch, before, after] = await Promise.all([
      readTextOrNull(path.join(base, "diffs", "diff-1.patch")),
      readTextOrNull(path.join(base, "before.md")),
      readTextOrNull(path.join(base, "after.md")),
    ]);
    return {
      invocation,
      patch,
      before,
      after,
      canReject: invocation.review?.status === "pending" && before !== null && after !== null,
    };
  }

  async keepReview(id: string): Promise<InvocationRecord | null> {
    const store = new InvocationStore(this.scopeForInvocation(id).workspaceRoot);
    const record = await store.readRecord(id);
    if (!record?.review || record.review.status !== "pending") return record;
    const next = { ...record, review: { ...record.review, status: "kept" as const, reviewedAt: new Date().toISOString() } };
    await store.writeRecord(next);
    this.emit("updated", next);
    return next;
  }

  async rejectReview(id: string, expectedAfterSha256: string | null): Promise<InvocationRecord> {
    const scope = this.scopeForInvocation(id);
    const store = new InvocationStore(scope.workspaceRoot);
    const record = await store.readRecord(id);
    if (!record?.taggedDocumentPath || !record.review || record.review.status !== "pending") {
      throw new InvocationRunnerError("review-unavailable", "This invocation has no pending document review.");
    }
    if (record.review.afterSha256 !== expectedAfterSha256) {
      throw new InvocationRunnerError("review-drift", "The proposed document version no longer matches this review.");
    }
    const filePath = await new WorkspaceFiles(scope.noteRoots).writable(record.taggedDocumentPath);
    const current = await snapshotTextFile(filePath);
    if (current.sha256 !== record.review.afterSha256) {
      throw new InvocationRunnerError("review-drift", "The document changed after the invocation. Exo will not overwrite newer work.");
    }
    const beforePath = path.join(resolveInvocationStoreLayout(scope.workspaceRoot).invocationsDir, safeStoreSegment(id), "before.md");
    const before = await readTextOrNull(beforePath);
    if (before === null) throw new InvocationRunnerError("review-unavailable", "The original document snapshot is unavailable.");
    await writeFile(filePath, before, "utf8");
    const next = { ...record, review: { ...record.review, status: "rejected" as const, reviewedAt: new Date().toISOString() } };
    await store.writeRecord(next);
    this.emit("updated", next);
    return next;
  }

  async resumeInTerminal(id: string): Promise<TerminalSessionInfo> {
    const record = await this.get(id);
    if (!record?.providerSessionId || record.command.adapter !== "claude-code") {
      throw new InvocationRunnerError("resume-unavailable", "This invocation does not have resumable Claude session provenance.");
    }
    return this.options.terminalManager.createAgentCommand(
      { ...record.command, command: commandForClaudeResume(record.command, record.providerSessionId) },
      record.cwd,
    );
  }

  async markOrphanedRunningInvocations(): Promise<void> {
    const settings = this.options.getWorkspaceSettings();
    const store = new InvocationStore(settings.workspaceRoot);
    for (const record of await store.listRecords()) {
      this.invocationScopes.set(record.id, { workspaceRoot: settings.workspaceRoot, noteRoots: [...settings.noteRoots] });
      if (record.status !== "pending" && record.status !== "running") continue;
      await store.writeRecord({ ...record, status: "orphaned", endedAt: new Date().toISOString(), attribution: { status: "ambiguous", reason: "Attribution incomplete because Exo restarted during this invocation." } });
    }
  }

  private scopeForInvocation(id: string): { workspaceRoot: string; noteRoots: string[] } {
    return this.invocationScopes.get(id) ?? (() => {
      const settings = this.options.getWorkspaceSettings();
      return { workspaceRoot: settings.workspaceRoot, noteRoots: [...settings.noteRoots] };
    })();
  }

  private observe(
    record: InvocationRecord,
    before: FileSnapshot,
    workspaceRoot: string,
    continuityLockKey?: string,
  ): void {
    if (!record.taggedDocumentPath) return;
    const overlapAtStart = [...this.active.values()].some((entry) => entry.record.taggedDocumentPath === record.taggedDocumentPath);
    this.active.set(record.id, {
      record,
      before,
      workspaceRoot,
      ...(continuityLockKey ? { continuityLockKey } : {}),
      observedPaths: new Set(),
      overlapAtStart,
      finalizing: false,
    });
    if (record.terminalSessionId) this.byTerminal.set(record.terminalSessionId, record.id);
  }

  private onWorkspaceChange(event: WorkspaceChangeEvent): void {
    if (event.filePath) for (const observation of this.active.values()) observation.observedPaths.add(path.resolve(event.filePath));
  }

  private async settle(id: string, status: "process-exited" | "user-ended" | "failed", exitCode?: number, failureReason?: string): Promise<InvocationRecord | null> {
    const observation = this.active.get(id); if (!observation || observation.finalizing) return null;
    observation.finalizing = true;
    try {
      const after = await snapshotTextFile(observation.before.path);
      const store = new InvocationStore(observation.workspaceRoot);
      const changed = observation.before.sha256 !== after.sha256;
      const missingDurableResponse = status === "process-exited" && !changed &&
        isDocumentAgentProtocolId(observation.record.protocolInvocationId) &&
        !findDocumentAgentEnvelopes(after.content).some((envelope) =>
          envelope.kind === "response" &&
          envelope.invocationId === observation.record.protocolInvocationId &&
          envelope.agent === observation.record.command.handle,
        );
      const settledStatus = missingDurableResponse ? "failed" : status;
      const settledFailureReason = missingDurableResponse
        ? `@${observation.record.command.handle} finished without writing its linked response into the note.`
        : failureReason;
      const changedFileRefs = [...observation.record.changedFileRefs];
      const diffRefs = [...observation.record.diffRefs];
      if (changed) {
        const diffId = "diff-1";
        const diffRef = path.join(".exo", "invocations", safeStoreSegment(id), "diffs", `${diffId}.patch`);
        const diffPath = path.join(resolveInvocationStoreLayout(store.layout.workspaceRoot).invocationsDir, safeStoreSegment(id), "diffs", `${diffId}.patch`);
        await mkdir(path.dirname(diffPath), { recursive: true });
        await writeFile(diffPath, wholeFileDiff(observation.before, after), "utf8");
        const artifactRoot = path.dirname(path.dirname(diffPath));
        await Promise.all([
          writeFile(path.join(artifactRoot, "before.md"), observation.before.content, "utf8"),
          writeFile(path.join(artifactRoot, "after.md"), after.content, "utf8"),
        ]);
        diffRefs.push({ id: diffId, path: observation.before.path, format: "unified", ref: diffRef });
        changedFileRefs.push({ path: observation.before.path, kind: after.exists ? observation.before.exists ? "modified" : "created" : "deleted", observedAt: new Date().toISOString(), attribution: observation.overlapAtStart || !observation.observedPaths.has(path.resolve(observation.before.path)) ? "ambiguous" : "likely", diffRefId: diffId });
      }
      const next = { ...observation.record, status: settledStatus, endedAt: new Date().toISOString(), ...(exitCode === undefined ? {} : { exitCode }), ...(settledStatus === "failed" ? { failureReason: settledFailureReason ?? `Command exited with code ${exitCode ?? "unknown"}.` } : {}), changedFileRefs, diffRefs, ...(changed ? { review: { status: "pending" as const, beforeSha256: observation.before.sha256, afterSha256: after.sha256 } } : {}), attribution: changed ? { status: changedFileRefs.some((f) => f.attribution === "ambiguous") ? "ambiguous" as const : "likely" as const } : { status: "unattributed" as const, reason: settledStatus === "failed" ? settledFailureReason ?? "The Command failed before changing the tagged document." : "No tagged document changes observed." } };
      await store.writeRecord(next);
      this.emit("updated", next);
      return next;
    } finally {
      this.active.delete(id);
      if (observation.record.terminalSessionId) this.byTerminal.delete(observation.record.terminalSessionId);
      if (observation.continuityLockKey) this.continuityLocks.delete(observation.continuityLockKey);
    }
  }

  private resolveCommand(settings: WorkspaceSettings, handleInput: string): AgentCommand {
    const handle = normalizeAgentHandle(handleInput);
    const command = settings.agentCommands?.find((entry) => entry.handle === handle)
      ?? (handle === "claude" ? createDefaultClaudeAgentCommand() : undefined);
    if (!handle || !command) throw new InvocationRunnerError("not-found", `No AgentCommand is configured for @${handleInput.replace(/^@/, "")}.`);
    return command;
  }

  private assertAuthorizationCurrent(prepared: PreparedInvocation, expectedFingerprint: string): void {
    const preparedFingerprint = agentCommandExecutableFingerprint(prepared.command);
    if (expectedFingerprint !== preparedFingerprint) {
      throw new InvocationRunnerError(
        "fingerprint-drift",
        `Command @${prepared.command.handle} changed after confirmation. Review it and try again.`,
      );
    }
    const settings = this.options.getWorkspaceSettings();
    if (settings.workspaceRoot !== prepared.workspaceRoot) {
      throw new InvocationRunnerError(
        "fingerprint-drift",
        "The active Workspace changed after confirmation. Review the invocation and try again.",
      );
    }
    const current = this.resolveCommand(settings, prepared.command.handle);
    if (agentCommandExecutableFingerprint(current) !== expectedFingerprint) {
      throw new InvocationRunnerError(
        "fingerprint-drift",
        `Command @${prepared.command.handle} changed after confirmation. Review it and try again.`,
      );
    }
  }
}

async function snapshotTextFile(filePath: string): Promise<FileSnapshot> {
  try {
    await stat(filePath);
    const content = await readFile(filePath, "utf8");
    return { path: filePath, exists: true, content, sha256: createHash("sha256").update(content).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: filePath, exists: false, content: "", sha256: null };
    }
    throw error;
  }
}
function wholeFileDiff(before: FileSnapshot, after: FileSnapshot): string { return [`--- a/${path.basename(before.path)}`, `+++ b/${path.basename(after.path)}`, `@@ -1 +1 @@`, ...before.content.split("\n").map((line) => `-${line}`), ...after.content.split("\n").map((line) => `+${line}`), ""].join("\n"); }

async function readTextOrNull(filePath: string): Promise<string | null> {
  try { return await readFile(filePath, "utf8"); } catch { return null; }
}

/** Claude's documented print JSON exposes its real session_id. Generic Commands
 * retain their configured command and simply have no resumable provenance. */
export function commandForHeadlessInvocation(command: AgentCommand, head: InvocationConversationHead | null = null): string {
  return buildHeadlessInvocationCommand(command, head);
}

export function extractClaudeSessionId(stdout: string): string | null {
  return extractStructuredClaudeSessionId(stdout);
}

/** Reuse the configured Claude executable for the visible provider-native
 * handoff, removing only print-mode switches that conflict with --resume. */
export function commandForClaudeResume(command: AgentCommand, sessionId: string): string {
  return buildClaudeResumeCommand(command, sessionId);
}
