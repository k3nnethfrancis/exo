export type EditorFaultMode = "markdown-live" | "markdown-raw" | "code" | "empty";

/**
 * The renderer can fail while React is still healthy. Keep the resulting
 * report deliberately structural: diagnostics may identify the editor state,
 * but must never copy note text into Exo's durable application log.
 */
export interface EditorFaultContext {
  notePath: string | null;
  mode: EditorFaultMode;
  selection: { anchor: number; head: number } | null;
  agentHandle: string | null;
}

export interface EditorFaultDiagnostic extends EditorFaultContext {
  kind: "editor-render-fault";
  occurredAt: string;
  /** A stable, content-free grouping key for the original JavaScript error. */
  errorSignature: string;
}

export function createEditorFaultDiagnostic(
  context: EditorFaultContext,
  error: unknown,
  occurredAt = new Date().toISOString(),
): EditorFaultDiagnostic {
  return {
    kind: "editor-render-fault",
    occurredAt,
    notePath: context.notePath,
    mode: context.mode,
    selection: context.selection,
    agentHandle: context.agentHandle,
    errorSignature: errorSignature(error),
  };
}

function errorSignature(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return `${safeToken(name)}:${fnv1a(message)}`;
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "unknown";
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
