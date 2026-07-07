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
  RunEvidenceRef,
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

export type RoutineExecution =
  | { kind: "agentPrompt"; prompt: string; harnessId: string }
  | { kind: "shellCommand"; command: string; args?: string[]; cwd?: string };

export interface RoutineDefinition {
  id: string;
  title: string;
  prompt: string;
  harnessId: string;
  execution: RoutineExecution;
  requiredSkills: HarnessSkillRequirement[];
  trigger: RoutineTrigger;
  scope: RoutineScope;
  permissions: RoutinePermissionSet;
  outputPolicy: RoutineOutputPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function normalizeRoutineDefinition(routine: RoutineDefinition | (Omit<RoutineDefinition, "execution"> & { execution?: unknown })): RoutineDefinition {
  if (isRecord(routine.execution)) {
    if (routine.execution.kind === "agentPrompt") {
      const prompt = typeof routine.execution.prompt === "string" && routine.execution.prompt.trim().length > 0
        ? routine.execution.prompt
        : routine.prompt;
      const harnessId = typeof routine.execution.harnessId === "string" && routine.execution.harnessId.trim().length > 0
        ? routine.execution.harnessId
        : routine.harnessId;
      return {
        ...routine,
        prompt,
        harnessId,
        execution: { kind: "agentPrompt", prompt, harnessId },
      };
    }
    if (routine.execution.kind === "shellCommand") {
      const command = typeof routine.execution.command === "string" ? routine.execution.command : "";
      const args = Array.isArray(routine.execution.args) && routine.execution.args.every((value) => typeof value === "string")
        ? routine.execution.args
        : undefined;
      const cwd = typeof routine.execution.cwd === "string" ? routine.execution.cwd : undefined;
      return {
        ...routine,
        execution: args || cwd ? { kind: "shellCommand", command, args, cwd } : { kind: "shellCommand", command },
      };
    }
  }
  return {
    ...routine,
    execution: { kind: "agentPrompt", prompt: routine.prompt, harnessId: routine.harnessId },
  };
}

export function assertRoutineExecutionSupported(routine: RoutineDefinition): void {
  if (routine.execution.kind !== "agentPrompt") {
    throw new Error(`Routine execution kind is not supported yet: ${routine.execution.kind}`);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
