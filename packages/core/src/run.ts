export type ActivityStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needsReview";

export type ActivityReviewState = "notRequired" | "pending" | "accepted" | "rejected" | "corrected";

/**
 * Core owns only references to activity outputs. Plugin-owned trace, eval,
 * export, and review schemas should live behind these artifact refs, usually
 * as files under `.exo/artifacts/{activityId}/`.
 */
export type ActivityArtifactKind =
  | "transcript"
  | "log"
  | "fileChange"
  | "jsonl"
  | "report"
  | "trace"
  | "dataset"
  | "evaluation"
  | "other";

export type ActivityTraceKind = "event" | "message" | "toolCall" | "observation" | "decision" | "metric" | "error";

export interface ActivityRef {
  id: string;
  path?: string;
  uri?: string;
  title?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityActorRef {
  id: string;
  kind: "human" | "agent" | "harness" | "plugin" | "system";
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityHarnessRef {
  id: string;
  sessionId?: string;
  capabilityId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityScopeRef {
  workspaceRoot?: string;
  noteRootIds?: string[];
  projectRootIds?: string[];
  paths?: string[];
  metadata?: Record<string, unknown>;
}

export interface ActivityReviewRef {
  id?: string;
  state: ActivityReviewState;
  path?: string;
  artifactIds?: string[];
  decidedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityEvidenceRef {
  id: string;
  kind: "markdown" | "okfConcept" | "runArtifact" | "external";
  path?: string;
  uri?: string;
  contentHash?: string;
  note?: string;
}

export interface ActivityArtifactRef {
  id: string;
  activityId?: string;
  kind: ActivityArtifactKind;
  path: string;
  title?: string;
  mimeType?: string;
  sourceCapabilityId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityTracePacket {
  id: string;
  activityId?: string;
  kind: ActivityTraceKind;
  timestamp: string;
  actor: string;
  private: boolean;
  evidence: ActivityEvidenceRef[];
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ActivityError {
  message: string;
  code?: string;
  detail?: string;
}

export interface ActivityRecord<TArtifact extends ActivityArtifactRef = ActivityArtifactRef> {
  id: string;
  activityType?: string;
  status: ActivityStatus;
  reviewState?: ActivityReviewState;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  actor?: ActivityActorRef;
  harness?: ActivityHarnessRef;
  scope?: ActivityScopeRef;
  artifacts: TArtifact[];
  transcriptRef?: ActivityRef;
  logRef?: ActivityRef;
  provenanceRefs?: ActivityRef[];
  reviewRef?: ActivityReviewRef;
  errors: ActivityError[];
  metadata?: Record<string, unknown>;
  pluginMetadata?: Record<string, unknown>;
}

export function activityHasPendingReview(activity: Pick<ActivityRecord, "reviewRef" | "reviewState" | "status">): boolean {
  return activity.reviewState === "pending" || activity.reviewRef?.state === "pending" || activity.status === "needsReview";
}

export function activityArtifactPaths(activity: Pick<ActivityRecord, "artifacts">, kind?: ActivityArtifactKind): string[] {
  return activity.artifacts.filter((artifact) => !kind || artifact.kind === kind).map((artifact) => artifact.path);
}

export function activityTraceHasEvidence(packet: Pick<ActivityTracePacket, "evidence">): boolean {
  return packet.evidence.length > 0;
}
