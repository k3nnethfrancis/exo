export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needsReview";
export type RunReviewState = "notRequired" | "pending" | "accepted" | "rejected" | "corrected";

export type RunArtifactKind =
  | "transcript"
  | "log"
  | "fileChange"
  | "jsonl"
  | "report"
  | "trace"
  | "dataset"
  | "evaluation"
  | "other";

export type RunTraceKind = "event" | "message" | "toolCall" | "observation" | "decision" | "metric" | "error";

export interface RunEvidenceRef {
  id: string;
  kind: "markdown" | "okfConcept" | "runArtifact" | "external";
  path?: string;
  uri?: string;
  contentHash?: string;
  note?: string;
}

export interface RunArtifact {
  id: string;
  runId: string;
  kind: RunArtifactKind;
  path: string;
  title?: string;
  mimeType?: string;
  sourceCapabilityId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RunFileChangeProposal {
  id: string;
  runId: string;
  path: string;
  action: "create" | "update" | "delete" | "move";
  status: "proposed" | "accepted" | "rejected" | "applied";
  title?: string;
  diffPath?: string;
  fromPath?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RunTracePacket {
  id: string;
  runId: string;
  kind: RunTraceKind;
  timestamp: string;
  actor: string;
  private: boolean;
  evidence: RunEvidenceRef[];
  payload: Record<string, unknown>;
}

export interface RunEvaluationMetric {
  name: string;
  value: number | string | boolean;
  unit?: string;
  higherIsBetter?: boolean;
}

export interface RunEvaluationResult {
  id: string;
  runId: string;
  evaluatorId: string;
  status: "passed" | "failed" | "warning" | "skipped";
  metrics: RunEvaluationMetric[];
  artifactIds: string[];
  createdAt: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface RunError {
  message: string;
  code?: string;
  detail?: string;
}

export interface RunRecord {
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
  fileChangeProposals?: RunFileChangeProposal[];
  tracePackets?: RunTracePacket[];
  evaluationResults?: RunEvaluationResult[];
  errors: RunError[];
}

export function runHasPendingReview(run: Pick<RunRecord, "reviewState" | "status">): boolean {
  return run.reviewState === "pending" || run.status === "needsReview";
}

export function runArtifactPaths(run: Pick<RunRecord, "artifacts">, kind?: RunArtifactKind): string[] {
  return run.artifacts.filter((artifact) => !kind || artifact.kind === kind).map((artifact) => artifact.path);
}

export function runTraceHasEvidence(packet: Pick<RunTracePacket, "evidence">): boolean {
  return packet.evidence.length > 0;
}
