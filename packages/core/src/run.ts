export type ActivityStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needsReview";
export type RunStatus = ActivityStatus;

export type ActivityReviewState = "notRequired" | "pending" | "accepted" | "rejected" | "corrected";
export type RunReviewState = ActivityReviewState;

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
export type RunArtifactKind = ActivityArtifactKind;

export type ActivityTraceKind = "event" | "message" | "toolCall" | "observation" | "decision" | "metric" | "error";
export type RunTraceKind = ActivityTraceKind;

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

export interface ActivityRoutineRef {
  id: string;
  templateId?: string;
  pluginId?: string;
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

export interface RunEvidenceRef extends ActivityEvidenceRef {}

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

export interface RunArtifact extends ActivityArtifactRef {
  runId: string;
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

export interface RunTracePacket extends Omit<ActivityTracePacket, "evidence"> {
  runId: string;
  evidence: RunEvidenceRef[];
}

export interface RunError {
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
  routine?: ActivityRoutineRef;
  scope?: ActivityScopeRef;
  artifacts: TArtifact[];
  transcriptRef?: ActivityRef;
  logRef?: ActivityRef;
  provenanceRefs?: ActivityRef[];
  reviewRef?: ActivityReviewRef;
  errors: RunError[];
  metadata?: Record<string, unknown>;
  pluginMetadata?: Record<string, unknown>;
}

export interface RunRecord extends ActivityRecord<RunArtifact> {
  id: string;
  routineId: string;
  harnessId: string;
  status: RunStatus;
  reviewState: RunReviewState;
  startedAt?: string;
  completedAt?: string;
  transcriptPath?: string;
  logPath?: string;
  artifacts: RunArtifact[];
  proposedFileChanges: string[];
  errors: RunError[];
}

export function activityHasPendingReview(activity: Pick<ActivityRecord, "reviewRef" | "reviewState" | "status">): boolean {
  return activity.reviewState === "pending" || activity.reviewRef?.state === "pending" || activity.status === "needsReview";
}

export function runHasPendingReview(run: Pick<RunRecord, "reviewState" | "status">): boolean {
  return activityHasPendingReview(run);
}

export function activityArtifactPaths(activity: Pick<ActivityRecord, "artifacts">, kind?: ActivityArtifactKind): string[] {
  return activity.artifacts.filter((artifact) => !kind || artifact.kind === kind).map((artifact) => artifact.path);
}

export function runArtifactPaths(run: Pick<RunRecord, "artifacts">, kind?: RunArtifactKind): string[] {
  return activityArtifactPaths(run, kind);
}

export function activityTraceHasEvidence(packet: Pick<ActivityTracePacket, "evidence">): boolean {
  return packet.evidence.length > 0;
}

export function runTraceHasEvidence(packet: Pick<RunTracePacket, "evidence">): boolean {
  return activityTraceHasEvidence(packet);
}

export function runToActivityRecord(run: RunRecord): ActivityRecord<RunArtifact> {
  return {
    ...run,
    activityType: run.activityType ?? "routine.run",
    actor: run.actor ?? { id: run.routineId, kind: "plugin" },
    harness: run.harness ?? { id: run.harnessId },
    routine: run.routine ?? { id: run.routineId },
    transcriptRef: run.transcriptRef ?? (run.transcriptPath ? { id: "transcript", path: run.transcriptPath } : undefined),
    logRef: run.logRef ?? (run.logPath ? { id: "log", path: run.logPath } : undefined),
    reviewRef: run.reviewRef ?? { state: run.reviewState },
  };
}

export function activityToRunRecord(activity: ActivityRecord, defaults: { routineId?: string; harnessId?: string } = {}): RunRecord {
  const routineId = stringFromUnknown((activity as Partial<RunRecord>).routineId) ?? activity.routine?.id ?? defaults.routineId ?? activity.id;
  const harnessId = stringFromUnknown((activity as Partial<RunRecord>).harnessId) ?? activity.harness?.id ?? defaults.harnessId ?? "unknown";
  const reviewState = (activity as Partial<RunRecord>).reviewState ?? activity.reviewRef?.state ?? "notRequired";
  const transcriptPath = stringFromUnknown((activity as Partial<RunRecord>).transcriptPath) ?? activity.transcriptRef?.path;
  const logPath = stringFromUnknown((activity as Partial<RunRecord>).logPath) ?? activity.logRef?.path;
  const legacyProposedFileChanges = (activity as Partial<RunRecord>).proposedFileChanges;

  const run: RunRecord = {
    ...activity,
    id: activity.id,
    routineId,
    harnessId,
    status: activity.status,
    reviewState,
    artifacts: activity.artifacts.map((artifact) => ({
      ...artifact,
      runId: stringFromUnknown((artifact as Partial<RunArtifact>).runId) ?? artifact.activityId ?? activity.id,
    })),
    proposedFileChanges: Array.isArray(legacyProposedFileChanges) ? legacyProposedFileChanges : [],
    errors: activity.errors ?? [],
  };
  if (transcriptPath) {
    run.transcriptPath = transcriptPath;
  }
  if (logPath) {
    run.logPath = logPath;
  }
  return run;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
