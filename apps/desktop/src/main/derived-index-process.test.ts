import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IndexStatus, WorkspaceModel } from "@exo/core";

import {
  UtilityDerivedIndexClient,
  type DerivedIndexProcessHandle,
} from "./derived-index-process";

vi.mock("electron", () => ({ utilityProcess: { fork: vi.fn() } }));

describe("UtilityDerivedIndexClient", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves worker responses without running derived work in the caller", async () => {
    const worker = new FakeProcess();
    const client = new UtilityDerivedIndexClient({ spawn: () => worker, workerPath: "/app/derived-index-worker.js" });

    const promise = client.status(model(), "/workspace/.exo");
    expect(worker.messages).toEqual([
      expect.objectContaining({ id: 1, operation: "status", context: expect.objectContaining({ runtimeRoot: "/workspace/.exo" }) }),
    ]);

    worker.emit("message", { id: 1, ok: true, result: status() });
    await expect(promise).resolves.toMatchObject({ documentCount: 3 });
  });

  it("kills a stuck worker, rejects every in-flight request, and restarts on the next request", async () => {
    vi.useFakeTimers();
    const workers: FakeProcess[] = [];
    const client = new UtilityDerivedIndexClient({
      requestTimeoutMs: 50,
      workerPath: "/app/derived-index-worker.js",
      spawn: () => {
        const worker = new FakeProcess();
        workers.push(worker);
        return worker;
      },
    });

    const first = client.status(model(), "/workspace/.exo");
    const second = client.search(model(), "/workspace/.exo", "needle");
    const firstRejected = expect(first).rejects.toThrow("timed out after 50 ms");
    const secondRejected = expect(second).rejects.toThrow("timed out after 50 ms");
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([firstRejected, secondRejected]);
    expect(workers[0].killed).toBe(true);

    const restarted = client.status(model(), "/workspace/.exo");
    expect(workers).toHaveLength(2);
    workers[1].emit("message", { id: 3, ok: true, result: status() });
    await expect(restarted).resolves.toMatchObject({ backend: "qmd" });
  });

  it("cancels an abandoned request without accepting its late response", async () => {
    const worker = new FakeProcess();
    const client = new UtilityDerivedIndexClient({ spawn: () => worker, workerPath: "/app/derived-index-worker.js" });
    const controller = new AbortController();

    const promise = client.search(model(), "/workspace/.exo", "old query", {}, controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages.at(-1)).toEqual({ id: 1, operation: "cancel" });
    worker.emit("message", { id: 1, ok: true, result: { results: [] } });
  });

  it("routes graph context and incremental refresh through the isolated worker", async () => {
    const worker = new FakeProcess();
    const client = new UtilityDerivedIndexClient({ spawn: () => worker, workerPath: "/app/derived-index-worker.js" });

    const context = client.graphContext(model(), "/workspace/.exo", "/workspace/notes/focus.md");
    expect(worker.messages.at(-1)).toMatchObject({ operation: "graph-context", filePath: "/workspace/notes/focus.md" });
    worker.emit("message", { id: 1, ok: true, result: null });
    await expect(context).resolves.toBeNull();

    const view = client.graphView(model(), "/workspace/.exo", "okf");
    expect(worker.messages.at(-1)).toMatchObject({ operation: "graph-view", profileId: "okf" });
    worker.emit("message", {
      id: 2,
      ok: true,
      result: {
        projection: {
          version: "0.1",
          layoutVersion: "finite-force-0.1",
          sourceSnapshotId: "fixture",
          seed: 1,
          nodes: [],
          edges: [],
          omitted: { tagConcepts: 0, tagRelations: 0 },
        },
      },
    });
    await expect(view).resolves.toMatchObject({
      projection: { sourceSnapshotId: "fixture" },
    });

    const refresh = client.graphRefresh(model(), "/workspace/.exo", "/workspace/notes/focus.md");
    expect(worker.messages.at(-1)).toMatchObject({ operation: "graph-refresh", filePath: "/workspace/notes/focus.md" });
    worker.emit("message", { id: 3, ok: true, result: null });
    await expect(refresh).resolves.toBeUndefined();
  });

  it("keeps foreground search responsive while a separate maintenance embed is held", async () => {
    const foregroundWorker = new FakeProcess();
    const maintenanceWorker = new FakeProcess();
    const foreground = new UtilityDerivedIndexClient({ spawn: () => foregroundWorker, workerPath: "/app/derived-index-worker.js" });
    const maintenance = new UtilityDerivedIndexClient({ spawn: () => maintenanceWorker, workerPath: "/app/derived-index-worker.js" });

    const embedding = maintenance.embed(model(), "/workspace/.exo", {
      maxDocuments: 4,
      maxDocsPerBatch: 1,
      maxDurationMs: 15_000,
    });
    expect(maintenanceWorker.messages.at(-1)).toMatchObject({
      operation: "embed",
      options: { maxDocuments: 4, maxDocsPerBatch: 1, maxDurationMs: 15_000 },
    });

    const searching = foreground.search(model(), "/workspace/.exo", "needle");
    foregroundWorker.emit("message", {
      id: 1,
      ok: true,
      result: { results: [], query: "needle", mode: "lexical", source: "filesystem", warnings: [] },
    });
    await expect(searching).resolves.toMatchObject({ query: "needle", source: "filesystem" });

    let embedSettled = false;
    void embedding.finally(() => { embedSettled = true; });
    await Promise.resolve();
    expect(embedSettled).toBe(false);
    maintenanceWorker.emit("message", { id: 1, ok: true, result: status() });
    await expect(embedding).resolves.toMatchObject({ backend: "qmd" });
  });

  it("rejects requests when the worker exits and starts a fresh worker afterward", async () => {
    const workers: FakeProcess[] = [];
    const client = new UtilityDerivedIndexClient({
      workerPath: "/app/derived-index-worker.js",
      spawn: () => {
        const worker = new FakeProcess();
        workers.push(worker);
        return worker;
      },
    });

    const interrupted = client.status(model(), "/workspace/.exo");
    workerAt(workers, 0).emit("exit", 9);
    await expect(interrupted).rejects.toThrow("exited with code 9");

    const restarted = client.status(model(), "/workspace/.exo");
    workerAt(workers, 1).emit("message", { id: 2, ok: true, result: status() });
    await expect(restarted).resolves.toMatchObject({ documentCount: 3 });
  });
});

class FakeProcess extends EventEmitter implements DerivedIndexProcessHandle {
  messages: unknown[] = [];
  killed = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function model(): WorkspaceModel {
  return {
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: [{ id: "notes", label: "notes", path: "/workspace/notes" }],
    indexedRoots: [{
      id: "index-notes",
      label: "notes",
      path: "/workspace/notes",
      kind: "notes",
      pattern: "**/*.md",
      ignore: [],
      backend: "qmd",
    }],
    indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
  };
}

function status(): IndexStatus {
  return {
    enabled: true,
    mode: "hybrid",
    backend: "qmd",
    dbPath: "/workspace/.exo/qmd/index.sqlite",
    runtimePath: "/workspace/.exo/qmd",
    indexedRoots: model().indexedRoots,
    documentCount: 3,
    pendingEmbeddings: 0,
    hasVectorIndex: true,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function workerAt(workers: FakeProcess[], index: number): FakeProcess {
  const worker = workers[index];
  if (!worker) throw new Error(`Missing fake worker ${index}.`);
  return worker;
}
