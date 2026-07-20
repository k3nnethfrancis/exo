import { randomUUID, createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

import {
  AgentCommandTrustStore,
  InvocationContinuityStore,
  buildInvocationChangeset,
  agentCommandSnapshot,
  agentCommandExecutableFingerprint,
  createDefaultClaudeAgentCommand,
  deriveAgentCommandLaunch,
  formatCliInvocationPrompt,
  formatNoteInvocationPrompt,
  findDocumentAgentEnvelopes,
  InvocationStore,
  readWorkspaceDocument,
  removeDocumentAgentInvocation,
  normalizeAgentHandle,
  type AgentCommand,
  type InvocationRecord,
  type InvocationContinuityLane,
  type InvocationConversationHead,
  type InvocationAuthorizationDecision,
  type WorkspaceSettings,
  isDocumentAgentProtocolId,
  type InvocationActivityEvent,
  type InvocationActivityKind,
  type InvocationFileChange,
  type InvocationWorkspaceManifest,
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
import { InvocationActivityAdapter, type ParsedInvocationActivity } from "./invocation-activity-adapter";
import {
  InvocationReviewError,
  InvocationReviewService,
  withCompatibilityReview,
  type InvocationFileReviewPayload,
} from "./invocation-review";

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
  cleanBaseContent?: string;
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

export interface InvocationReviewListItem {
  invocationId: string;
  createdAt: string;
  endedAt?: string;
  command: Pick<InvocationRecord["command"], "handle" | "label">;
  changedFileCount: number;
  pendingFileCount: number;
  status: InvocationRecord["status"];
}

export interface InvocationHistoryItem {
  invocationId: string;
  createdAt: string;
  endedAt?: string;
  command: Pick<InvocationRecord["command"], "handle" | "label">;
  outcome: "kept" | "rejected" | "pending" | "failed";
  changedFileCount: number;
  providerSessionId?: string;
}

export class InvocationRunnerError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

class InvocationProcessStopError extends Error {
  constructor(message: string, readonly cause: unknown) { super(message); }
}

interface ActiveObservation {
  record: InvocationRecord;
  before: FileSnapshot;
  workspaceRoot: string;
  noteRoots: string[];
  continuityLockKey?: string;
  observedPaths: Set<string>;
  process?: InvocationProcess;
  requestedStatus?: "user-ended" | "failed";
  lastWorkspaceChangeAtMs: number;
  settlementPromise?: Promise<InvocationRecord | null>;
}

interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  sha256: string | null;
}

const DEFAULT_SETTLEMENT_QUIET_MS = 240;
const DEFAULT_SETTLEMENT_MAX_WAIT_MS = 2_000;

/** The single lifecycle boundary for agent processes and their review records. */
export class InvocationRunner extends EventEmitter {
  private readonly active = new Map<string, ActiveObservation>();
  private readonly byTerminal = new Map<string, string>();
  private readonly continuityLocks = new Map<string, { invocationId: string; workspaceRoot: string; commandId: string }>();
  private readonly changesetLocks = new Map<string, { invocationId: string; noteRoots: string[] }>();
  private readonly invocationScopes = new Map<string, { workspaceRoot: string; noteRoots: string[] }>();
  private readonly activityState = new Map<string, {
    lastKey: string;
    emittedAtMs: number;
    pending?: ParsedInvocationActivity;
    timer?: NodeJS.Timeout;
  }>();

  constructor(private readonly options: {
    getWorkspaceSettings: () => WorkspaceSettings;
    trustStateRoot: string;
    terminalManager: TerminalManager;
    workspaceWatcherService: WorkspaceWatcherService;
    invocationProcessFactory?: InvocationProcessFactory;
    settlementQuietMs?: number;
    settlementMaxWaitMs?: number;
  }) {
    super();
    options.workspaceWatcherService.subscribe((event) => this.onWorkspaceChange(event));
    options.terminalManager.on("exit", (event: { id: string; exitCode?: number }) => {
      const id = this.byTerminal.get(event.id);
      if (id) this.settleFromEvent(id, "process-exited", event.exitCode);
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
      id, workspaceRoot: settings.workspaceRoot, noteRoots: [...settings.noteRoots], status: "pending", context: request.context,
      ...(request.context === "note" ? { taggedDocumentPath: request.documentPath, originalMentionText: request.mentionText, mentionProvenance: "human-authored" as const } : { mentionProvenance: "unknown" as const }),
      ...(request.protocolInvocationId ? { protocolInvocationId: request.protocolInvocationId } : {}),
      message: request.message,
      continuity: { policy: command.continuityPolicy, outcome: "fresh" },
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command), cwd, createdAt: now,
      changedFileRefs: [], diffRefs: [], attribution: { status: "pending" },
    };
    let before = request.context === "note" ? await snapshotTextFile(request.documentPath!) : undefined;
    let cleanBaseContent: string | undefined;
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
      const cleanBody = removeDocumentAgentInvocation(persisted.body, request.protocolInvocationId, command.handle);
      const bodyOffset = before.content.length - persisted.body.length;
      if (cleanBody === null || bodyOffset < 0 || before.content.slice(bodyOffset) !== persisted.body) {
        throw new InvocationRunnerError("protocol-invalid", "Exo could not derive the exact saved document before this invocation.");
      }
      cleanBaseContent = `${before.content.slice(0, bodyOffset)}${cleanBody}`;
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
      ...(cleanBaseContent === undefined ? {} : { cleanBaseContent }),
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
    let startCommitted = false;
    const queuedExitRef: { current: { event: Parameters<typeof inspectInvocationAdapterResult>[1]; attemptedHead: InvocationConversationHead | null; fallback: boolean } | null } = { current: null };
    const settleHeadlessProcess = (exitCode: number | null, failureReason: string | null) => {
      const status = exitCode !== 0 || failureReason ? "failed" : "process-exited";
      const requested = this.active.get(prepared.id)?.requestedStatus;
      this.settleFromEvent(prepared.id, requested ?? status, exitCode ?? undefined, failureReason ?? undefined);
    };
    const handleHeadlessControlError = async (error: unknown, exitCode: number | null): Promise<void> => {
      if (!(error instanceof InvocationProcessStopError)) {
        settleHeadlessProcess(exitCode, error instanceof Error ? error.message : String(error));
        return;
      }
      const observation = this.active.get(prepared.id);
      if (observation) {
        const recoverable: InvocationRecord = {
          ...observation.record,
          status: "orphaned",
          endedAt: new Date().toISOString(),
          failureReason: error.message,
          attribution: { status: "ambiguous", reason: "The invocation process may still be writing to this Note Root." },
        };
        await store.writeRecord(recoverable);
        observation.record = recoverable;
        this.emit("updated", recoverable);
      }
      this.emit("settlement-error", { invocationId: prepared.id, error });
    };
    try {
      if (prepared.before) {
        await this.acquireChangesetLock(prepared, store);
        if (prepared.cleanBaseContent === undefined) {
          throw new InvocationRunnerError("protocol-invalid", "The exact clean invocation base is unavailable.");
        }
        await store.captureLaunchArtifacts(prepared.id, {
          noteRoots: prepared.noteRoots,
          cleanBase: { path: prepared.before.path, content: prepared.cleanBaseContent },
        });
      }
      continuityHead = prepared.continuityLane
        ? await new InvocationContinuityStore(prepared.workspaceRoot).readHead(prepared.continuityLane)
        : null;
      await store.writeRecord(prepared.pending);
      if (prepared.before) {
        this.observe(prepared.pending, prepared.before, prepared.workspaceRoot, prepared.noteRoots, continuityLockKey);
      }
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
        if (result.staleResumeRejected && attemptedHead && !fallback && prepared.continuityLane && observation && !observation.requestedStatus) {
          const current = await snapshotTextFile(observation.before.path);
          if (current.sha256 === observation.before.sha256 && observation.observedPaths.size === 0) {
            await new InvocationContinuityStore(prepared.workspaceRoot).clearHead(prepared.continuityLane);
            if (observation.requestedStatus) {
              settleHeadlessProcess(event.exitCode, result.failureReason);
              return;
            }
            try {
              await launchHeadless(null, true);
              return;
            } catch (error) {
              if (error instanceof InvocationProcessStopError) throw error;
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
        const activityAdapter = new InvocationActivityAdapter(prepared.command.adapter);
        invocationProcess = (this.options.invocationProcessFactory ?? new DirectInvocationProcessFactory()).launch({
          command: buildHeadlessInvocationCommand(prepared.command, head),
          cwd: prepared.cwd,
          env: globalThis.process.env,
        });
        const observation = this.active.get(prepared.id);
        if (observation) observation.process = invocationProcess;
        this.emitActivity(prepared.id, { kind: "working" });
        invocationProcess.onOutput?.((output) => {
          for (const activity of activityAdapter.push(output.channel, output.chunk)) {
            this.emitActivity(prepared.id, activity);
          }
        });
        invocationProcess.onExit((event) => {
          for (const activity of activityAdapter.finish()) this.emitActivity(prepared.id, activity, true);
          this.emitActivity(prepared.id, { kind: "finishing" }, true);
          if (!startCommitted) {
            queuedExitRef.current = { event, attemptedHead: head, fallback };
            return;
          }
          void handleHeadlessExit(event, head, fallback).catch((error) => {
            void handleHeadlessControlError(error, event.exitCode).catch((controlError) => {
              this.emit("settlement-error", { invocationId: prepared.id, error: controlError });
            });
          });
        });
        try {
          await invocationProcess.send(prompt);
        } catch (error) {
          try {
            await invocationProcess.stop();
          } catch (stopError) {
            throw new InvocationProcessStopError(
              "Invocation prompt delivery failed and its process could not be stopped safely.",
              new AggregateError([error, stopError]),
            );
          }
          throw error;
        }
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
      const observation = this.active.get(prepared.id);
      if (observation) {
        observation.record = running;
        if (terminal) this.byTerminal.set(terminal.id, prepared.id);
      }
      if (invocationProcess && prepared.before) {
        startCommitted = true;
        const exit = queuedExitRef.current;
        if (exit) {
          queuedExitRef.current = null;
          void handleHeadlessExit(exit.event, exit.attemptedHead, exit.fallback).catch((error) => {
            void handleHeadlessControlError(error, exit.event.exitCode).catch((controlError) => {
              this.emit("settlement-error", { invocationId: prepared.id, error: controlError });
            });
          });
        }
      }
      return { ok: true, invocation: running, ...(terminal ? { terminal } : {}) };
    } catch (error) {
      if (terminal) await this.options.terminalManager.kill(terminal.id).catch(() => undefined);
      const observation = this.active.get(prepared.id);
      if (observation) observation.requestedStatus = "failed";
      if (invocationProcess) {
        try {
          await invocationProcess.stop();
        } catch (stopError) {
          const recoverable: InvocationRecord = {
            ...(observation?.record ?? prepared.pending),
            status: "orphaned",
            endedAt: new Date().toISOString(),
            failureReason: "Invocation launch failed and its process could not be stopped safely.",
            attribution: { status: "ambiguous", reason: "The invocation process may still be writing to this Note Root." },
          };
          await store.writeRecord(recoverable);
          if (observation) observation.record = recoverable;
          throw new AggregateError([error, stopError], "Invocation launch failed and its process could not be stopped safely.");
        }
      }
      this.clearActivity(prepared.id);
      const failureReason = error instanceof Error ? error.message : String(error);
      if (observation) {
        try {
          await this.settle(prepared.id, "failed", undefined, failureReason);
        } catch (settlementError) {
          throw new AggregateError([error, settlementError], "Invocation launch and settlement both failed.");
        }
      } else {
        if (continuityLockKey) this.continuityLocks.delete(continuityLockKey);
        this.releaseChangesetLock(prepared.id);
        const failed: InvocationRecord = { ...prepared.pending, status: "failed", endedAt: new Date().toISOString(), failureReason };
        await store.writeRecord(failed).catch(() => undefined);
      }
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

  async endObservation(id: string): Promise<InvocationRecord | null> {
    const observation = this.active.get(id);
    if (!observation) return null;
    observation.requestedStatus = "user-ended";
    await observation.process?.stop();
    return this.settle(id, "user-ended");
  }

  async stopAll(): Promise<void> {
    const observations = [...this.active.values()];
    for (const observation of observations) observation.requestedStatus = "user-ended";
    const failures: unknown[] = [];
    const stopped: ActiveObservation[] = [];
    await Promise.all(observations.map(async (observation) => {
      try {
        await observation.process?.stop();
        stopped.push(observation);
      } catch (error) {
        failures.push(error);
      }
    }));
    await Promise.all(stopped.map((observation) => this.settle(observation.record.id, "user-ended")));
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to stop ${failures.length} invocation process${failures.length === 1 ? "" : "es"}.`);
    }
  }

  async get(id: string): Promise<InvocationRecord | null> {
    return new InvocationStore(this.scopeForInvocation(id).workspaceRoot).readRecord(id);
  }
  async review(id: string): Promise<InvocationRecord | null> { return this.get(id); }

  async getInvocationFileReview(id: string, changeId: string): Promise<InvocationFileReviewPayload> {
    const scope = this.scopeForInvocation(id);
    const record = await requiredInvocation(new InvocationStore(scope.workspaceRoot), id);
    return this.reviewService(scope.workspaceRoot).getFilePayload(record, changeId);
  }

  async reviewInvocationFile(id: string, changeId: string, action: "keep" | "reject"): Promise<InvocationRecord> {
    return this.resolveReview(id, [{ changeId, action }]);
  }

  async reviewInvocationAll(id: string, action: "keep" | "reject"): Promise<InvocationRecord> {
    const scope = this.scopeForInvocation(id);
    const record = await requiredInvocation(new InvocationStore(scope.workspaceRoot), id);
    const resolutions = record.changeset?.files
      .filter((change) => change.decision.status === "pending" || action === "keep" && change.decision.status === "conflict")
      .map((change) => ({ changeId: change.id, action })) ?? [];
    return this.resolveReview(id, resolutions);
  }

  async listPendingReviews(): Promise<InvocationReviewListItem[]> {
    const settings = this.options.getWorkspaceSettings();
    return (await new InvocationStore(settings.workspaceRoot).listRecords())
      .filter((record) => record.changeset?.files.some((change) => isUnresolvedReviewDecision(change.decision.status)))
      .sort(newestRecordFirst)
      .map(reviewListItem);
  }

  async listHistoryForNote(notePath: string): Promise<InvocationHistoryItem[]> {
    const settings = this.options.getWorkspaceSettings();
    const exactPath = await canonicalPathOrResolved(notePath);
    const records = await new InvocationStore(settings.workspaceRoot).listRecords();
    const taggedPaths = await Promise.all(records.map((record) => record.taggedDocumentPath
      ? canonicalPathOrResolved(record.taggedDocumentPath)
      : null));
    return records
      .filter((record, index) => taggedPaths[index] === exactPath || record.changeset?.files.some((change) =>
        change.before?.path === exactPath || change.after?.path === exactPath))
      .sort(newestRecordFirst)
      .map((record) => ({
        invocationId: record.id,
        createdAt: record.createdAt,
        ...(record.endedAt ? { endedAt: record.endedAt } : {}),
        command: { handle: record.command.handle, label: record.command.label },
        outcome: invocationHistoryOutcome(record),
        changedFileCount: record.changeset?.files.length ?? 0,
        ...(record.providerSessionId ? { providerSessionId: record.providerSessionId } : {}),
      }));
  }

  async getReview(id: string): Promise<InvocationReviewPayload | null> {
    const scope = this.scopeForInvocation(id);
    const store = new InvocationStore(scope.workspaceRoot);
    const invocation = await store.readRecord(id);
    const change = representativeChange(invocation);
    if (!invocation || !change) return null;
    const payload = await this.reviewService(scope.workspaceRoot).getFilePayload(invocation, change.id);
    return {
      invocation,
      patch: wholeTextDiff(change, payload.beforeText, payload.afterText),
      before: payload.beforeText,
      after: payload.afterText,
      canReject: payload.canReject,
    };
  }

  async keepReview(id: string): Promise<InvocationRecord | null> {
    const record = await this.get(id);
    if (!record?.changeset?.files.some((change) => isUnresolvedReviewDecision(change.decision.status))) return record;
    return this.reviewInvocationAll(id, "keep");
  }

  async rejectReview(id: string, expectedAfterSha256: string | null): Promise<InvocationRecord> {
    const scope = this.scopeForInvocation(id);
    const store = new InvocationStore(scope.workspaceRoot);
    const record = await requiredInvocation(store, id);
    const representative = representativeChange(record);
    if (!representative || representative.decision.status !== "pending") {
      throw new InvocationRunnerError("review-unavailable", "This invocation has no pending document review.");
    }
    if ((representative.after?.sha256 ?? null) !== expectedAfterSha256) {
      throw new InvocationRunnerError("review-drift", "The proposed document version no longer matches this review.");
    }
    return this.reviewInvocationAll(id, "reject");
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
      const workspaceRoot = record.workspaceRoot ?? settings.workspaceRoot;
      const noteRoots = record.noteRoots?.length ? [...record.noteRoots] : [...settings.noteRoots];
      this.invocationScopes.set(record.id, { workspaceRoot, noteRoots });
      const recordStore = workspaceRoot === settings.workspaceRoot ? store : new InvocationStore(workspaceRoot);
      const recovered = await this.reviewService(workspaceRoot).recoverJournal(record);
      const launch = await recordStore.readManifest(record.id, "launch");
      const requiresExactRecovery = recovered.status === "pending" || recovered.status === "running" ||
        Boolean(launch && !recovered.changeset);
      if (!requiresExactRecovery) continue;
      const settled = launch
        ? await recordStore.readManifest(record.id, "settled") ?? await recordStore.captureManifest(record.id, "settled", noteRoots)
        : null;
      const changeset = launch && settled ? buildInvocationChangeset(launch, settled) : recovered.changeset;
      const next = withCompatibilityReview({
        ...recovered,
        status: "orphaned",
        endedAt: new Date().toISOString(),
        ...(changeset ? { changeset, changedFileRefs: changedFileRefs(changeset.files, new Set()) } : {}),
        attribution: changeset?.files.length
          ? { status: "ambiguous", reason: "Exo recovered these exact file changes after restarting during the invocation." }
          : { status: "unattributed", reason: "Exo restarted before this invocation changed a Note Root file." },
      });
      await recordStore.writeRecord(next);
      this.emit("updated", next);
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
    noteRoots: string[],
    continuityLockKey?: string,
  ): void {
    if (!record.taggedDocumentPath) return;
    this.active.set(record.id, {
      record,
      before,
      workspaceRoot,
      noteRoots,
      ...(continuityLockKey ? { continuityLockKey } : {}),
      observedPaths: new Set(),
      lastWorkspaceChangeAtMs: Date.now(),
    });
  }

  private onWorkspaceChange(event: WorkspaceChangeEvent): void {
    if (!event.filePath) return;
    const changedPath = path.resolve(event.filePath);
    for (const observation of this.active.values()) {
      if (!observation.noteRoots.some((root) => isWithinPath(root, changedPath))) continue;
      observation.observedPaths.add(changedPath);
      observation.lastWorkspaceChangeAtMs = Date.now();
    }
  }

  private settle(id: string, status: "process-exited" | "user-ended" | "failed", exitCode?: number, failureReason?: string): Promise<InvocationRecord | null> {
    const observation = this.active.get(id);
    if (!observation) return Promise.resolve(null);
    if (observation.settlementPromise) return observation.settlementPromise;
    const settlement = this.captureSettlement(observation, status, exitCode, failureReason);
    observation.settlementPromise = settlement;
    return settlement;
  }

  private async captureSettlement(
    observation: ActiveObservation,
    status: "process-exited" | "user-ended" | "failed",
    exitCode?: number,
    failureReason?: string,
  ): Promise<InvocationRecord | null> {
    const id = observation.record.id;
    try {
      const store = new InvocationStore(observation.workspaceRoot);
      await this.waitForSettlementQuiet(observation);
      const launch = await store.readManifest(id, "launch");
      if (!launch) throw new InvocationRunnerError("review-unavailable", "The invocation launch manifest is unavailable.");
      const settled = await store.captureManifest(id, "settled", observation.noteRoots);
      const changeset = buildInvocationChangeset(launch, settled);
      const changed = changeset.files.length > 0;
      const missingDurableResponse = status === "process-exited" &&
        isDocumentAgentProtocolId(observation.record.protocolInvocationId) &&
        !await hasDurableResponse(store, id, settled, observation.record.protocolInvocationId, observation.record.command.handle);
      const settledStatus = missingDurableResponse ? "failed" : status;
      const settledFailureReason = missingDurableResponse
        ? `@${observation.record.command.handle} finished without writing its linked response into the note.`
        : failureReason;
      const refs = changedFileRefs(changeset.files, observation.observedPaths);
      const next = withCompatibilityReview({
        ...observation.record,
        status: settledStatus,
        endedAt: new Date().toISOString(),
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(settledStatus === "failed" ? { failureReason: settledFailureReason ?? `Command exited with code ${exitCode ?? "unknown"}.` } : {}),
        changedFileRefs: refs,
        diffRefs: [],
        changeset,
        attribution: changed
          ? { status: refs.some((entry) => entry.attribution === "ambiguous") ? "ambiguous" : "likely" }
          : { status: "unattributed", reason: settledStatus === "failed" ? settledFailureReason ?? "The Command failed before changing a Note Root file." : "No Note Root changes observed." },
      });
      await store.writeRecord(next);
      this.emit("updated", next);
      this.releaseObservation(observation);
      return next;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const recoverable: InvocationRecord = {
        ...observation.record,
        status: "orphaned",
        endedAt: new Date().toISOString(),
        failureReason: `Invocation settlement failed: ${reason}`,
        attribution: { status: "ambiguous", reason: "Exact settlement is incomplete and will be retried before this Note Root is unlocked." },
      };
      let settlementError = error;
      try {
        await new InvocationStore(observation.workspaceRoot).writeRecord(recoverable);
        observation.record = recoverable;
        this.emit("updated", recoverable);
      } catch (recoveryError) {
        settlementError = new AggregateError(
          [error, recoveryError],
          "Invocation settlement failed and its recoverable record could not be persisted.",
        );
      } finally {
        observation.settlementPromise = undefined;
      }
      throw settlementError;
    }
  }

  private settleFromEvent(
    id: string,
    status: "process-exited" | "user-ended" | "failed",
    exitCode?: number,
    failureReason?: string,
  ): void {
    void this.settle(id, status, exitCode, failureReason).catch((error) => {
      this.emit("settlement-error", { invocationId: id, error });
    });
  }

  private releaseObservation(observation: ActiveObservation): void {
    const id = observation.record.id;
    this.clearActivity(id);
    this.active.delete(id);
    if (observation.record.terminalSessionId) this.byTerminal.delete(observation.record.terminalSessionId);
    if (observation.continuityLockKey) this.continuityLocks.delete(observation.continuityLockKey);
    this.releaseChangesetLock(id);
  }

  private async waitForSettlementQuiet(observation: ActiveObservation): Promise<void> {
    const quietMs = this.options.settlementQuietMs ?? DEFAULT_SETTLEMENT_QUIET_MS;
    const maxWaitMs = this.options.settlementMaxWaitMs ?? DEFAULT_SETTLEMENT_MAX_WAIT_MS;
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs && Date.now() - observation.lastWorkspaceChangeAtMs < quietMs) {
      const remainingQuiet = quietMs - (Date.now() - observation.lastWorkspaceChangeAtMs);
      await delay(Math.max(1, Math.min(remainingQuiet, maxWaitMs - (Date.now() - startedAt))));
    }
  }

  private async acquireChangesetLock(prepared: PreparedInvocation, store: InvocationStore): Promise<void> {
    const roots = prepared.noteRoots.map((root) => path.resolve(root));
    if ([...this.changesetLocks.values()].some((lock) => rootsOverlap(lock.noteRoots, roots))) {
      throw new InvocationRunnerError("review-busy", "Another invocation is changing an overlapping Note Root.");
    }
    this.changesetLocks.set(prepared.id, { invocationId: prepared.id, noteRoots: roots });
    try {
      const unresolved = (await store.listRecords()).find((record) =>
        record.id !== prepared.id &&
        record.changeset?.files.some((change) => isUnresolvedReviewDecision(change.decision.status)) &&
        rootsOverlap(record.noteRoots ?? [], roots));
      if (unresolved) {
        throw new InvocationRunnerError("review-busy", "Review the previous invocation before starting another in this Note Root.", { invocationId: unresolved.id });
      }
    } catch (error) {
      this.releaseChangesetLock(prepared.id);
      throw error;
    }
  }

  private releaseChangesetLock(id: string): void {
    this.changesetLocks.delete(id);
  }

  private reviewService(workspaceRoot: string): InvocationReviewService {
    return new InvocationReviewService(workspaceRoot);
  }

  private async resolveReview(
    id: string,
    resolutions: Array<{ changeId: string; action: "keep" | "reject" }>,
  ): Promise<InvocationRecord> {
    const scope = this.scopeForInvocation(id);
    const store = new InvocationStore(scope.workspaceRoot);
    const record = await requiredInvocation(store, id);
    try {
      const next = await this.reviewService(scope.workspaceRoot).resolve(record, resolutions);
      this.emit("updated", next);
      return next;
    } catch (error) {
      if (error instanceof InvocationReviewError) throw new InvocationRunnerError(error.code, error.message);
      throw error;
    }
  }

  private emitActivity(id: string, activity: ParsedInvocationActivity, immediate = false): void {
    const key = `${activity.kind}:${activity.label ?? ""}`;
    const now = Date.now();
    const state = this.activityState.get(id) ?? { lastKey: "", emittedAtMs: 0 };
    if (state.lastKey === key && !state.pending) return;
    const elapsed = now - state.emittedAtMs;
    if (!immediate && elapsed < INVOCATION_ACTIVITY_INTERVAL_MS) {
      state.pending = activity;
      if (!state.timer) {
        state.timer = setTimeout(() => {
          const current = this.activityState.get(id);
          if (!current?.pending) return;
          const pending = current.pending;
          current.pending = undefined;
          current.timer = undefined;
          this.publishActivity(id, pending, current);
        }, INVOCATION_ACTIVITY_INTERVAL_MS - elapsed);
        state.timer.unref?.();
      }
      this.activityState.set(id, state);
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    state.pending = undefined;
    this.publishActivity(id, activity, state);
  }

  private publishActivity(
    id: string,
    activity: { kind: InvocationActivityKind; label?: string },
    state: { lastKey: string; emittedAtMs: number; pending?: ParsedInvocationActivity; timer?: NodeJS.Timeout },
  ): void {
    state.lastKey = `${activity.kind}:${activity.label ?? ""}`;
    state.emittedAtMs = Date.now();
    this.activityState.set(id, state);
    const event: InvocationActivityEvent = {
      invocationId: id,
      kind: activity.kind,
      emittedAt: new Date(state.emittedAtMs).toISOString(),
      ...(activity.label ? { label: activity.label } : {}),
    };
    this.emit("activity", event);
  }

  private clearActivity(id: string): void {
    const state = this.activityState.get(id);
    if (state?.timer) clearTimeout(state.timer);
    this.activityState.delete(id);
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

const INVOCATION_ACTIVITY_INTERVAL_MS = 200;

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
async function requiredInvocation(store: InvocationStore, id: string): Promise<InvocationRecord> {
  const record = await store.readRecord(id);
  if (!record) throw new InvocationRunnerError("not-found", `Invocation ${id} was not found.`);
  return record;
}

function representativeChange(record: InvocationRecord | null): InvocationFileChange | null {
  if (!record?.changeset?.files.length) return null;
  return record.taggedDocumentPath
    ? record.changeset.files.find((change) =>
        change.before?.path === record.taggedDocumentPath || change.after?.path === record.taggedDocumentPath) ?? record.changeset.files[0]!
    : record.changeset.files[0]!;
}

function wholeTextDiff(change: InvocationFileChange, before: string | null, after: string | null): string | null {
  if (before === null && after === null) return null;
  const beforePath = change.before?.path ?? change.after?.path ?? "file";
  const afterPath = change.after?.path ?? change.before?.path ?? "file";
  return [
    `--- a/${path.basename(beforePath)}`,
    `+++ b/${path.basename(afterPath)}`,
    "@@ -1 +1 @@",
    ...(before ?? "").split("\n").map((line) => `-${line}`),
    ...(after ?? "").split("\n").map((line) => `+${line}`),
    "",
  ].join("\n");
}

function changedFileRefs(files: readonly InvocationFileChange[], observedPaths: ReadonlySet<string>): InvocationRecord["changedFileRefs"] {
  const observedAt = new Date().toISOString();
  return files.map((change) => {
    const filePath = change.after?.path ?? change.before!.path;
    const observed = [change.before?.path, change.after?.path]
      .filter((candidate): candidate is string => Boolean(candidate))
      .some((candidate) => observedPaths.has(path.resolve(candidate)));
    return {
      path: filePath,
      kind: change.operation === "renamed" ? "unknown" : change.operation,
      observedAt,
      attribution: observed ? "likely" : "ambiguous",
    };
  });
}

async function hasDurableResponse(
  store: InvocationStore,
  invocationId: string,
  manifest: InvocationWorkspaceManifest,
  protocolInvocationId: string,
  handle: string,
): Promise<boolean> {
  for (const state of Object.values(manifest.files)) {
    if (state.mediaType !== "text") continue;
    const bytes = await store.readSnapshot(invocationId, state);
    if (!bytes) continue;
    if (findDocumentAgentEnvelopes(bytes.toString("utf8")).some((envelope) =>
      envelope.kind === "response" && envelope.invocationId === protocolInvocationId && envelope.agent === handle)) return true;
  }
  return false;
}

function reviewListItem(record: InvocationRecord): InvocationReviewListItem {
  return {
    invocationId: record.id,
    createdAt: record.createdAt,
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    command: { handle: record.command.handle, label: record.command.label },
    changedFileCount: record.changeset?.files.length ?? 0,
    pendingFileCount: record.changeset?.files.filter((change) => isUnresolvedReviewDecision(change.decision.status)).length ?? 0,
    status: record.status,
  };
}

function isUnresolvedReviewDecision(status: string): boolean {
  return status === "pending" || status === "conflict";
}

function newestRecordFirst(left: InvocationRecord, right: InvocationRecord): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function invocationHistoryOutcome(record: InvocationRecord): InvocationHistoryItem["outcome"] {
  const changesetStatus = record.changeset?.status;
  if (changesetStatus === "pending-review" || changesetStatus === "partially-resolved" || changesetStatus === "conflict" ||
      record.status === "pending" || record.status === "running") return "pending";
  if (changesetStatus === "rejected") return "rejected";
  if (changesetStatus === "kept" || changesetStatus === "resolved") return "kept";
  if (record.status === "failed" || record.status === "orphaned") return "failed";
  return "kept";
}

function rootsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftRoot) => right.some((rightRoot) =>
    isWithinPath(leftRoot, rightRoot) || isWithinPath(rightRoot, leftRoot)));
}

function isWithinPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function canonicalPathOrResolved(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    const resolved = path.resolve(filePath);
    try {
      return path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
    } catch {
      return resolved;
    }
  }
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
