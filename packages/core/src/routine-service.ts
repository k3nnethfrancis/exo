import { readFile } from "node:fs/promises";

import type { AgentHarness } from "./agent-harness";
import type { CapabilityPermission, CapabilitySurface } from "./capabilities";
import { discoverPluginManifests, PluginRegistry } from "./plugin";
import { resolvePluginLocations, splitPluginPathList, type PluginLocation } from "./plugin-locations";
import { RoutineExecutor, type RoutineExecutionHost } from "./routine-executor";
import { RoutineRunStore } from "./routine-run-store";
import { instantiateRoutineTemplate, routineTemplatesFromPlugin, type RoutineInstantiationOptions, type RoutineTemplateDefinition } from "./routine-template";
import { assertRoutineExecutionSupported, missingRequiredHarnessSkills, type RoutineDefinition, type RoutineOutputPolicy } from "./routine";
import type { RunRecord } from "./run";
import type { WorkspaceModel } from "./types";

export type RoutinePluginDirectory = Pick<PluginLocation, "path" | "source"> & Partial<Pick<PluginLocation, "trust" | "enabled">>;

export interface RoutineServiceOptions {
  workspace: WorkspaceModel;
  runtimeRoot: string;
  pluginDirectories?: RoutinePluginDirectory[];
  clock?: () => string;
}

export interface RoutineDryRunResult {
  routine: RoutineDefinition;
  run: RunRecord;
}

export interface RoutineTemplateListOptions {
  includeDisabled?: boolean;
  surface?: CapabilitySurface;
  trustedOnly?: boolean;
}

export interface RoutineAgentPolicyOptions {
  harness?: Pick<AgentHarness, "skills">;
  allowedPermissions?: readonly CapabilityPermission[];
  supportedFileChanges?: readonly RoutineOutputPolicy["fileChanges"][];
  supportedArtifacts?: readonly RoutineOutputPolicy["artifacts"][];
}

export interface RoutineArtifactReadResult {
  run: RunRecord;
  artifactId: string;
  path: string;
  contents: string;
}

export class RoutineService {
  private readonly store: RoutineRunStore;
  private readonly pluginDirectories: RoutinePluginDirectory[];
  private readonly clock: () => string;

  constructor(private readonly options: RoutineServiceOptions) {
    this.store = new RoutineRunStore(options.runtimeRoot);
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async listTemplates(options: RoutineTemplateListOptions = {}): Promise<RoutineTemplateDefinition[]> {
    const {
      includeDisabled = false,
      surface = "cli",
      trustedOnly = true,
    } = options;
    const discovered = (
      await Promise.all(
        this.pluginDirectories.map((directory) =>
          discoverPluginManifests([directory.path], {
            source: directory.source,
            trust: directory.trust,
            enabled: directory.enabled,
          }),
        ),
      )
    ).flat();
    const registry = new PluginRegistry(discovered);
    return registry
      .list({ includeDisabled, trustedOnly })
      .flatMap((plugin) => routineTemplatesFromPlugin(plugin, { includeDisabled, surface }));
  }

  async requireTemplate(templateId: string): Promise<RoutineTemplateDefinition> {
    const template = (await this.listTemplates()).find((candidate) => candidate.id === templateId);
    if (!template) {
      throw new Error(`Routine template not found: ${templateId}`);
    }
    return template;
  }

  listRoutines(): Promise<RoutineDefinition[]> {
    return this.store.listRoutines();
  }

  readRoutine(routineId: string): Promise<RoutineDefinition | null> {
    return this.store.readRoutine(routineId);
  }

  async listRuns(options: { routineId?: string } = {}): Promise<RunRecord[]> {
    const runs = await this.store.listRuns();
    return options.routineId ? runs.filter((run) => run.routineId === options.routineId) : runs;
  }

  async requireRun(runId: string): Promise<RunRecord> {
    const run = await this.store.readRun(runId);
    if (!run) {
      throw new Error(`Routine run not found: ${runId}`);
    }
    return run;
  }

  async readArtifact(runId: string, artifactId: string): Promise<RoutineArtifactReadResult> {
    const run = await this.requireRun(runId);
    const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new Error(`Routine artifact not found: ${artifactId}`);
    }
    return {
      run,
      artifactId,
      path: artifact.path,
      contents: await readFile(artifact.path, "utf8"),
    };
  }

  async createRoutineFromTemplate(templateId: string, options: Omit<RoutineInstantiationOptions, "now">): Promise<RoutineDefinition> {
    const template = await this.requireTemplate(templateId);
    const routine = instantiateRoutineTemplate(template, {
      ...options,
      now: this.clock(),
    });
    await this.store.writeRoutine(routine);
    return routine;
  }

  async runManualDryRun(routineId: string): Promise<RoutineDryRunResult> {
    const routine = await this.store.readRoutine(routineId);
    if (!routine) {
      throw new Error(`Routine not found: ${routineId}`);
    }
    const executor = new RoutineExecutor(this.store, new DryRunRoutineExecutionHost(this.clock), undefined, this.clock);
    const executableRoutine = routine.trigger.kind === "manual" ? routine : { ...routine, trigger: { kind: "manual" as const } };
    const run = await executor.runManual(executableRoutine);
    return { routine, run };
  }

  async runManualWithHost(routineId: string, host: RoutineExecutionHost, policy: RoutineAgentPolicyOptions = {}): Promise<RoutineDryRunResult> {
    const routine = await this.store.readRoutine(routineId);
    if (!routine) {
      throw new Error(`Routine not found: ${routineId}`);
    }
    assertRoutineAgentPolicy(routine, policy);
    const executor = new RoutineExecutor(this.store, host, undefined, this.clock);
    const executableRoutine = routine.trigger.kind === "manual" ? routine : { ...routine, trigger: { kind: "manual" as const } };
    const run = await executor.runManual(executableRoutine);
    return { routine, run };
  }
}

export const DEFAULT_ROUTINE_AGENT_ALLOWED_PERMISSIONS = [
  "workspace:read",
  "notes:read",
  "projects:read",
  "artifacts:write",
] satisfies CapabilityPermission[];

export const DEFAULT_ROUTINE_AGENT_SUPPORTED_FILE_CHANGES = ["none", "propose"] satisfies RoutineOutputPolicy["fileChanges"][];
export const DEFAULT_ROUTINE_AGENT_SUPPORTED_ARTIFACTS = ["none", "record"] satisfies RoutineOutputPolicy["artifacts"][];

export function assertRoutineAgentPolicy(routine: RoutineDefinition, options: RoutineAgentPolicyOptions = {}): void {
  assertRoutineExecutionSupported(routine);
  const allowedPermissions = new Set(options.allowedPermissions ?? DEFAULT_ROUTINE_AGENT_ALLOWED_PERMISSIONS);
  const supportedFileChanges = options.supportedFileChanges ?? DEFAULT_ROUTINE_AGENT_SUPPORTED_FILE_CHANGES;
  const supportedArtifacts = options.supportedArtifacts ?? DEFAULT_ROUTINE_AGENT_SUPPORTED_ARTIFACTS;
  const errors: string[] = [];

  const requiredSkills = routine.requiredSkills.filter((skill) => skill.required);
  if (requiredSkills.length > 0 && !options.harness) {
    errors.push("required harness skill metadata was not provided");
  } else if (options.harness) {
    const missingSkills = missingRequiredHarnessSkills(routine, options.harness);
    if (missingSkills.length > 0) {
      errors.push(`missing required harness skills: ${missingSkills.map((skill) => skill.id).join(", ")}`);
    }
  }

  const disallowedPermissions = routine.permissions.permissions.filter((permission) => !allowedPermissions.has(permission));
  if (disallowedPermissions.length > 0) {
    errors.push(`disallowed permissions: ${disallowedPermissions.join(", ")}`);
  }

  if (!supportedFileChanges.includes(routine.outputPolicy.fileChanges)) {
    errors.push(`unsupported output policy fileChanges=${routine.outputPolicy.fileChanges}`);
  }
  if (!supportedArtifacts.includes(routine.outputPolicy.artifacts)) {
    errors.push(`unsupported output policy artifacts=${routine.outputPolicy.artifacts}`);
  }

  if (errors.length > 0) {
    throw new Error([`Routine agent policy rejected ${routine.id}:`, ...errors.map((error) => `- ${error}`)].join("\n"));
  }
}

export function routinePluginDirectoriesFromEnv(workspaceRoot: string, env: Record<string, string | undefined>): RoutinePluginDirectory[] {
  const explicitOperatorDirectories = splitPluginPathList(env.EXO_PLUGIN_DIRS);
  if (explicitOperatorDirectories.length > 0) {
    // Preserve the historical routine-service behavior: EXO_PLUGIN_DIRS is an
    // operator override for routine discovery, not an additive user plugin path.
    return explicitOperatorDirectories.map((directory) => ({
      path: directory,
      source: "dev",
      trust: "trusted",
      enabled: true,
    }));
  }
  return resolvePluginLocations({ workspaceRoot, env }).map(({ path, source, trust, enabled }) => ({ path, source, trust, enabled }));
}

class DryRunRoutineExecutionHost implements RoutineExecutionHost {
  constructor(private readonly clock: () => string) {}

  async execute(routine: RoutineDefinition, run: RunRecord) {
    const now = this.clock();
    return {
      artifacts: [
        {
          artifact: {
            id: "dry-run-report",
            kind: "report" as const,
            title: "Routine Dry Run",
            mimeType: "text/markdown",
            createdAt: now,
          },
          fileName: "dry-run-report.md",
          contents: [
            "# Routine Dry Run",
            "",
            `- Routine: ${routine.id}`,
            `- Run: ${run.id}`,
            `- Harness: ${routine.harnessId}`,
            `- Trigger: ${routine.trigger.kind}`,
            "",
            "## Prompt",
            "",
            routine.prompt,
            "",
          ].join("\n"),
        },
      ],
      tracePackets: [
        {
          id: "dry-run-start",
          kind: "event" as const,
          timestamp: now,
          actor: "exo.routine-service",
          private: false,
          evidence: [],
          payload: {
            dryRun: true,
            routineId: routine.id,
            harnessId: routine.harnessId,
          },
        },
      ],
    };
  }
}
