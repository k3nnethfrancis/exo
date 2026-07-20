import { describe, expect, it, vi } from "vitest";

import { GraphRenderScheduler, type GraphFrameDriver } from "./graphRenderScheduler";

class FakeFrameDriver implements GraphFrameDriver {
  private nextHandle = 1;
  readonly callbacks = new Map<number, (time: number) => void>();

  request(callback: (time: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  flush(time = 16): void {
    const pending = [...this.callbacks.entries()];
    this.callbacks.clear();
    for (const [, callback] of pending) callback(time);
  }
}

describe("GraphRenderScheduler", () => {
  it("coalesces invalidations into one observable frame", () => {
    const driver = new FakeFrameDriver();
    const render = vi.fn();
    const scheduler = new GraphRenderScheduler(driver, render);
    expect(scheduler.invalidate("camera")).toBe(true);
    expect(scheduler.invalidate("selection")).toBe(false);
    expect(driver.callbacks.size).toBe(1);
    expect(scheduler.snapshot()).toMatchObject({ invalidations: 2, requestedFrames: 1, pending: true, lastReason: "selection" });
    driver.flush(42);
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(42);
    expect(scheduler.snapshot()).toMatchObject({ renderedFrames: 1, pending: false, moving: false, idle: true });
  });

  it("requests finite motion frames and reaches zero idle work when motion settles", () => {
    const driver = new FakeFrameDriver();
    let remaining = 3;
    const scheduler = new GraphRenderScheduler(driver, () => ({ continueMotion: --remaining > 0 }));
    scheduler.startMotion();
    driver.flush(16);
    driver.flush(32);
    driver.flush(48);
    expect(scheduler.snapshot()).toMatchObject({ requestedFrames: 3, renderedFrames: 3, pending: false, moving: false, idle: true });
    expect(driver.callbacks.size).toBe(0);
    driver.flush(64);
    expect(scheduler.snapshot().renderedFrames).toBe(3);
  });

  it("can stop continuing motion on the current frame", () => {
    const driver = new FakeFrameDriver();
    const scheduler = new GraphRenderScheduler(driver, () => ({ continueMotion: false }));
    scheduler.startMotion();
    scheduler.stopMotion();
    driver.flush();
    expect(scheduler.snapshot()).toMatchObject({ renderedFrames: 1, moving: false, idle: true });
  });

  it("cancels pending work on disposal and rejects later invalidations", () => {
    const driver = new FakeFrameDriver();
    const render = vi.fn();
    const scheduler = new GraphRenderScheduler(driver, render);
    scheduler.invalidate("layout");
    scheduler.dispose();
    expect(driver.callbacks.size).toBe(0);
    expect(scheduler.invalidate("late")).toBe(false);
    expect(scheduler.snapshot()).toMatchObject({ cancelledFrames: 1, pending: false });
    driver.flush();
    expect(render).not.toHaveBeenCalled();
  });
});
