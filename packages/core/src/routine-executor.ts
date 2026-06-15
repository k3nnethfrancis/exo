import type { RoutineDefinition } from "./routine";
import type { RunArtifact, RunRecord, RunTracePacket } from "./run";
import { runHasPendingReview } from "./run";
import type { RoutineRunStore } from "./routine-run-store";

export interface RoutineRunIdFactory {
  createRunId(routine: RoutineDefinition): string;
}

export interface RoutineExecutionArtifact {
  artifact: Omit<RunArtifact, "runId" | "path"> & { path?: string };
  contents: string | Uint8Array;
  fileName?: string;
}

export interface RoutineExecutionResult {
  transcriptPath?: string;
  logPath?: string;
  artifacts?: RoutineExecutionArtifact[];
  tracePackets?: Array<Omit<RunTracePacket, "runId"> & { runId?: string }>;
  proposedFileChanges?: string[];
  errors?: Array<{ message: string; code?: string; detail?: string }>;
  needsReview?: boolean;
}

export interface RoutineExecutionHost {
  execute(routine: RoutineDefinition, run: RunRecord): Promise<RoutineExecutionResult>;
}

export class RoutineExecutor {
  constructor(
    private readonly store: RoutineRunStore,
    private readonly host: RoutineExecutionHost,
    private readonly ids: RoutineRunIdFactory = new TimestampRoutineRunIdFactory(),
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async runManual(routine: RoutineDefinition): Promise<RunRecord> {
    if (!routine.enabled) {
      throw new Error(`Routine is disabled: ${routine.id}`);
    }
    if (routine.trigger.kind !== "manual") {
      throw new Error(`Routine is not manual-triggered: ${routine.id}`);
    }

    const startedAt = this.clock();
    const queued: RunRecord = {
      id: this.ids.createRunId(routine),
      routineId: routine.id,
      harnessId: routine.harnessId,
      status: "running",
      reviewState: "notRequired",
      startedAt,
      artifacts: [],
      proposedFileChanges: [],
      errors: [],
    };
    await this.store.writeRun(queued);

    try {
      const result = await this.host.execute(routine, queued);
      for (const artifact of result.artifacts ?? []) {
        await this.store.writeArtifact(queued.id, artifact.artifact, artifact.contents, artifact.fileName);
      }
      for (const packet of result.tracePackets ?? []) {
        await this.store.appendTrace(queued.id, packet);
      }
      const withOutputs = await this.store.updateRun(queued.id, (run) => ({
        ...run,
        transcriptPath: result.transcriptPath ?? run.transcriptPath,
        logPath: result.logPath ?? run.logPath,
        proposedFileChanges: result.proposedFileChanges ?? run.proposedFileChanges,
        errors: result.errors ?? run.errors,
        status: result.needsReview ? "needsReview" : result.errors && result.errors.length > 0 ? "failed" : "succeeded",
        reviewState: result.needsReview ? "pending" : run.reviewState,
        completedAt: this.clock(),
      }));
      return withOutputs;
    } catch (error) {
      return this.store.updateRun(queued.id, (run) => ({
        ...run,
        status: "failed",
        reviewState: runHasPendingReview(run) ? run.reviewState : "notRequired",
        completedAt: this.clock(),
        errors: [
          ...run.errors,
          {
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      }));
    }
  }
}

export class TimestampRoutineRunIdFactory implements RoutineRunIdFactory {
  createRunId(routine: RoutineDefinition): string {
    return `${routine.id}-${new Date().toISOString().replace(/[^0-9A-Za-z_.-]/g, "-")}`;
  }
}
