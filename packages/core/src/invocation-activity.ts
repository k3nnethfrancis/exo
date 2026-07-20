import path from "node:path";

export const INVOCATION_ACTIVITY_KINDS = [
  "working",
  "reading",
  "searching",
  "editing",
  "running",
  "finishing",
] as const;

export type InvocationActivityKind = (typeof INVOCATION_ACTIVITY_KINDS)[number];

/** A bounded status fact. Raw provider text and model reasoning never cross this boundary. */
export interface InvocationActivityEvent {
  invocationId: string;
  kind: InvocationActivityKind;
  emittedAt: string;
  label?: string;
}

/**
 * Activity labels may contain only one short, control-free basename. Provider
 * prose is not an activity label and should be discarded by the adapter.
 */
export function invocationActivityLabel(value: unknown, maxLength = 72): string | null {
  if (typeof value !== "string") return null;
  const withoutAnsi = value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  const normalized = withoutAnsi
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const basename = path.basename(normalized.replaceAll("\\", "/"));
  if (!basename || basename === "." || basename === "/") return null;
  if (basename.length <= maxLength) return basename;
  const extension = path.extname(basename);
  const stemLength = Math.max(1, maxLength - extension.length - 1);
  return `${basename.slice(0, stemLength)}…${extension}`;
}

export function isInvocationActivityKind(value: unknown): value is InvocationActivityKind {
  return typeof value === "string" && INVOCATION_ACTIVITY_KINDS.includes(value as InvocationActivityKind);
}
