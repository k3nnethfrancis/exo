import type { CapabilityPermission } from "./capabilities";
import type { AgentHarness, HarnessSkillMetadata } from "./agent-harness";
export type {
  ActivityActorRef,
  ActivityArtifactKind,
  ActivityArtifactRef,
  ActivityEvidenceRef,
  ActivityHarnessRef,
  ActivityRecord,
  ActivityRef,
  ActivityReviewRef,
  ActivityReviewState,
  ActivityRoutineRef,
  ActivityScopeRef,
  ActivityStatus,
  ActivityTraceKind,
  ActivityTracePacket,
  RunArtifact,
  RunArtifactKind,
  RunError,
  RunEvaluationMetric,
  RunEvaluationResult,
  RunEvidenceRef,
  RunFileChangeProposal,
  RunRecord,
  RunReviewState,
  RunStatus,
  RunTraceKind,
  RunTracePacket,
} from "./run";

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
