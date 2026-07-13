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
  readWorkspaceDocument,
  WorkspaceFiles,
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
import { DirectInvocationProcessFactory, type InvocationProcess, type InvocationProcessFactory } from "./invocation-process";
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
      before = verified;
    }
    return { id, request, command, cwd, before, pending };
  }

  async authorizeAndStart(prepared: PreparedInvocation): Promise<InvocationStartResult> {
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
    let invocationProcess: InvocationProcess | undefined;
    let processExited = false;
    let processExitCode: number | null = null;
    let processStdout = "";
    let processFailureReason: string | null = null;
    let observationReady = false;
    const settleHeadlessProcess = () => {
      const status = processExitCode !== 0 || processFailureReason ? "failed" : "process-exited";
      setTimeout(
        () => void this.settle(prepared.id, status, processExitCode ?? undefined, processFailureReason ?? undefined),
        OBSERVATION_EXIT_GRACE_MS,
      ).unref?.();
    };
    try {
      const prompt = prepared.request.context === "note"
        ? formatNoteInvocationPrompt({
            documentPath: prepared.request.documentPath!,
            mentionText: prepared.request.mentionText ?? "",
            message: prepared.request.message,
            frontmatter: prepared.request.documentFrontmatter,
            body: prepared.request.documentBody,
          })
        : formatCliInvocationPrompt({ task: prepared.request.task ?? prepared.request.message, workspaceRoot: settings.workspaceRoot });
      if (prepared.request.context === "note") {
        invocationProcess = (this.options.invocationProcessFactory ?? new DirectInvocationProcessFactory()).launch({
          command: commandForHeadlessInvocation(prepared.command),
          cwd: prepared.cwd,
          env: globalThis.process.env,
        });
        invocationProcess.onExit(({ exitCode, stdout }) => {
          processExited = true;
          processExitCode = exitCode;
          processStdout = stdout;
          processFailureReason = claudeInvocationFailure(prepared.command, stdout);
          const observation = this.active.get(prepared.id);
          if (observation) {
            observation.record = applyProviderSessionProvenance(observation.record, stdout);
          }
          if (observationReady) settleHeadlessProcess();
        });
        await invocationProcess.send(prompt);
      } else {
        terminal = await this.options.terminalManager.createAgentCommand(prepared.command, prepared.cwd);
        const delivered = await this.options.terminalManager.sendMessage(terminal.id, prompt, true);
        if (!delivered.ok) throw new InvocationRunnerError("prompt-delivery-failed", "Agent prompt could not be delivered.");
      }
      const startedAt = new Date().toISOString();
      const running = applyProviderSessionProvenance({
        ...prepared.pending,
        status: "running" as const,
        startedAt,
        ...(terminal ? { terminalSessionId: terminal.id } : {}),
      }, processStdout);
      await store.writeRecord(running);
      if (prepared.before) this.observe(running, prepared.before);
      if (invocationProcess && prepared.before) {
        observationReady = true;
        if (processExited) settleHeadlessProcess();
      }
      return { ok: true, invocation: running, ...(terminal ? { terminal } : {}) };
    } catch (error) {
      if (terminal) await this.options.terminalManager.kill(terminal.id).catch(() => undefined);
      invocationProcess?.kill();
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
    const result = await this.authorizeAndStart(prepared);
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

  async endObservation(id: string): Promise<InvocationRecord | null> { return this.settle(id, "user-ended"); }
  async get(id: string): Promise<InvocationRecord | null> { return new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot).readRecord(id); }
  async review(id: string): Promise<InvocationRecord | null> { return this.get(id); }

  async getReview(id: string): Promise<InvocationReviewPayload | null> {
    const store = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
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
    const store = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
    const record = await store.readRecord(id);
    if (!record?.review || record.review.status !== "pending") return record;
    const next = { ...record, review: { ...record.review, status: "kept" as const, reviewedAt: new Date().toISOString() } };
    await store.writeRecord(next);
    this.emit("updated", next);
    return next;
  }

  async rejectReview(id: string, expectedAfterSha256: string | null): Promise<InvocationRecord> {
    const settings = this.options.getWorkspaceSettings();
    const store = new InvocationStore(settings.workspaceRoot);
    const record = await store.readRecord(id);
    if (!record?.taggedDocumentPath || !record.review || record.review.status !== "pending") {
      throw new InvocationRunnerError("review-unavailable", "This invocation has no pending document review.");
    }
    if (record.review.afterSha256 !== expectedAfterSha256) {
      throw new InvocationRunnerError("review-drift", "The proposed document version no longer matches this review.");
    }
    const filePath = await new WorkspaceFiles(settings.noteRoots).writable(record.taggedDocumentPath);
    const current = await snapshotTextFile(filePath);
    if (current.sha256 !== record.review.afterSha256) {
      throw new InvocationRunnerError("review-drift", "The document changed after the invocation. Exo will not overwrite newer work.");
    }
    const beforePath = path.join(resolveInvocationStoreLayout(settings.workspaceRoot).invocationsDir, safeStoreSegment(id), "before.md");
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
    if (!record?.providerSessionId || record.command.handle !== "claude") {
      throw new InvocationRunnerError("resume-unavailable", "This invocation does not have resumable Claude session provenance.");
    }
    return this.options.terminalManager.createAgentCommand(
      { ...record.command, command: commandForClaudeResume(record.command, record.providerSessionId) },
      record.cwd,
    );
  }

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

  private async settle(id: string, status: "process-exited" | "user-ended" | "failed", exitCode?: number, failureReason?: string): Promise<InvocationRecord | null> {
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
      const artifactRoot = path.dirname(path.dirname(diffPath));
      await Promise.all([
        writeFile(path.join(artifactRoot, "before.md"), observation.before.content, "utf8"),
        writeFile(path.join(artifactRoot, "after.md"), after.content, "utf8"),
      ]);
      diffRefs.push({ id: diffId, path: observation.before.path, format: "unified", ref: diffRef });
      changedFileRefs.push({ path: observation.before.path, kind: after.exists ? observation.before.exists ? "modified" : "created" : "deleted", observedAt: new Date().toISOString(), attribution: observation.overlapAtStart || !observation.observedPaths.has(path.resolve(observation.before.path)) ? "ambiguous" : "likely", diffRefId: diffId });
    }
    const next = { ...observation.record, status, endedAt: new Date().toISOString(), ...(exitCode === undefined ? {} : { exitCode }), ...(status === "failed" ? { failureReason: failureReason ?? `Command exited with code ${exitCode ?? "unknown"}.` } : {}), changedFileRefs, diffRefs, ...(changed ? { review: { status: "pending" as const, beforeSha256: observation.before.sha256, afterSha256: after.sha256 } } : {}), attribution: changed ? { status: changedFileRefs.some((f) => f.attribution === "ambiguous") ? "ambiguous" as const : "likely" as const } : { status: "unattributed" as const, reason: status === "failed" ? failureReason ?? "The Command failed before changing the tagged document." : "No tagged document changes observed." } };
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

function applyProviderSessionProvenance(record: InvocationRecord, stdout: string): InvocationRecord {
  const providerSessionId = record.command.handle === "claude" ? extractClaudeSessionId(stdout) : null;
  return providerSessionId ? { ...record, providerSessionId } : record;
}

/** Claude's print JSON is untrusted process output; accept only a real UUID. */
export function extractClaudeSessionId(stdout: string): string | null {
  for (const event of claudeOutputEvents(stdout).reverse()) {
    const sessionId = event.session_id;
    if (typeof sessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return sessionId;
    }
  }
  return null;
}

function claudeInvocationFailure(command: AgentCommand, stdout: string): string | null {
  if (command.handle !== "claude") return null;
  const result = claudeOutputEvents(stdout).reverse().find((event) => event.type === "result");
  return Array.isArray(result?.permission_denials) && result.permission_denials.length > 0
    ? "Claude could not edit the document because its write permission was denied."
    : null;
}

function claudeOutputEvents(stdout: string): Array<Record<string, unknown>> {
  const parsed: unknown[] = [];
  try {
    parsed.push(JSON.parse(stdout.trim()));
  } catch {
    for (const line of stdout.split(/\r?\n/)) {
      try { parsed.push(JSON.parse(line)); } catch { /* Ignore unstructured output. */ }
    }
  }
  return parsed.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try { return await readFile(filePath, "utf8"); } catch { return null; }
}

function shellArgument(value: string): string { return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`; }

/** Claude's documented print JSON exposes its real session_id. Generic Commands
 * retain their configured command and simply have no resumable provenance. */
export function commandForHeadlessInvocation(command: AgentCommand): string {
  if (command.handle !== "claude" || /(?:^|\s)--output-format(?:\s|=)/.test(command.command)) return command.command;
  return `${command.command} --output-format json`;
}

/** Reuse the configured Claude executable for the visible provider-native
 * handoff, removing only print-mode switches that conflict with --resume. */
export function commandForClaudeResume(command: AgentCommand, sessionId: string): string {
  const executable = command.command
    .replace(/(?:^|\s)-p(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--print(?:\s|$)/g, " ")
    .replace(/(?:^|\s)--output-format(?:\s+\S+|=\S+)?/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `${executable} --resume ${shellArgument(sessionId)}`;
}
