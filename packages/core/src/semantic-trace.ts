import type { ActivityEvidenceRef, ActivityTraceKind, ActivityTracePacket } from "./run";

export type SemanticTraceSchemaVersion = "exo.semantic-trace.v1";

export type SemanticTraceEventKind =
  | "session.started"
  | "session.ended"
  | "turn.started"
  | "turn.ended"
  | "message"
  | "tool.call"
  | "tool.result"
  | "lifecycle"
  | "harness.raw"
  | "file.change"
  | "artifact"
  | "metric"
  | "error";

export type SemanticTraceVisibility = "public" | "private" | "redacted";

export type SemanticTraceActorKind = "human" | "agent" | "harness" | "tool" | "plugin" | "system";

export interface SemanticTraceActor {
  id: string;
  kind: SemanticTraceActorKind;
  label?: string;
}

export interface SemanticTraceFileRef {
  path: string;
  action?: "read" | "write" | "create" | "delete" | "move" | "unknown";
  contentHash?: string;
  line?: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticTraceToolRef {
  id?: string;
  name: string;
  callId?: string;
  status?: "started" | "succeeded" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
}

export interface SemanticTraceRefs {
  transcript?: { path: string; offset?: number; length?: number };
  artifacts?: Array<{ id: string; path: string; kind?: string }>;
  files?: SemanticTraceFileRef[];
  tools?: SemanticTraceToolRef[];
  evidence?: ActivityEvidenceRef[];
}

export interface SemanticTraceEvent {
  schemaVersion: SemanticTraceSchemaVersion;
  id: string;
  activityId?: string;
  runId?: string;
  sessionId?: string;
  harnessId: string;
  sequence?: number;
  timestamp: string;
  kind: SemanticTraceEventKind;
  actor: SemanticTraceActor;
  visibility: SemanticTraceVisibility;
  parentId?: string;
  correlationId?: string;
  refs?: SemanticTraceRefs;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type SemanticTraceInput = Omit<SemanticTraceEvent, "schemaVersion" | "payload" | "visibility"> & {
  schemaVersion?: SemanticTraceSchemaVersion;
  payload?: Record<string, unknown>;
  visibility?: SemanticTraceVisibility;
};

export function normalizeSemanticTraceEvent(input: SemanticTraceInput): SemanticTraceEvent {
  if (!input.id.trim()) {
    throw new Error("Semantic trace event id must be non-empty.");
  }
  if (!input.harnessId.trim()) {
    throw new Error("Semantic trace event harnessId must be non-empty.");
  }
  if (!input.actor.id.trim()) {
    throw new Error("Semantic trace event actor id must be non-empty.");
  }
  return {
    ...input,
    schemaVersion: input.schemaVersion ?? "exo.semantic-trace.v1",
    visibility: input.visibility ?? "private",
    payload: input.payload ?? {},
  };
}

export function semanticTraceEventToActivityTracePacket(event: SemanticTraceEvent): ActivityTracePacket {
  const activityId = event.activityId ?? event.runId;
  if (!activityId) {
    throw new Error("Semantic trace event requires activityId before conversion to ActivityTracePacket.");
  }
  return {
    id: event.id,
    activityId,
    kind: activityTraceKindForSemanticTrace(event.kind),
    timestamp: event.timestamp,
    actor: event.actor.id,
    private: event.visibility !== "public",
    evidence: event.refs?.evidence ?? [],
    payload: {
      schemaVersion: event.schemaVersion,
      semanticKind: event.kind,
      harnessId: event.harnessId,
      sessionId: event.sessionId,
      sequence: event.sequence,
      parentId: event.parentId,
      correlationId: event.correlationId,
      refs: event.refs,
      actor: event.actor,
      payload: event.payload,
    },
    metadata: event.metadata,
  };
}

export function semanticTraceEventsToAgentAnswerText(events: readonly SemanticTraceEvent[]): string {
  return events
    .filter((event) => event.kind === "message" && event.actor.kind === "agent")
    .map((event) => event.payload.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
}

function activityTraceKindForSemanticTrace(kind: SemanticTraceEventKind): ActivityTraceKind {
  if (kind === "message") {
    return "message";
  }
  if (kind === "tool.call" || kind === "tool.result") {
    return "toolCall";
  }
  if (kind === "metric") {
    return "metric";
  }
  if (kind === "error") {
    return "error";
  }
  return "event";
}
