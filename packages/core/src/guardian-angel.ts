import type { RoutineDefinition } from "./routine";
import type { RunEvidenceRef } from "./run";

export type GuardianAngelActor = "principal" | "harness" | "candidate" | "reviewer";
export type GuardianAngelTraceKind =
  | "runStarted"
  | "elicitationPrompt"
  | "principalResponse"
  | "candidatePrompt"
  | "candidateResponse"
  | "review"
  | "metric"
  | "export";

export type GuardianAngelRedactionStatus = "privateOnly" | "redacted" | "publicOk";

export type GuardianAngelEvidenceRef = RunEvidenceRef;

export interface GuardianAngelTracePacket {
  id: string;
  runId: string;
  kind: GuardianAngelTraceKind;
  actor: GuardianAngelActor;
  timestamp: string;
  private: boolean;
  redactionStatus: GuardianAngelRedactionStatus;
  evidence: GuardianAngelEvidenceRef[];
  payload: Record<string, unknown>;
}

export interface GuardianAngelStrategicDecisionRecord {
  recordType: "strategicDecision";
  scenarioId: string;
  principalId: string;
  condition: "human";
  chosenAction: string;
  actionDistribution: Record<string, number>;
  confidence: number;
  rationale: string;
  decisionFactors: string[];
  autonomyBoundary: "act" | "ask" | "defer" | "refuse";
  wouldChangeIf?: string;
  privateNotes?: string;
  reviewStatus: GuardianAngelReviewStatus;
}

export interface GuardianAngelCandidateDecisionRecord {
  recordType: "candidateGaDecision";
  scenarioId: string;
  candidateId: string;
  model: string;
  promptRef: string;
  principalProfileRef?: string;
  relationshipPacketRef?: string;
  chosenAction: string;
  actionDistribution: Record<string, number>;
  confidence: number;
  rationale: string;
  autonomyBoundary: "act" | "ask" | "defer" | "refuse";
  rawResponseRef: string;
  reviewStatus: GuardianAngelReviewStatus;
}

export type GuardianAngelReviewStatus = "unreviewed" | "accepted" | "rejected" | "corrected";

export interface GuardianAngelReviewRecord {
  recordType: "review";
  targetRecordId: string;
  reviewer: string;
  status: GuardianAngelReviewStatus;
  redactionStatus: GuardianAngelRedactionStatus;
  notes?: string;
  correction?: string;
  tags: string[];
}

export interface GuardianAngelJsonlExportArtifact {
  kind: "jsonl";
  path: string;
  recordTypes: string[];
  privateByDefault: boolean;
}

export interface GuardianAngelOkfConceptOutput {
  kind: "okfConcept";
  path: string;
  conceptType: string;
  title: string;
  evidence: GuardianAngelEvidenceRef[];
}

export const guardianAngelStrategicAlignmentRoutineExample = {
  id: "routine-guardian-angel-strategic-alignment-v0",
  title: "Guardian Angel Strategic Alignment V0",
  prompt: "Run the relationship-conditioned strategic-alignment pilot and write auditable JSONL artifacts plus a short review report.",
  harnessId: "codex",
  requiredSkills: [
    {
      id: "guardian-angel-strategic-alignment",
      label: "Guardian Angel Strategic Alignment",
      required: true,
    },
  ],
  trigger: { kind: "manual" },
  scope: {
    workspaceRoot: "<workspace>",
    noteRootIds: [],
    projectRootIds: [],
    paths: [".exo/runs/guardian-angel", "notes/projects/guardian-angel"],
  },
  permissions: {
    permissions: ["workspace:read", "notes:read", "projects:read", "artifacts:write"],
  },
  outputPolicy: {
    fileChanges: "propose",
    artifacts: "record",
    allowedPaths: [".exo/runs/guardian-angel", ".exo/artifacts/guardian-angel"],
  },
  enabled: false,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
} satisfies RoutineDefinition;

export function guardianAngelTraceHasEvidence(packet: Pick<GuardianAngelTracePacket, "evidence">): boolean {
  return packet.evidence.length > 0;
}
