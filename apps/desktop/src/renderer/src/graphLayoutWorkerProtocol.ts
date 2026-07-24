import type { GraphLayoutFrame, GraphLayoutInput } from "./graphSceneFoundation";
import {
  createGraphLayoutSimulation,
  estimateGraphLayoutBytes,
  graphLayoutChecksum,
  NonFiniteGraphLayoutError,
  stepGraphLayoutSimulation,
  type GraphLayoutSimulation,
} from "./graphLayoutSimulation";

export type GraphLayoutWorkerRequest =
  | { type: "init"; generation: number; input: GraphLayoutInput }
  | { type: "dispose"; generation: number };

export type GraphLayoutWorkerResponse =
  | {
    type: "frame";
    generation: number;
    frame: GraphLayoutFrame;
    terminal: true;
    converged: boolean;
    checksum: string;
    energy: number;
    iterations: number;
    estimatedBytes: number;
  }
  | {
    type: "error";
    generation: number;
    code: "invalid-generation" | "invalid-input" | "non-finite-layout";
    message: string;
  };

export interface GraphLayoutTaskScheduler {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

export interface GraphLayoutWorkerSnapshot {
  activeGeneration: number;
  pending: boolean;
  disposed: boolean;
  scheduledTasks: number;
  executedTasks: number;
  emittedFrames: number;
  emittedErrors: number;
  ignoredMessages: number;
}

export interface GraphLayoutWorkerControllerOptions {
  iterationsPerTask?: number;
  maximumIterations?: number;
}

/** Generation-safe worker lifecycle, separated from global Worker APIs for tests. */
export class GraphLayoutWorkerController {
  private activeGeneration = -1;
  private token = 0;
  private pendingHandle: number | null = null;
  private simulation: GraphLayoutSimulation | null = null;
  private disposed = false;
  private readonly iterationsPerTask: number;
  private readonly maximumIterations: number;
  private scheduledTasks = 0;
  private executedTasks = 0;
  private emittedFrames = 0;
  private emittedErrors = 0;
  private ignoredMessages = 0;

  constructor(
    private readonly scheduler: GraphLayoutTaskScheduler,
    private readonly emit: (response: GraphLayoutWorkerResponse) => void,
    options: GraphLayoutWorkerControllerOptions = {},
  ) {
    this.iterationsPerTask = Math.max(1, Math.floor(options.iterationsPerTask ?? 2));
    this.maximumIterations = Math.max(this.iterationsPerTask, Math.floor(options.maximumIterations ?? 320));
  }

  handle(request: GraphLayoutWorkerRequest): void {
    if (!Number.isSafeInteger(request.generation) || request.generation < 0) {
      this.emitError(request.generation, "invalid-generation", "Graph layout generation must be a non-negative safe integer.");
      return;
    }
    if (request.generation <= this.activeGeneration) {
      this.ignoredMessages += 1;
      return;
    }
    this.cancelPending();
    this.activeGeneration = request.generation;
    this.token += 1;
    this.simulation = null;
    if (request.type === "dispose") {
      this.disposed = true;
      return;
    }
    this.disposed = false;
    try {
      this.simulation = createGraphLayoutSimulation(request.input);
    } catch (error) {
      this.emitError(request.generation, "invalid-input", error instanceof Error ? error.message : String(error));
      return;
    }
    this.scheduleNext(this.token);
  }

  snapshot(): GraphLayoutWorkerSnapshot {
    return {
      activeGeneration: this.activeGeneration,
      pending: this.pendingHandle !== null,
      disposed: this.disposed,
      scheduledTasks: this.scheduledTasks,
      executedTasks: this.executedTasks,
      emittedFrames: this.emittedFrames,
      emittedErrors: this.emittedErrors,
      ignoredMessages: this.ignoredMessages,
    };
  }

  private scheduleNext(token: number): void {
    if (!this.simulation || this.pendingHandle !== null || this.disposed) return;
    this.scheduledTasks += 1;
    this.pendingHandle = this.scheduler.schedule(() => {
      this.pendingHandle = null;
      if (token !== this.token || this.disposed || !this.simulation) return;
      this.executedTasks += 1;
      const remainingIterations = this.maximumIterations - this.simulation.iterations;
      try {
        stepGraphLayoutSimulation(this.simulation, Math.min(this.iterationsPerTask, remainingIterations));
      } catch (error) {
        if (!(error instanceof NonFiniteGraphLayoutError)) throw error;
        this.emitError(this.activeGeneration, "non-finite-layout", error.message);
        this.simulation = null;
        return;
      }
      if (this.simulation.settled) {
        this.emitTerminal(this.activeGeneration, this.simulation, true);
        this.simulation = null;
        return;
      }
      if (this.simulation.iterations >= this.maximumIterations) {
        this.emitTerminal(this.activeGeneration, this.simulation, false);
        this.simulation = null;
        return;
      }
      this.scheduleNext(token);
    });
  }

  private emitTerminal(generation: number, simulation: GraphLayoutSimulation, converged: boolean): void {
    const positions = new Float32Array(simulation.positions);
    this.emittedFrames += 1;
    this.emit({
      type: "frame",
      generation,
      terminal: true,
      converged,
      frame: {
        topologyHash: simulation.input.topologyHash,
        layoutEpochId: simulation.input.layoutEpochId,
        sequence: simulation.input.sequence,
        positions,
        settled: true,
      },
      checksum: graphLayoutChecksum(positions),
      energy: simulation.energy,
      iterations: simulation.iterations,
      estimatedBytes: estimateGraphLayoutBytes(simulation) + positions.byteLength,
    });
  }

  private emitError(generation: number, code: Extract<GraphLayoutWorkerResponse, { type: "error" }>["code"], message: string): void {
    this.emittedErrors += 1;
    this.emit({ type: "error", generation, code, message });
  }

  private cancelPending(): void {
    if (this.pendingHandle === null) return;
    this.scheduler.cancel(this.pendingHandle);
    this.pendingHandle = null;
  }
}
