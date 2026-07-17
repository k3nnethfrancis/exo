import { describe, expect, it } from "vitest";

import { LatestPaneNavigation } from "./latestPaneNavigation";

describe("latest pane navigation", () => {
  it("does not let a slower earlier load replace a later selection in the same pane", async () => {
    const navigation = new LatestPaneNavigation();
    const first = deferred<void>();
    const second = deferred<void>();
    const committed: string[] = [];

    const firstRequest = navigation.commitLatest("left", () => first.promise, () => committed.push("first"));
    const secondRequest = navigation.commitLatest("left", () => second.promise, () => committed.push("second"));

    second.resolve();
    await expect(secondRequest).resolves.toBe(true);
    first.resolve();
    await expect(firstRequest).resolves.toBe(false);
    expect(committed).toEqual(["second"]);
  });

  it("keeps independent panes concurrent", async () => {
    const navigation = new LatestPaneNavigation();
    const left = deferred<void>();
    const right = deferred<void>();
    const committed: string[] = [];

    const leftRequest = navigation.commitLatest("left", () => left.promise, () => committed.push("left"));
    const rightRequest = navigation.commitLatest("right", () => right.promise, () => committed.push("right"));

    right.resolve();
    await expect(rightRequest).resolves.toBe(true);
    left.resolve();
    await expect(leftRequest).resolves.toBe(true);
    expect(committed).toEqual(["right", "left"]);
  });

  it("ignores a stale load failure after a newer same-pane selection commits", async () => {
    const navigation = new LatestPaneNavigation();
    const stale = deferred<void>();

    const firstRequest = navigation.commitLatest("left", () => stale.promise, () => {
      throw new Error("stale request must not commit");
    });
    await expect(navigation.commitLatest("left", async () => {}, () => {})).resolves.toBe(true);
    stale.reject(new Error("file disappeared"));

    await expect(firstRequest).resolves.toBe(false);
  });
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
