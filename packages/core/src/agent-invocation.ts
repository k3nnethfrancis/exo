import { createHash } from "node:crypto";
import path from "node:path";

import { createDefaultClaudeAgentCommand } from "./default-agent-command";
export { createDefaultClaudeAgentCommand } from "./default-agent-command";

// Legacy values remain in the type only so persisted workspaces can normalize
// safely. New commands and normalized records use stdin exclusively.
export const AGENT_COMMAND_PROMPT_DELIVERIES = ["terminalInputAfterLaunch", "stdin", "argv"] as const;
export const DEFAULT_AGENT_COMMAND_PROMPT_DELIVERY: AgentCommandPromptDelivery = "stdin";
export const AGENT_COMMAND_CWD_POLICIES = ["workspace_root", "note_dir", "fixed"] as const;
export const AGENT_COMMAND_UNSUPPORTED_V1_FIELDS = ["env", "template", "promptTemplate"] as const;

export type AgentCommandPromptDelivery = (typeof AGENT_COMMAND_PROMPT_DELIVERIES)[number];
export type AgentCommandCwdPolicy = (typeof AGENT_COMMAND_CWD_POLICIES)[number];

export interface AgentCommand {
  id: string;
  label: string;
  handle: string;
  command: string;
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

export interface InvocationRecord {
  id: string;
  status: InvocationStatus;
  context: InvocationContextKind;
  taggedDocumentPath?: string;
  originalMentionText?: string;
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

  return {
    id,
    label,
    handle,
    command,
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
  documentPath: string;
  mentionText: string;
  message: string;
  frontmatter?: Record<string, unknown>;
  body?: string;
}): string {
  return [
    "You were explicitly invoked from an Exo document.",
    "",
    "Working document:",
    input.documentPath,
    "",
    "Invocation:",
    input.mentionText,
    "",
    "Message:",
    input.message,
    "",
    "Document snapshot at invocation:",
    "--- frontmatter ---",
    JSON.stringify(input.frontmatter ?? {}, null, 2),
    "--- body ---",
    input.body ?? "(The current body was not supplied; read the file from disk.)",
    "--- end snapshot ---",
    "",
    "This is an explicitly authorized Exo work run. Complete the user's request by editing the working document directly; edit other Workspace files only when the request genuinely needs them.",
    "",
    "Do not return a chat-only answer. If the request asks for analysis, an opinion, research, or a plan, write the useful result into the working document in the appropriate place. Preserve the user's voice and existing structure. Exo will observe the resulting file changes and present them as a reviewable diff.",
    "",
    "When the work is complete, print only a concise completion summary for the terminal/session transcript.",
  ].join("\n");
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
    status,
    context,
    ...(taggedDocumentPath ? { taggedDocumentPath } : {}),
    ...(originalMentionText ? { originalMentionText } : {}),
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
    changedFileRefs: normalizeChangedFileRefs(candidate.changedFileRefs),
    diffRefs: normalizeDiffRefs(candidate.diffRefs),
    attribution: normalizeAttributionSummary(candidate.attribution),
    ...optionalReviewSummary(candidate.review),
  };
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
  return isBuiltInIdentity && (isOriginalInteractiveDefault || isPriorHeadlessDefault)
    ? createDefaultClaudeAgentCommand().command
    : command;
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
