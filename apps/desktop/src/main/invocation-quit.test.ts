import { describe, expect, it, vi } from "vitest";

import { awaitInvocationAwareQuit } from "./invocation-quit";

describe("awaitInvocationAwareQuit", () => {
  it("settles invocations before it begins flushing dirty renderer documents", async () => {
    let releaseStop!: () => void;
    let releaseFlush!: () => void;
    const stop = new Promise<void>((resolve) => { releaseStop = resolve; });
    const flush = new Promise<void>((resolve) => { releaseFlush = resolve; });
    let complete = false;
    const flushDirtyDocuments = vi.fn(() => flush);
    const quitting = awaitInvocationAwareQuit({
      flushDirtyDocuments,
      stopInvocations: () => stop,
      flushTimeoutMs: 1_000,
    }).then(() => { complete = true; });

    await Promise.resolve();
    expect(flushDirtyDocuments).not.toHaveBeenCalled();
    expect(complete).toBe(false);
    releaseStop();
    await Promise.resolve();
    expect(flushDirtyDocuments).toHaveBeenCalledOnce();
    releaseFlush();
    await quitting;
    expect(complete).toBe(true);
  });

  it("reports either phase without skipping the other settlement", async () => {
    const onError = vi.fn();
    const stopInvocations = vi.fn(async () => undefined);

    await awaitInvocationAwareQuit({
      flushDirtyDocuments: async () => { throw new Error("flush failed"); },
      stopInvocations,
      onError,
    });

    expect(stopInvocations).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("renderer-flush", expect.any(Error));
  });

  it("bounds and reports a renderer flush that never settles", async () => {
    const onError = vi.fn();

    await awaitInvocationAwareQuit({
      flushDirtyDocuments: () => new Promise(() => undefined),
      stopInvocations: async () => undefined,
      flushTimeoutMs: 5,
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      "renderer-flush",
      expect.objectContaining({ message: "Renderer flush exceeded 5ms." }),
    );
  });

  it("does not flush or hide a failed invocation Stop", async () => {
    const onError = vi.fn();
    const flushDirtyDocuments = vi.fn(async () => undefined);
    const failure = new Error("stop failed");

    await expect(awaitInvocationAwareQuit({
      flushDirtyDocuments,
      stopInvocations: async () => { throw failure; },
      onError,
    })).rejects.toBe(failure);

    expect(flushDirtyDocuments).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("invocation-stop", failure);
  });
});
