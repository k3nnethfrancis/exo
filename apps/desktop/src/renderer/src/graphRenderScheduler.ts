export interface GraphFrameDriver {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export interface GraphRenderSchedulerSnapshot {
  invalidations: number;
  requestedFrames: number;
  renderedFrames: number;
  cancelledFrames: number;
  pending: boolean;
  moving: boolean;
  idle: boolean;
  lastReason: string | null;
}

export interface GraphRenderFrameResult {
  continueMotion?: boolean;
}

/**
 * Coalescing, on-demand frame scheduler. A frame is requested only by an
 * explicit invalidation or continuing finite motion; settled scenes perform no
 * recurring work.
 */
export class GraphRenderScheduler {
  private handle: number | null = null;
  private moving = false;
  private disposed = false;
  private invalidations = 0;
  private requestedFrames = 0;
  private renderedFrames = 0;
  private cancelledFrames = 0;
  private lastReason: string | null = null;

  constructor(
    private readonly driver: GraphFrameDriver,
    private readonly render: (time: number) => GraphRenderFrameResult | void,
  ) {}

  invalidate(reason = "scene"): boolean {
    if (this.disposed) return false;
    this.invalidations += 1;
    this.lastReason = reason;
    if (this.handle !== null) return false;
    this.requestFrame();
    return true;
  }

  startMotion(reason = "motion"): void {
    if (this.disposed) return;
    this.moving = true;
    this.invalidate(reason);
  }

  stopMotion(): void {
    this.moving = false;
  }

  cancelPending(): void {
    if (this.handle === null) return;
    this.driver.cancel(this.handle);
    this.handle = null;
    this.cancelledFrames += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.moving = false;
    this.cancelPending();
  }

  snapshot(): GraphRenderSchedulerSnapshot {
    return {
      invalidations: this.invalidations,
      requestedFrames: this.requestedFrames,
      renderedFrames: this.renderedFrames,
      cancelledFrames: this.cancelledFrames,
      pending: this.handle !== null,
      moving: this.moving,
      idle: !this.disposed && this.handle === null && !this.moving,
      lastReason: this.lastReason,
    };
  }

  private requestFrame(): void {
    this.requestedFrames += 1;
    this.handle = this.driver.request((time) => {
      this.handle = null;
      if (this.disposed) return;
      this.renderedFrames += 1;
      const result = this.render(time);
      this.moving = Boolean(result?.continueMotion);
      if (this.moving) this.requestFrame();
    });
  }
}

export function browserGraphFrameDriver(): GraphFrameDriver {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}
