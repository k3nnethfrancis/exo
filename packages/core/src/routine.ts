import type { CapabilityPermission } from "./capabilities";
import type { AgentHarness, HarnessSkillMetadata } from "./agent-harness";

export type RoutineTrigger =
  | { kind: "manual" }
  | { kind: "schedule"; schedule: string; timezone?: string };

export interface RoutineScope {
  workspaceRoot: string;
  noteRootIds: string[];
  projectRootIds: string[];
  paths: string[];
}

export interface HarnessSkillRequirement {
  id: string;
  label?: string;
  required: boolean;
}

export interface RoutinePermissionSet {
  permissions: CapabilityPermission[];
}

export interface RoutineOutputPolicy {
  fileChanges: "none" | "propose" | "apply";
  artifacts: "none" | "record";
  allowedPaths: string[];
}

export interface RoutineDefinition {
  id: string;
  title: string;
  prompt: string;
  harnessId: string;
  requiredSkills: HarnessSkillRequirement[];
  trigger: RoutineTrigger;
  scope: RoutineScope;
  permissions: RoutinePermissionSet;
  outputPolicy: RoutineOutputPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needsReview";
export type RunReviewState = "notRequired" | "pending" | "accepted" | "rejected" | "corrected";
export type RunArtifactKind = "transcript" | "log" | "fileChange" | "jsonl" | "report" | "trace" | "dataset" | "other";

export interface RunArtifact {
  id: string;
  runId: string;
  kind: RunArtifactKind;
  path: string;
  title?: string;
  mimeType?: string;
  createdAt: string;
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
  errors: RunError[];
}

export function missingRequiredHarnessSkills(
  routine: Pick<RoutineDefinition, "requiredSkills">,
  harness: Pick<AgentHarness, "skills">,
): HarnessSkillRequirement[] {
  const enabledSkillIds = new Set(harness.skills.filter(isEnabledSkill).map((skill) => skill.id));
  return routine.requiredSkills.filter((skill) => skill.required && !enabledSkillIds.has(skill.id));
}

function isEnabledSkill(skill: HarnessSkillMetadata): boolean {
  return skill.enabled;
}
