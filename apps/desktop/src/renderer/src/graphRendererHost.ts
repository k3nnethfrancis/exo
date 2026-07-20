import type { GraphPresentationPlan } from "./graphPresentation";
import { runtimeGraphGpu, type GraphGpuRuntime } from "./graphWebGpuRenderer";

export type GraphPixelRendererKind = "webgpu" | "canvas2d";

export interface GraphPixelRendererMeasurement {
  cpuMilliseconds: number;
  drawCalls: number;
  nodes: number;
  edges: number;
  width: number;
  height: number;
  dpr: number;
}

export interface GraphPixelRenderer {
  resize(viewport: { width: number; height: number; dpr: number }): void;
  render(plan: GraphPresentationPlan): GraphPixelRendererMeasurement;
  destroy(): void;
}

/** The host retains this object by identity; only `plan` crosses into a renderer. */
export interface GraphRendererFrame<State> {
  plan: GraphPresentationPlan;
  state: State;
}

export interface GraphRendererTransition<State> {
  kind: GraphPixelRendererKind;
  generation: number;
  reason: "boot" | "unavailable" | "initial-fallback" | "recreated" | "recovery-fallback";
  frame: GraphRendererFrame<State> | null;
}

export interface GraphRendererHostOptions<State> {
  /** Undefined detects the actual runtime; null explicitly represents unavailable WebGPU. */
  webGpuRuntime?: GraphGpuRuntime | null;
  createWebGpu(
    runtime: GraphGpuRuntime,
    reportFailure: (error: Error) => void,
  ): Promise<GraphPixelRenderer>;
  createCanvas(): GraphPixelRenderer | Promise<GraphPixelRenderer>;
  onTransition?: (transition: GraphRendererTransition<State>) => void;
  onError?: (error: Error) => void;
}

export class GraphRendererHostError extends Error {
  constructor(
    readonly code: "not-started" | "destroyed" | "canvas-unavailable" | "recovery-failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GraphRendererHostError";
  }
}

/**
 * Owns only renderer lifecycle. CPU scene state is retained unchanged so a GPU
 * loss can recreate pixels or fall back without relayout, reframing, or loss of
 * selection/path/detail identity.
 */
export class GraphRendererHost<State> {
  private readonly webGpuRuntime: GraphGpuRuntime | null;
  private renderer: GraphPixelRenderer | null = null;
  private rendererKind: GraphPixelRendererKind | null = null;
  private currentGeneration = 0;
  private currentFrame: GraphRendererFrame<State> | null = null;
  private viewport: { width: number; height: number; dpr: number } | null = null;
  private startTask: Promise<GraphPixelRendererKind> | null = null;
  private recoveryTask: Promise<void> | null = null;
  private recreationAttempted = false;
  private destroyed = false;

  constructor(private readonly options: GraphRendererHostOptions<State>) {
    this.webGpuRuntime = options.webGpuRuntime === undefined ? runtimeGraphGpu() : options.webGpuRuntime;
  }

  get kind(): GraphPixelRendererKind | null {
    return this.rendererKind;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  /** Exact CPU state retained for renderer recovery; the host never inspects it. */
  get frame(): GraphRendererFrame<State> | null {
    return this.currentFrame;
  }

  start(): Promise<GraphPixelRendererKind> {
    this.assertNotDestroyed();
    if (this.rendererKind) return Promise.resolve(this.rendererKind);
    if (this.startTask) return this.startTask;
    const task = this.installInitial();
    this.startTask = task;
    const clear = () => {
      if (this.startTask === task) this.startTask = null;
    };
    void task.then(clear, clear);
    return task;
  }

  resize(viewport: { width: number; height: number; dpr: number }): void {
    this.assertNotDestroyed();
    this.viewport = { ...viewport };
    this.renderer?.resize(this.viewport);
  }

  render(frame: GraphRendererFrame<State>): GraphPixelRendererMeasurement | null {
    this.assertNotDestroyed();
    this.currentFrame = frame;
    if (!this.renderer) return null;
    try {
      return this.renderer.render(frame.plan);
    } catch (cause) {
      this.handleFailure(asError(cause), this.currentGeneration);
      return null;
    }
  }

  async settled(): Promise<void> {
    if (this.startTask) await this.startTask;
    while (this.recoveryTask) await this.recoveryTask;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.currentGeneration += 1;
    this.renderer?.destroy();
    this.renderer = null;
    this.rendererKind = null;
    this.currentFrame = null;
    this.viewport = null;
  }

  private async installInitial(): Promise<GraphPixelRendererKind> {
    if (this.webGpuRuntime) {
      try {
        await this.installWebGpu("boot");
        return "webgpu";
      } catch (cause) {
        if (this.destroyed) throw new GraphRendererHostError("destroyed", "Graph renderer host has been destroyed.", { cause });
        this.options.onError?.(asError(cause));
        await this.installCanvas("initial-fallback");
        return "canvas2d";
      }
    }
    await this.installCanvas("unavailable");
    return "canvas2d";
  }

  private handleFailure(error: Error, generation: number): void {
    if (this.destroyed || generation !== this.currentGeneration || this.rendererKind !== "webgpu") return;
    this.options.onError?.(error);
    if (this.recoveryTask) return;
    const task = this.recover().catch((cause) => this.failRecovery(cause));
    this.recoveryTask = task;
    void task.finally(() => {
      if (this.recoveryTask === task) this.recoveryTask = null;
    });
  }

  private async recover(): Promise<void> {
    if (!this.recreationAttempted && this.webGpuRuntime) {
      this.recreationAttempted = true;
      try {
        await this.installWebGpu("recreated");
        return;
      } catch (cause) {
        if (this.destroyed) throw cause;
        this.options.onError?.(asError(cause));
      }
    }
    await this.installCanvas("recovery-fallback");
  }

  private async installWebGpu(reason: "boot" | "recreated"): Promise<void> {
    const runtime = this.webGpuRuntime;
    if (!runtime) throw new GraphRendererHostError("not-started", "WebGPU is unavailable in this runtime.");
    const generation = ++this.currentGeneration;
    let renderer: GraphPixelRenderer | null = null;
    let pendingFailure: Error | null = null;
    const reportFailure = (error: Error) => {
      if (!renderer || this.renderer !== renderer) {
        pendingFailure = error;
        return;
      }
      this.handleFailure(error, generation);
    };
    try {
      renderer = await this.options.createWebGpu(runtime, reportFailure);
      if (pendingFailure) throw pendingFailure;
      if (!this.isCurrent(generation)) {
        const staleRenderer = renderer;
        renderer = null;
        staleRenderer.destroy();
        throw new GraphRendererHostError("destroyed", "Graph renderer host has been destroyed.");
      }
      this.prepare(renderer);
      if (pendingFailure) throw pendingFailure;
      this.activate(renderer, "webgpu", generation, reason);
    } catch (cause) {
      renderer?.destroy();
      throw cause;
    }
  }

  private async installCanvas(reason: "unavailable" | "initial-fallback" | "recovery-fallback"): Promise<void> {
    const generation = ++this.currentGeneration;
    let renderer: GraphPixelRenderer | null = null;
    try {
      renderer = await this.options.createCanvas();
      if (!this.isCurrent(generation)) {
        const staleRenderer = renderer;
        renderer = null;
        staleRenderer.destroy();
        throw new GraphRendererHostError("destroyed", "Graph renderer host has been destroyed.");
      }
      this.prepare(renderer);
      this.activate(renderer, "canvas2d", generation, reason);
    } catch (cause) {
      renderer?.destroy();
      if (cause instanceof GraphRendererHostError && cause.code === "destroyed") throw cause;
      throw new GraphRendererHostError("canvas-unavailable", "Canvas graph fallback could not start.", { cause });
    }
  }

  private prepare(renderer: GraphPixelRenderer): void {
    if (this.viewport) renderer.resize(this.viewport);
    if (this.currentFrame) renderer.render(this.currentFrame.plan);
  }

  private activate(
    renderer: GraphPixelRenderer,
    kind: GraphPixelRendererKind,
    generation: number,
    reason: GraphRendererTransition<State>["reason"],
  ): void {
    if (!this.isCurrent(generation)) {
      renderer.destroy();
      return;
    }
    const previous = this.renderer;
    this.renderer = renderer;
    this.rendererKind = kind;
    previous?.destroy();
    this.options.onTransition?.({ kind, generation, reason, frame: this.currentFrame });
  }

  private failRecovery(cause: unknown): void {
    if (this.destroyed) return;
    const error = cause instanceof GraphRendererHostError && cause.code === "canvas-unavailable"
      ? new GraphRendererHostError("recovery-failed", "Graph renderer recovery and Canvas fallback both failed.", { cause })
      : asError(cause);
    this.renderer?.destroy();
    this.renderer = null;
    this.rendererKind = null;
    this.options.onError?.(error);
  }

  private isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.currentGeneration;
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) throw new GraphRendererHostError("destroyed", "Graph renderer host has been destroyed.");
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
