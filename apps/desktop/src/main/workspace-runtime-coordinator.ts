import type { WorkspaceModel, WorkspaceSettings, WorkspaceSettingsRevision } from "@exo/core";

export interface ActiveWorkspaceRuntime {
  settings: WorkspaceSettings;
  revision: WorkspaceSettingsRevision;
  model: WorkspaceModel;
  runtimeRoot: string;
}

interface WorkspaceRuntimeCandidate extends ActiveWorkspaceRuntime {
  generation: number;
}

export interface WorkspaceActivationRequest {
  previousSettings: WorkspaceSettings;
  settings: WorkspaceSettings;
  revision: WorkspaceSettingsRevision;
  reason: "startup" | "settings-apply" | "workspace-switch";
}

export type WorkspaceActivationPhase =
  | "recovery"
  | "note-roots"
  | "command-server"
  | "watcher"
  | "post-commit";

export type WorkspaceActivationOutcome =
  | { status: "applied"; active: ActiveWorkspaceRuntime }
  | { status: "committed-degraded"; active: ActiveWorkspaceRuntime; errorMessage: string }
  | { status: "superseded" }
  | {
    status: "failed";
    phase: WorkspaceActivationPhase;
    errorMessage: string;
    active: ActiveWorkspaceRuntime | null;
  };

export interface WorkspaceRuntimeStatus {
  status: "active" | "degraded";
  active: ActiveWorkspaceRuntime | null;
  errorMessage?: string;
  phase?: WorkspaceActivationPhase;
}

export interface StagedCommandServer {
  /**
   * Atomically makes the pre-started server discoverable. This must stay
   * synchronous: the coordinator commits active Workspace fields in the same
   * event-loop turn, so no command request can observe candidate discovery
   * while handlers still read the previous active scope.
   */
  commit(): void;
  abort(): Promise<void>;
}

export interface StagedWorkspaceWatcher {
  commit(): void;
  abort(): void;
}

export interface WorkspaceRuntimeCoordinatorOptions {
  runtimeRootFor(settings: WorkspaceSettings): string;
  recoverInvocations(candidate: Readonly<WorkspaceRuntimeCandidate>): Promise<void>;
  modelFromSettings(settings: WorkspaceSettings): WorkspaceModel;
  prepareNoteRoots(candidate: Readonly<WorkspaceRuntimeCandidate>): Promise<void>;
  stageCommandServer(candidate: Readonly<WorkspaceRuntimeCandidate>): Promise<StagedCommandServer>;
  stageWatcher(candidate: Readonly<WorkspaceRuntimeCandidate>): Promise<StagedWorkspaceWatcher>;
  /** These final-commit callbacks are synchronous and failure-free by contract. */
  invalidateDerivedState(candidate: Readonly<WorkspaceRuntimeCandidate>): void;
  setTerminalDefaultCwd(candidate: Readonly<WorkspaceRuntimeCandidate>): void;
  reconcileIndex(previous: WorkspaceSettings, candidate: Readonly<WorkspaceRuntimeCandidate>, reason: WorkspaceActivationRequest["reason"]): void;
  /** Synchronous composition-root assignment; it must not acquire resources. */
  publishActive(active: ActiveWorkspaceRuntime): void;
}

/**
 * Owns the active-Workspace transaction in the Electron main process.
 *
 * A candidate scope is immutable and never publicly visible. Its generation
 * rejects stale async completions; only the final commit changes the active
 * Workspace that collaborators and renderer-facing handlers can observe.
 */
export class WorkspaceRuntimeCoordinator {
  private active: ActiveWorkspaceRuntime | null = null;
  private activationGeneration = 0;
  /** Distinct from `activationGeneration`: failed or superseded candidates
   * never replace the generation that owns the committed runtime. */
  private activeGeneration: number | null = null;
  private lastFailure: { phase: WorkspaceActivationPhase; errorMessage: string } | null = null;

  constructor(private readonly options: WorkspaceRuntimeCoordinatorOptions) {}

  current(): ActiveWorkspaceRuntime | null {
    return this.active;
  }

  status(): WorkspaceRuntimeStatus {
    return this.lastFailure
      ? { status: "degraded", active: this.active, ...this.lastFailure }
      : { status: "active", active: this.active };
  }

  /** Records a post-commit resource failure only when it belongs to the
   * currently active candidate. Late kernel callbacks from a closed watcher
   * must not degrade the Workspace that replaced it. */
  reportLateRuntimeFailure(generation: number, phase: WorkspaceActivationPhase, errorMessage: string): boolean {
    if (!this.active || generation !== this.activeGeneration) return false;
    this.lastFailure = { phase, errorMessage };
    return true;
  }

  async activate(request: WorkspaceActivationRequest): Promise<WorkspaceActivationOutcome> {
    const candidate = this.createCandidate(request);
    let stagedCommandServer: StagedCommandServer | null = null;
    let stagedWatcher: StagedWorkspaceWatcher | null = null;

    try {
      await this.runPhase("recovery", () => this.options.recoverInvocations(candidate));
      if (!this.isCurrent(candidate)) return { status: "superseded" };

      await this.runPhase("note-roots", () => this.options.prepareNoteRoots(candidate));
      if (!this.isCurrent(candidate)) return { status: "superseded" };

      stagedCommandServer = await this.runPhase("command-server", () => this.options.stageCommandServer(candidate));
      if (!this.isCurrent(candidate)) {
        await stagedCommandServer.abort();
        return { status: "superseded" };
      }
      const commandServer = stagedCommandServer;
      stagedWatcher = await this.runPhase("watcher", () => this.options.stageWatcher(candidate));
      if (!this.isCurrent(candidate)) {
        await commandServer.abort();
        stagedWatcher.abort();
        return { status: "superseded" };
      }
      const watcher = stagedWatcher;

      this.runSynchronousPhase("command-server", () => commandServer.commit());
      const active: ActiveWorkspaceRuntime = {
        settings: candidate.settings,
        revision: candidate.revision,
        model: candidate.model,
        runtimeRoot: candidate.runtimeRoot,
      };
      // This is the sole active-scope commit. The composition-root callback is
      // intentionally a synchronous assignment, so `current()` and the main
      // process fields change as one final observable transition.
      try {
        this.active = active;
        this.activeGeneration = candidate.generation;
        this.lastFailure = null;
        this.options.publishActive(active);
        watcher.commit();
        this.options.invalidateDerivedState(candidate);
        this.options.setTerminalDefaultCwd(candidate);
        this.options.reconcileIndex(request.previousSettings, candidate, request.reason);
      } catch (error) {
        // Discovery is already atomically live. Reporting this as a failed
        // activation would falsely claim A while commands resolve to B, so
        // retain B and surface an honest degraded runtime instead.
        const errorMessage = errorMessageFor(error);
        this.lastFailure = { phase: "post-commit", errorMessage };
        return { status: "committed-degraded", active, errorMessage };
      }
      return { status: "applied", active };
    } catch (error) {
      await stagedCommandServer?.abort().catch(() => {});
      stagedWatcher?.abort();
      if (!this.isCurrent(candidate)) return { status: "superseded" };
      const phase = phaseForError(error);
      const errorMessage = errorMessageFor(error);
      this.lastFailure = { phase, errorMessage };
      return { status: "failed", phase, errorMessage, active: this.active };
    }
  }

  private createCandidate(request: WorkspaceActivationRequest): WorkspaceRuntimeCandidate {
    return {
      generation: ++this.activationGeneration,
      settings: request.settings,
      revision: request.revision,
      model: this.options.modelFromSettings(request.settings),
      runtimeRoot: this.options.runtimeRootFor(request.settings),
    };
  }

  private isCurrent(candidate: WorkspaceRuntimeCandidate): boolean {
    return candidate.generation === this.activationGeneration;
  }

  private async runPhase<T>(phase: WorkspaceActivationPhase, operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new WorkspaceActivationError(phase, error);
    }
  }

  private runSynchronousPhase(phase: WorkspaceActivationPhase, operation: () => void): void {
    try {
      operation();
    } catch (error) {
      throw new WorkspaceActivationError(phase, error);
    }
  }
}

class WorkspaceActivationError extends Error {
  constructor(readonly phase: WorkspaceActivationPhase, cause: unknown) {
    super(errorMessageFor(cause));
  }
}

function phaseForError(error: unknown): WorkspaceActivationPhase {
  return error instanceof WorkspaceActivationError ? error.phase : "command-server";
}

function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
