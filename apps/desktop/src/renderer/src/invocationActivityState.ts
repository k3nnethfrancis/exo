import {
  type AgentCommand,
  type InvocationRecord,
} from "@exo/core";
import {
  invocationActivityLabel,
  type InvocationActivityEvent,
} from "@exo/core/invocation-activity";

import type { InvocationActivityKind as InvocationSurfaceKind } from "./components/invocation";

export interface InvocationActivityState {
  invocationId: string | null;
  kind: InvocationSurfaceKind;
  commandHandle: string;
  commandLabel: string;
  label?: string;
  errorDetail?: string;
  providerSessionId?: string;
}

const INVOCATION_ERROR_DETAIL_LIMIT = 180;

export function beginInvocationActivity(command: Pick<AgentCommand, "handle" | "label">): InvocationActivityState {
  return {
    invocationId: null,
    kind: "working",
    commandHandle: command.handle,
    commandLabel: command.label,
  };
}

/** A synchronous, truthful acknowledgement while Exo checks launch authority. */
export function acknowledgeInvocationActivity(
  command: Pick<AgentCommand, "handle" | "label">,
): InvocationActivityState {
  return {
    invocationId: null,
    kind: "checking",
    commandHandle: command.handle,
    commandLabel: command.label,
  };
}

export function failInvocationActivity(
  command: Pick<AgentCommand, "handle" | "label">,
  error?: unknown,
): InvocationActivityState {
  return {
    invocationId: null,
    kind: "failed",
    commandHandle: command.handle,
    commandLabel: command.label,
    errorDetail: boundedInvocationErrorDetail(error),
  };
}

export function failActiveInvocationActivity(
  current: InvocationActivityState | null,
  error?: unknown,
): InvocationActivityState | null {
  if (!current) return null;
  return {
    ...current,
    kind: "failed",
    label: undefined,
    errorDetail: boundedInvocationErrorDetail(error),
  };
}

export function applyInvocationActivityEvent(
  current: InvocationActivityState | null,
  event: InvocationActivityEvent,
): InvocationActivityState | null {
  if (!current || current.kind === "done" || current.kind === "failed") return current;
  if (current.invocationId && current.invocationId !== event.invocationId) return current;
  const label = invocationActivityLabel(event.label);
  return {
    ...current,
    invocationId: event.invocationId,
    kind: event.kind,
    errorDetail: undefined,
    ...(label ? { label } : { label: undefined }),
  };
}

export function applyInvocationRecord(
  current: InvocationActivityState | null,
  record: InvocationRecord,
): InvocationActivityState {
  if (current?.invocationId && current.invocationId !== record.id) return current;
  const sameInvocation = current?.invocationId === null || current?.invocationId === record.id;
  const activeKind = sameInvocation && current && current.kind !== "done" && current.kind !== "failed"
    ? current.kind
    : "working";
  const kind: InvocationSurfaceKind = record.status === "failed" || record.status === "orphaned"
    ? "failed"
    : record.status === "pending" || record.status === "running"
      ? activeKind
      : "done";
  return {
    invocationId: record.id,
    kind,
    commandHandle: record.command.handle,
    commandLabel: record.command.label,
    ...(kind === "failed" ? { errorDetail: boundedInvocationErrorDetail(record.failureReason) } : {}),
    ...(kind === activeKind && current?.label ? { label: current.label } : {}),
    ...(record.providerSessionId ? { providerSessionId: record.providerSessionId } : {}),
  };
}

/** Keep provider failures useful without turning the activity shell into a log viewer. */
export function boundedInvocationErrorDetail(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "The invocation could not finish.";
  const normalized = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/(^|[\s(\"'=])\/(?:[^\s\"'<>()[\]{}]+\/?)+/g, "$1this folder")
    .replace(/\s+/g, " ")
    .trim() || "The invocation could not finish.";
  return normalized.length <= INVOCATION_ERROR_DETAIL_LIMIT
    ? normalized
    : `${normalized.slice(0, INVOCATION_ERROR_DETAIL_LIMIT - 1).trimEnd()}…`;
}

export function invocationCommandPresentation(
  handle: string,
  commands: readonly AgentCommand[],
): Pick<AgentCommand, "handle" | "label"> {
  const configured = commands.find((command) => command.handle === handle);
  return configured
    ? { handle: configured.handle, label: configured.label }
    : { handle, label: handle.charAt(0).toUpperCase() + handle.slice(1) };
}
