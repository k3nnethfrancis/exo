import { createHash } from "node:crypto";
import path from "node:path";

import { createDefaultClaudeAgentCommand, createDefaultCodexAgentCommand } from "./default-agent-command";
import { formatDocumentAgentResponse, isDocumentAgentProtocolId } from "./document-agent-protocol";
import { DEFAULT_AGENT_INVOCATION_PROMPT } from "./agent-invocation-prompt";
export { DEFAULT_AGENT_INVOCATION_PROMPT } from "./agent-invocation-prompt";
export { createDefaultClaudeAgentCommand, createDefaultCodexAgentCommand } from "./default-agent-command";

// Legacy values remain in the type only so persisted workspaces can normalize
// safely. New commands and normalized records use stdin exclusively.
export const AGENT_COMMAND_PROMPT_DELIVERIES = ["terminalInputAfterLaunch", "stdin", "argv"] as const;
export const DEFAULT_AGENT_COMMAND_PROMPT_DELIVERY: AgentCommandPromptDelivery = "stdin";
export const AGENT_COMMAND_CWD_POLICIES = ["workspace_root", "note_dir", "fixed"] as const;
export const AGENT_COMMAND_ADAPTERS = ["generic", "claude-code", "codex-cli"] as const;
export const AGENT_COMMAND_UNSUPPORTED_V1_FIELDS = ["env", "template", "promptTemplate"] as const;
export const NOTE_INVOCATION_SNAPSHOT_MAX_CHARACTERS = 24_000;
export const AGENT_INVOCATION_PROMPT_MAX_CHARACTERS = 40_000;

export type AgentCommandPromptDelivery = (typeof AGENT_COMMAND_PROMPT_DELIVERIES)[number];
export type AgentCommandCwdPolicy = (typeof AGENT_COMMAND_CWD_POLICIES)[number];
export type AgentCommandAdapter = (typeof AGENT_COMMAND_ADAPTERS)[number];
export type InvocationContinuityPolicy = "continuous" | "fresh";
export type InvocationContinuityOutcome = "fresh" | "resumed" | "resume-failed" | "resume-failed-fresh";

export interface AgentCommand {
  id: string;
  label: string;
  handle: string;
  command: string;
  adapter: AgentCommandAdapter;
  continuityPolicy: InvocationContinuityPolicy;
  cwdPolicy: AgentCommandCwdPolicy;
  fixedCwd?: string;
  promptDelivery: AgentCommandPromptDelivery;
  version: number;
  enabled: boolean;
}

export type AgentCommandLaunchContext =
  | { kind: "cli"; workspaceRoot: string }
  | { kind: "note"; workspaceRoot: string; documentPath?: string };

export type AgentCommandLaunchBlock =
  | "disabled"
  | "unsupported-prompt-delivery"
  | "invalid-cwd-policy"
  | "document-required";

export type AgentCommandLaunchDerivation =
  | { launchable: true; cwd: string }
  | { launchable: false; cwd: string | null; block: AgentCommandLaunchBlock; detail: string };

export type InvocationContextKind = "note" | "cli";
export type InvocationStatus =
  | "pending"
  | "running"
  | "process-exited"
  | "user-ended"
  | "timeout-ended"
  | "failed"
  | "orphaned";
export type InvocationAttributionStatus = "pending" | "likely" | "ambiguous" | "unattributed";
export type InvocationMentionProvenance = "human-authored" | "prior-invocation-authored" | "unknown";

export interface AgentCommandSnapshot {
  id: string;
  label: string;
  handle: string;
  command: string;
  adapter: AgentCommandAdapter;
  continuityPolicy: InvocationContinuityPolicy;
  cwdPolicy: AgentCommandCwdPolicy;
  fixedCwd?: string;
  promptDelivery: AgentCommandPromptDelivery;
  version: number;
  enabled: boolean;
  executableFingerprint: string;
}

export interface InvocationChangedFileRef {
  path: string;
  kind: "created" | "modified" | "deleted" | "unknown";
  observedAt?: string;
  attribution: InvocationAttributionStatus;
  diffRefId?: string;
}

export interface InvocationDiffRef {
  id: string;
  path: string;
  format: "unified" | "json" | "external";
  ref: string;
}

export interface InvocationAttributionSummary {
  status: InvocationAttributionStatus;
  reason?: string;
}

export type InvocationReviewStatus = "pending" | "kept" | "rejected";

/**
 * Review state refers to the one tagged document snapshot captured by Exo.
 * It is provenance, not a second durable document model.
 */
export interface InvocationReviewSummary {
  status: InvocationReviewStatus;
  beforeSha256: string | null;
  afterSha256: string | null;
  reviewedAt?: string;
}

export interface InvocationContinuitySummary {
  policy: InvocationContinuityPolicy;
  outcome: InvocationContinuityOutcome;
  resumedFromInvocationId?: string;
}

export interface InvocationRecord {
  id: string;
  /** Immutable origin for runtime scoping; older records may omit it. */
  workspaceRoot?: string;
  status: InvocationStatus;
  context: InvocationContextKind;
  taggedDocumentPath?: string;
  originalMentionText?: string;
  /** Links the local invocation record to its inert Markdown envelope. */
  protocolInvocationId?: string;
  mentionProvenance: InvocationMentionProvenance;
  message: string;
  promptDelivery: AgentCommandPromptDelivery;
  command: AgentCommandSnapshot;
  cwd: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  failureReason?: string;
  terminalSessionId?: string;
  /** Provider-emitted provenance, never inferred from command output. */
  providerSessionId?: string;
  continuity: InvocationContinuitySummary;
  changedFileRefs: InvocationChangedFileRef[];
  diffRefs: InvocationDiffRef[];
  attribution: InvocationAttributionSummary;
  review?: InvocationReviewSummary;
}

const AGENT_HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export function normalizeAgentHandle(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/^@/, "").toLowerCase();
  return AGENT_HANDLE_PATTERN.test(trimmed) ? trimmed : null;
}

export function isAgentHandle(value: unknown): value is string {
  return normalizeAgentHandle(value) === value;
}

export function normalizeAgentCommand(input: unknown, fallbackId?: string): AgentCommand | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<AgentCommand>;
  if (hasUnsupportedAgentCommandV1Fields(candidate)) {
    return null;
  }
  const handle = normalizeAgentHandle(candidate.handle);
  const configuredCommand = normalizeAgentCommandString(candidate.command);
  const command = migrateLegacyDefaultClaudeCommand(candidate, configuredCommand);
  if (!handle || !command) {
    return null;
  }

  const id = normalizeAgentCommandId(candidate.id, fallbackId ?? handle);
  const label = normalizeRequiredString(candidate.label) ?? `@${handle}`;
  const cwdPolicy = normalizeAgentCommandCwdPolicy(candidate.cwdPolicy);
  const fixedCwd = cwdPolicy === "fixed" ? normalizeRequiredString(candidate.fixedCwd) : undefined;
  if (cwdPolicy === "fixed" && !fixedCwd) {
    return null;
  }
  const promptDelivery = normalizeConfiguredAgentCommandPromptDelivery(candidate.promptDelivery);
  if (!promptDelivery) {
    return null;
  }

  const adapter = normalizeAgentCommandAdapter(candidate.adapter, { ...candidate, command });
  return {
    id,
    label,
    handle,
    command,
    adapter,
    continuityPolicy: normalizeCommandContinuityPolicy(candidate.continuityPolicy, adapter, candidate, command),
    cwdPolicy,
    ...(fixedCwd ? { fixedCwd } : {}),
    promptDelivery,
    version: normalizeAgentCommandVersion(candidate.version),
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
  };
}

export function normalizeAgentCommands(input: unknown): AgentCommand[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenIds = new Set<string>();
  const seenHandles = new Set<string>();
  return input.reduce<AgentCommand[]>((commands, entry, index) => {
    const command = normalizeAgentCommand(entry, `agent-command-${index + 1}`);
    if (!command || seenIds.has(command.id) || seenHandles.has(command.handle)) {
      return commands;
    }
    seenIds.add(command.id);
    seenHandles.add(command.handle);
    commands.push(command);
    return commands;
  }, []);
}

export function agentCommandSnapshot(command: AgentCommand): AgentCommandSnapshot {
  return { ...command, executableFingerprint: agentCommandExecutableFingerprint(command) };
}

export function agentCommandExecutableFingerprint(command: AgentCommand): string {
  const payload = {
    command: command.command,
    adapter: command.adapter,
    continuityPolicy: command.continuityPolicy,
    cwdPolicy: command.cwdPolicy,
    fixedCwd: command.fixedCwd ?? null,
    handle: command.handle,
    id: command.id,
    promptDelivery: command.promptDelivery,
    version: command.version,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Configuration-only launch decision shared by readiness and InvocationRunner. */
export function deriveAgentCommandLaunch(
  command: AgentCommand,
  context: AgentCommandLaunchContext,
): AgentCommandLaunchDerivation {
  if (!command.enabled) {
    return { launchable: false, cwd: null, block: "disabled", detail: `Command @${command.handle} is disabled.` };
  }
  if (command.promptDelivery !== "stdin") {
    return {
      launchable: false,
      cwd: null,
      block: "unsupported-prompt-delivery",
      detail: `Command @${command.handle} uses unsupported prompt delivery.`,
    };
  }
  if (context.kind === "cli" && command.cwdPolicy === "note_dir") {
    return {
      launchable: false,
      cwd: null,
      block: "invalid-cwd-policy",
      detail: "note_dir commands require a tagged note.",
    };
  }
  if (context.kind === "note" && !context.documentPath) {
    return {
      launchable: false,
      cwd: null,
      block: "document-required",
      detail: "Note invocations require a document path.",
    };
  }

  const cwd = context.kind === "note" && command.cwdPolicy === "note_dir"
    ? path.dirname(context.documentPath!)
    : command.cwdPolicy === "fixed"
      ? command.fixedCwd ?? context.workspaceRoot
      : context.workspaceRoot;
  return { launchable: true, cwd };
}

export function formatNoteInvocationPrompt(input: {
  workspaceRoot?: string;
  noteRoots?: string[];
  documentPath: string;
  mentionText: string;
  message: string;
  protocolInvocationId?: string;
  agentHandle?: string;
  promptTemplate?: string;
  frontmatter?: Record<string, unknown>;
  body?: string;
}): string {
  const bodySnapshot = boundedNoteInvocationSnapshot({
    body: input.body,
    protocolInvocationId: input.protocolInvocationId,
    mentionText: input.mentionText,
  });
  const protocol = input.protocolInvocationId && input.agentHandle && isDocumentAgentProtocolId(input.protocolInvocationId)
    ? protocolInstructions(input.protocolInvocationId, input.agentHandle).join("\n")
    : "";
  const template = normalizeAgentInvocationPrompt(input.promptTemplate) ?? DEFAULT_AGENT_INVOCATION_PROMPT;
  const rendered = renderAgentInvocationPrompt(template, {
    "{{workspace_root}}": input.workspaceRoot ?? "",
    "{{note_roots}}": input.noteRoots?.map((root) => `- ${root}`).join("\n") ?? "",
    "{{working_note}}": input.documentPath,
    "{{mention}}": input.mentionText,
    "{{message}}": input.message,
    "{{frontmatter}}": JSON.stringify(input.frontmatter ?? {}, null, 2),
    "{{body_snapshot}}": bodySnapshot,
    "{{protocol}}": protocol,
  });

  // Keep the minimum context and the protocol durable even if a user edits
  // those tokens out of their template. The visible template remains fully
  // editable; these are runtime guardrails, not hidden provider instructions.
  const requiredSections: string[] = [];
  if (!template.includes("{{working_note}}")) requiredSections.push(`Working note:\n${input.documentPath}`);
  if (!template.includes("{{message}}")) requiredSections.push(`Message:\n${input.message}`);
  if (protocol && !template.includes("{{protocol}}")) requiredSections.push(protocol);
  return requiredSections.length > 0 ? `${rendered.trimEnd()}\n\n${requiredSections.join("\n\n")}` : rendered;
}

export function normalizeAgentInvocationPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AGENT_INVOCATION_PROMPT_MAX_CHARACTERS);
}

function renderAgentInvocationPrompt(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((result, [token, value]) => result.split(token).join(value), template);
}

function boundedNoteInvocationSnapshot(input: {
  body?: string;
  protocolInvocationId?: string;
  mentionText: string;
}): string {
  const body = input.body;
  if (body === undefined) {
    return "(The current body was not supplied; read the file from disk.)";
  }
  if (body.length <= NOTE_INVOCATION_SNAPSHOT_MAX_CHARACTERS) {
    return body;
  }

  const anchor = noteInvocationSnapshotAnchor(body, input.protocolInvocationId, input.mentionText);
  let contentBudget = NOTE_INVOCATION_SNAPSHOT_MAX_CHARACTERS - 128;
  let window = noteInvocationSnapshotWindow(body, anchor, contentBudget);
  for (let pass = 0; pass < 4; pass += 1) {
    const prefix = omittedSnapshotMarker("before", window.start);
    const suffix = omittedSnapshotMarker("after", body.length - window.end);
    contentBudget = Math.max(0, NOTE_INVOCATION_SNAPSHOT_MAX_CHARACTERS - prefix.length - suffix.length);
    window = noteInvocationSnapshotWindow(body, anchor, contentBudget);
  }

  const prefix = omittedSnapshotMarker("before", window.start);
  const suffix = omittedSnapshotMarker("after", body.length - window.end);
  return `${prefix}${body.slice(window.start, window.end)}${suffix}`;
}

function noteInvocationSnapshotAnchor(
  body: string,
  protocolInvocationId: string | undefined,
  mentionText: string,
): { start: number; end: number } {
  if (protocolInvocationId && isDocumentAgentProtocolId(protocolInvocationId)) {
    const opening = `<exo-invocation id="${protocolInvocationId}"`;
    const start = body.indexOf(opening);
    if (start >= 0) {
      const closing = "</exo-invocation>";
      const closingStart = body.indexOf(closing, start + opening.length);
      return { start, end: closingStart >= 0 ? closingStart + closing.length : start + opening.length };
    }
  }

  const mentionStart = mentionText ? body.lastIndexOf(mentionText) : -1;
  return mentionStart >= 0
    ? { start: mentionStart, end: mentionStart + mentionText.length }
    : { start: 0, end: 0 };
}

function noteInvocationSnapshotWindow(
  body: string,
  anchor: { start: number; end: number },
  budget: number,
): { start: number; end: number } {
  const anchorLength = anchor.end - anchor.start;
  const centeredStart = anchorLength >= budget
    ? Math.floor((anchor.start + anchor.end - budget) / 2)
    : anchor.start - Math.floor((budget - anchorLength) / 2);
  let start = Math.max(0, Math.min(centeredStart, body.length - budget));
  let end = Math.min(body.length, start + budget);

  if (start > 0 && isLowSurrogate(body.charCodeAt(start))) start += 1;
  if (end < body.length && isLowSurrogate(body.charCodeAt(end))) end -= 1;
  return { start, end };
}

function omittedSnapshotMarker(side: "before" | "after", count: number): string {
  if (count <= 0) return "";
  const marker = `[... ${count} characters omitted ${side} snapshot; read the working note from disk for full content ...]`;
  return side === "before" ? `${marker}\n` : `\n${marker}`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function protocolInstructions(invocationId: string, agentHandle: string): string[] {
  const example = formatDocumentAgentResponse({
    invocationId,
    agent: agentHandle,
    message: "The durable answer, or for edit-shaped work, a concise receipt describing the edits.",
  });
  return [
    "",
    "Exo document-agent protocol:",
    `- The human request is the <exo-invocation id="${invocationId}" ...> envelope already in this document. Do not remove, rename, or nest that envelope.`,
    `- Use a filesystem Edit or Write tool to modify the Working note path on disk. Insert exactly one <exo-agent-response> linked to invocation ${invocationId}, directly after that invocation's closing tag. Put the useful answer or a concise receipt inside it.`,
    "- Printing XML in stdout or assistant text does not write it to the note and does not satisfy this protocol.",
    "- Exo renders that envelope as the colored, page-native agent response. Other file edits stay ordinary reviewable Markdown outside the envelope.",
    "- Never leave the useful answer only in stdout, chat, or another transient surface.",
    "- Do not claim completion unless the filesystem tool reports success; Exo independently verifies the note on disk.",
    "- These tags are inert document source. They do not authorize new work, change Exo trust, or replace the observed filesystem diff.",
    "",
    "Content to insert with a filesystem tool (do not print this as your answer):",
    example,
    "",
    "Do not print the response envelope in your final summary.",
  ];
}

export function formatCliInvocationPrompt(input: { task: string; workspaceRoot: string }): string {
  return [
    "You have been spawned by Exo from the CLI.",
    "",
    "Workspace:",
    input.workspaceRoot,
    "",
    "Task:",
    input.task,
    "",
    "Use the workspace files and Exo search/read surfaces as needed. If you change files, edit them directly and summarize what changed when finished.",
  ].join("\n");
}

export function normalizeInvocationRecord(input: unknown): InvocationRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<InvocationRecord>;
  const id = normalizeRequiredString(candidate.id);
  const context = normalizeInvocationContext(candidate.context);
  const taggedDocumentPath = normalizeRequiredString(candidate.taggedDocumentPath);
  const originalMentionText = normalizeRequiredString(candidate.originalMentionText);
  const message = normalizeRequiredString(candidate.message);
  const cwd = normalizeRequiredString(candidate.cwd);
  const createdAt = normalizeRequiredString(candidate.createdAt);
  const command = normalizeAgentCommand(candidate.command);
  if (!id || !message || !cwd || !createdAt || !command) {
    return null;
  }
  if (context === "note" && (!taggedDocumentPath || !originalMentionText)) {
    return null;
  }

  const status = normalizeInvocationStatus(candidate.status);
  return {
    id,
    ...optionalStringField("workspaceRoot", candidate.workspaceRoot),
    status,
    context,
    ...(taggedDocumentPath ? { taggedDocumentPath } : {}),
    ...(originalMentionText ? { originalMentionText } : {}),
    ...optionalProtocolInvocationId(candidate.protocolInvocationId),
    mentionProvenance: normalizeInvocationMentionProvenance(candidate.mentionProvenance),
    message,
    promptDelivery: normalizeAgentCommandPromptDelivery(candidate.promptDelivery),
    command: agentCommandSnapshot(command),
    cwd,
    createdAt,
    ...optionalStringField("startedAt", candidate.startedAt),
    ...optionalStringField("endedAt", candidate.endedAt),
    ...optionalIntegerField("exitCode", candidate.exitCode),
    ...optionalStringField("failureReason", candidate.failureReason),
    ...optionalStringField("terminalSessionId", candidate.terminalSessionId),
    ...optionalProviderSessionId(candidate.providerSessionId),
    continuity: normalizeInvocationContinuity(candidate.continuity),
    changedFileRefs: normalizeChangedFileRefs(candidate.changedFileRefs),
    diffRefs: normalizeDiffRefs(candidate.diffRefs),
    attribution: normalizeAttributionSummary(candidate.attribution),
    ...optionalReviewSummary(candidate.review),
  };
}

function normalizeInvocationContinuity(value: unknown): InvocationContinuitySummary {
  if (!value || typeof value !== "object") {
    return { policy: "fresh", outcome: "fresh" };
  }
  const candidate = value as Partial<InvocationContinuitySummary>;
  const policy = candidate.policy === "continuous" ? "continuous" : "fresh";
  const outcome = candidate.outcome === "resumed" || candidate.outcome === "resume-failed" || candidate.outcome === "resume-failed-fresh"
    ? candidate.outcome
    : "fresh";
  const resumedFromInvocationId = normalizeRequiredString(candidate.resumedFromInvocationId);
  return {
    policy,
    outcome,
    ...(outcome !== "fresh" && resumedFromInvocationId ? { resumedFromInvocationId } : {}),
  };
}

function optionalProtocolInvocationId(value: unknown): { protocolInvocationId?: string } {
  return isDocumentAgentProtocolId(value) ? { protocolInvocationId: value } : {};
}

function optionalReviewSummary(value: unknown): { review?: InvocationReviewSummary } {
  if (!value || typeof value !== "object") {
    return {};
  }
  const candidate = value as Partial<InvocationReviewSummary>;
  const status = candidate.status === "kept" || candidate.status === "rejected" ? candidate.status : "pending";
  const beforeSha256 = normalizeNullableSha256(candidate.beforeSha256);
  const afterSha256 = normalizeNullableSha256(candidate.afterSha256);
  if (beforeSha256 === undefined || afterSha256 === undefined) {
    return {};
  }
  return { review: { status, beforeSha256, afterSha256, ...optionalStringField("reviewedAt", candidate.reviewedAt) } };
}

function normalizeNullableSha256(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value : undefined;
}

function optionalProviderSessionId(value: unknown): { providerSessionId?: string } {
  const normalized = normalizeRequiredString(value);
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? { providerSessionId: normalized }
    : {};
}

function hasUnsupportedAgentCommandV1Fields(candidate: Record<string, unknown>): boolean {
  return AGENT_COMMAND_UNSUPPORTED_V1_FIELDS.some((field) => field in candidate);
}

function normalizeAgentCommandId(value: unknown, fallback: string): string {
  const trimmed = normalizeRequiredString(value) ?? fallback;
  const normalized = trimmed.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^\.+$/, "-");
  return normalized || fallback;
}

/** Upgrade only the prior built-in Claude default, never an arbitrary command. */
function migrateLegacyDefaultClaudeCommand(candidate: Partial<AgentCommand>, command: string | null): string | null {
  const isBuiltInIdentity = candidate.id === "claude" && candidate.handle === "claude" && candidate.label === "Claude";
  const isOriginalInteractiveDefault = command === "claude" && candidate.promptDelivery === "terminalInputAfterLaunch";
  const isPriorHeadlessDefault = command === "claude -p" &&
    (candidate.promptDelivery === "stdin" || candidate.promptDelivery === undefined) &&
    (candidate.cwdPolicy === "workspace_root" || candidate.cwdPolicy === undefined) &&
    (candidate.version === 1 || candidate.version === undefined);
  const isPriorEditDefault = command === "claude -p --permission-mode acceptEdits" &&
    candidate.adapter === "claude-code" &&
    (candidate.promptDelivery === "stdin" || candidate.promptDelivery === undefined) &&
    (candidate.cwdPolicy === "workspace_root" || candidate.cwdPolicy === undefined) &&
    (candidate.version === 1 || candidate.version === undefined);
  return isBuiltInIdentity && (isOriginalInteractiveDefault || isPriorHeadlessDefault || isPriorEditDefault)
    ? createDefaultClaudeAgentCommand().command
    : command;
}

function normalizeAgentCommandAdapter(
  value: unknown,
  candidate: Partial<AgentCommand> & { command: string },
): AgentCommandAdapter {
  if (value === "claude-code" || value === "codex-cli" || value === "generic") {
    return value;
  }
  const builtInIdentity = candidate.id === candidate.handle && candidate.label === capitalizeBuiltInLabel(candidate.handle);
  if (builtInIdentity && candidate.handle === "claude" && candidate.command === createDefaultClaudeAgentCommand().command) {
    return "claude-code";
  }
  if (builtInIdentity && candidate.handle === "codex" && candidate.command === createDefaultCodexAgentCommand().command) {
    return "codex-cli";
  }
  return "generic";
}

function normalizeCommandContinuityPolicy(
  value: unknown,
  adapter: AgentCommandAdapter,
  candidate: Partial<AgentCommand>,
  command: string,
): InvocationContinuityPolicy {
  if (adapter !== "claude-code") {
    return "fresh";
  }
  if (value === "continuous" || value === "fresh") {
    return value;
  }
  const exactBuiltIn = candidate.id === candidate.handle &&
    candidate.label === capitalizeBuiltInLabel(candidate.handle) &&
    command === createDefaultClaudeAgentCommand().command;
  return exactBuiltIn ? "continuous" : "fresh";
}

function capitalizeBuiltInLabel(handle: unknown): string | null {
  return handle === "claude" ? "Claude" : handle === "codex" ? "Codex" : null;
}

function normalizeAgentCommandCwdPolicy(value: unknown): AgentCommandCwdPolicy {
  return value === "note_dir" || value === "fixed" ? value : "workspace_root";
}

function normalizeAgentCommandPromptDelivery(value: unknown): AgentCommandPromptDelivery {
  return value === "stdin" ? value : DEFAULT_AGENT_COMMAND_PROMPT_DELIVERY;
}

function normalizeConfiguredAgentCommandPromptDelivery(value: unknown): AgentCommandPromptDelivery | null {
  // Earlier builds wrote terminalInputAfterLaunch. Preserve those workspace
  // settings while making stdin the one canonical, headless delivery mode.
  return value === "stdin" || value === "terminalInputAfterLaunch" || value === "auto" || value === undefined
    ? DEFAULT_AGENT_COMMAND_PROMPT_DELIVERY
    : null;
}

function normalizeAgentCommandVersion(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
}

function normalizeInvocationStatus(value: unknown): InvocationStatus {
  if (value === "exited" || value === "process-exited") {
    return "process-exited";
  }
  return value === "pending" ||
    value === "user-ended" ||
    value === "timeout-ended" ||
    value === "failed" ||
    value === "orphaned"
    ? value
    : "running";
}

function normalizeInvocationContext(value: unknown): InvocationContextKind {
  return value === "cli" ? "cli" : "note";
}

function normalizeInvocationMentionProvenance(value: unknown): InvocationMentionProvenance {
  return value === "human-authored" || value === "prior-invocation-authored" ? value : "unknown";
}

function normalizeAttributionStatus(value: unknown): InvocationAttributionStatus {
  return value === "likely" || value === "ambiguous" || value === "unattributed" ? value : "pending";
}

function normalizeAttributionSummary(value: unknown): InvocationAttributionSummary {
  if (!value || typeof value !== "object") {
    return { status: "pending" };
  }
  const candidate = value as Partial<InvocationAttributionSummary>;
  return {
    status: normalizeAttributionStatus(candidate.status),
    ...optionalStringField("reason", candidate.reason),
  };
}

function normalizeChangedFileRefs(value: unknown): InvocationChangedFileRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<InvocationChangedFileRef[]>((refs, entry) => {
    if (!entry || typeof entry !== "object") {
      return refs;
    }
    const candidate = entry as Partial<InvocationChangedFileRef>;
    const filePath = normalizeRequiredString(candidate.path);
    if (!filePath) {
      return refs;
    }
    refs.push({
      path: filePath,
      kind: normalizeChangedFileKind(candidate.kind),
      ...optionalStringField("observedAt", candidate.observedAt),
      attribution: normalizeAttributionStatus(candidate.attribution),
      ...optionalStringField("diffRefId", candidate.diffRefId),
    });
    return refs;
  }, []);
}

function normalizeDiffRefs(value: unknown): InvocationDiffRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<InvocationDiffRef[]>((refs, entry) => {
    if (!entry || typeof entry !== "object") {
      return refs;
    }
    const candidate = entry as Partial<InvocationDiffRef>;
    const id = normalizeRequiredString(candidate.id);
    const filePath = normalizeRequiredString(candidate.path);
    const ref = normalizeRequiredString(candidate.ref);
    if (!id || !filePath || !ref) {
      return refs;
    }
    refs.push({
      id,
      path: filePath,
      format: candidate.format === "json" || candidate.format === "external" ? candidate.format : "unified",
      ref,
    });
    return refs;
  }, []);
}

function normalizeChangedFileKind(value: unknown): InvocationChangedFileRef["kind"] {
  return value === "created" || value === "modified" || value === "deleted" ? value : "unknown";
}

function optionalStringField<Key extends string>(key: Key, value: unknown): { [Property in Key]?: string } {
  const normalized = normalizeRequiredString(value);
  return normalized ? { [key]: normalized } as { [Property in Key]?: string } : {};
}

function optionalIntegerField<Key extends string>(key: Key, value: unknown): { [Property in Key]?: number } {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? { [key]: parsed } as { [Property in Key]?: number } : {};
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAgentCommandString(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  return normalized && !/[\r\n]/.test(normalized) ? normalized : null;
}
