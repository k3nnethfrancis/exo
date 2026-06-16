import path from "node:path";
import { readFile } from "node:fs/promises";

import { discoverPluginManifests, PluginRegistry, type PluginSource, type PluginTrustState } from "./plugin";
import { RoutineExecutor, type RoutineExecutionHost } from "./routine-executor";
import { RoutineRunStore } from "./routine-run-store";
import { instantiateRoutineTemplate, routineTemplatesFromPlugin, type RoutineInstantiationOptions, type RoutineTemplateDefinition } from "./routine-template";
import type { RoutineDefinition } from "./routine";
import type { RunRecord } from "./run";
import type { WorkspaceModel } from "./types";

export interface RoutinePluginDirectory {
  path: string;
  source: PluginSource;
  trust?: PluginTrustState;
}

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

  async listTemplates(): Promise<RoutineTemplateDefinition[]> {
    const discovered = (
      await Promise.all(
        this.pluginDirectories.map((directory) =>
          discoverPluginManifests([directory.path], {
            source: directory.source,
            trust: directory.trust,
          }),
        ),
      )
    ).flat();
    const registry = new PluginRegistry(discovered);
    return registry.list().flatMap((plugin) => routineTemplatesFromPlugin(plugin));
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
}

export function routinePluginDirectoriesFromEnv(workspaceRoot: string, env: Record<string, string | undefined>): RoutinePluginDirectory[] {
  const explicit = splitPathList(env.EXO_PLUGIN_DIRS);
  if (explicit.length > 0) {
    return explicit.map((directory) => ({ path: directory, source: "dev", trust: "trusted" }));
  }

  return [
    ...splitPathList(env.EXO_DEV_PLUGIN_DIRS).map((directory): RoutinePluginDirectory => ({ path: directory, source: "dev", trust: "trusted" })),
    ...(env.EXO_PROJECT_ROOT ? [{ path: path.join(env.EXO_PROJECT_ROOT, "plugins"), source: "dev" as const, trust: "trusted" as const }] : []),
    ...(env.EXO_USER_DATA_PATH ? [{ path: path.join(env.EXO_USER_DATA_PATH, "plugins"), source: "user" as const }] : []),
    { path: path.join(workspaceRoot, ".exo", "plugins"), source: "workspace" },
  ];
}

function splitPathList(rawValue: string | undefined): string[] {
  return rawValue?.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry)) ?? [];
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
