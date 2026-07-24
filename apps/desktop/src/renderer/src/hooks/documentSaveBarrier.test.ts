import { describe, expect, it } from "vitest";

import { DocumentSaveBarrier } from "./documentSaveBarrier";

describe("DocumentSaveBarrier", () => {
  it("drains an in-flight autosave before a review mutation can restore the file", async () => {
    const barrier = new DocumentSaveBarrier();
    let releaseAutosave!: () => void;
    const autosaveMayFinish = new Promise<void>((resolve) => { releaseAutosave = resolve; });
    let disk = "agent proposal";

    const autosave = barrier.run("/notes/example.md", async () => {
      await autosaveMayFinish;
      disk = "human edit";
    });
    const review = (async () => {
      await barrier.idle("/notes/example.md");
      disk = "before invocation";
    })();

    await Promise.resolve();
    expect(disk).toBe("agent proposal");
    releaseAutosave();
    await Promise.all([autosave, review]);
    expect(disk).toBe("before invocation");
  });

  it("serializes a final dirty-buffer flush behind an autosave already in flight", async () => {
    const barrier = new DocumentSaveBarrier();
    let releaseAutosave!: () => void;
    const autosaveMayFinish = new Promise<void>((resolve) => { releaseAutosave = resolve; });
    const writes: string[] = [];

    const autosave = barrier.run("/notes/example.md", async () => {
      await autosaveMayFinish;
      writes.push("stale edit");
    });
    const flush = barrier.run("/notes/example.md", async () => { writes.push("current edit"); });

    releaseAutosave();
    await Promise.all([autosave, flush]);
    expect(writes).toEqual(["stale edit", "current edit"]);
  });
});
