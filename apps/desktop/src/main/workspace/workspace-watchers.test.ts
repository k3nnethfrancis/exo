import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldIgnoreWorkspaceChange, WorkspaceWatcherService } from "./workspace-watchers";
import type { WorkspaceChangeEvent } from "./workspace-watchers";

afterEach(() => vi.useRealTimers());

describe("workspace watcher filtering", () => {
  const rootPath = "/workspace/stem";

  it("keeps source and note changes visible to the workspace", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/src/App.tsx")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/issues.md")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, null)).toBe(false);
  });

  it("drops noisy generated and vendor changes before they churn the renderer", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/.git/index")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/node_modules/.vite/deps.ts")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/.stem/server.json")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/dist/index.js")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/stem/coverage/index.html")).toBe(true);
  });
});

describe("WorkspaceWatcherService subscriptions", () => {
  it("fans debounced workspace changes out to multiple listeners", async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const service = new WorkspaceWatcherService(first);
    service.subscribe(second);

    queueForTest(service, {
      rootPath: "/workspace/stem",
      eventType: "change",
      filePath: "/workspace/stem/issues.md",
    });
    await vi.advanceTimersByTimeAsync(120);

    expect(first).toHaveBeenCalledWith({
      rootPath: "/workspace/stem",
      eventType: "change",
      filePath: "/workspace/stem/issues.md",
    });
    expect(second).toHaveBeenCalledWith({
      rootPath: "/workspace/stem",
      eventType: "change",
      filePath: "/workspace/stem/issues.md",
    });
    vi.useRealTimers();
  });

  it("stops sending changes to unsubscribed listeners", async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const service = new WorkspaceWatcherService();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();

    queueForTest(service, {
      rootPath: "/workspace/stem",
      eventType: "change",
      filePath: "/workspace/stem/issues.md",
    });
    await vi.advanceTimersByTimeAsync(120);

    expect(listener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("drops a queued source-Workspace event after the watcher switches destination", async () => {
    vi.useFakeTimers();
    try {
      const listener = vi.fn();
      const service = new WorkspaceWatcherService(listener);
      service.start(emptyWorkspace("/workspace/source"));
      const sourceGeneration = watcherGeneration(service);
      service.start(emptyWorkspace("/workspace/destination"));
      // A source watcher callback can already be on the event loop as close()
      // runs. Its captured generation must make it a no-op.
      queueForTest(service, {
        rootPath: "/workspace/source",
        eventType: "change",
        filePath: "/workspace/source/old.md",
      }, sourceGeneration);
      await vi.advanceTimersByTimeAsync(120);

      expect(listener).not.toHaveBeenCalled();
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stages a destination without displacing the active source watcher", async () => {
    const listener = vi.fn();
    const service = new WorkspaceWatcherService(listener);
    service.start(emptyWorkspace("/workspace/source"));
    const sourceGeneration = watcherGeneration(service);

    const staged = service.stage(emptyWorkspace("/workspace/destination"));

    expect(watcherGeneration(service)).toBe(sourceGeneration);
    staged.abort();
    service.stop();
  });

  it("keeps first-candidate callbacks hidden until generation one commits", async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(os.tmpdir(), "stem-watch-bootstrap-generation-"));
    const bootstrapRoot = path.join(root, "bootstrap");
    const candidateRoot = path.join(root, "candidate");
    await Promise.all([mkdir(bootstrapRoot), mkdir(candidateRoot)]);
    const { callbacks, createWatcher } = fakeWatcherFactory();
    const listener = vi.fn();
    const service = new WorkspaceWatcherService(listener, { createWatcher });

    service.start(workspaceForRoot(bootstrapRoot), 0);
    const staged = service.stage(workspaceForRoot(candidateRoot), 1);
    callbacks[1]!("change", "before-commit.md");
    await vi.advanceTimersByTimeAsync(120);
    expect(listener).not.toHaveBeenCalled();

    staged.commit();
    callbacks[1]!("change", "after-commit.md");
    await vi.advanceTimersByTimeAsync(120);
    expect(listener).toHaveBeenCalledWith({
      rootPath: candidateRoot,
      eventType: "change",
      filePath: path.join(candidateRoot, "after-commit.md"),
    });

    service.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("drops callbacks from aborted and superseded candidate generations", async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(path.join(os.tmpdir(), "stem-watch-superseded-generation-"));
    const bootstrapRoot = path.join(root, "bootstrap");
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    await Promise.all([mkdir(bootstrapRoot), mkdir(firstRoot), mkdir(secondRoot)]);
    const { callbacks, createWatcher } = fakeWatcherFactory();
    const listener = vi.fn();
    const service = new WorkspaceWatcherService(listener, { createWatcher });

    service.start(workspaceForRoot(bootstrapRoot), 0);
    const first = service.stage(workspaceForRoot(firstRoot), 1);
    first.abort();
    const second = service.stage(workspaceForRoot(secondRoot), 2);
    callbacks[1]!("change", "aborted.md");
    callbacks[2]!("change", "before-commit.md");
    await vi.advanceTimersByTimeAsync(120);
    expect(listener).not.toHaveBeenCalled();

    second.commit();
    callbacks[1]!("change", "superseded.md");
    callbacks[2]!("change", "active.md");
    await vi.advanceTimersByTimeAsync(120);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      rootPath: secondRoot,
      eventType: "change",
      filePath: path.join(secondRoot, "active.md"),
    });

    service.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("fails staging when a required Note Root cannot be watched", () => {
    const service = new WorkspaceWatcherService();
    expect(() => service.stage({
      ...emptyWorkspace("/workspace/missing"),
      noteRoots: [{ id: "notes", label: "Notes", path: "/workspace/missing/notes" }],
    })).toThrow("Required workspace note root does not exist");
  });

  it("reports only late watcher errors from the active generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stem-watch-runtime-error-"));
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const errorHandlers: Array<(error: Error) => void> = [];
    const close = vi.fn();
    const createWatcher = vi.fn(() => ({
      on: (event: string, handler: (error: Error) => void) => {
        if (event === "error") errorHandlers.push(handler);
        return undefined;
      },
      close,
    })) as unknown as typeof import("node:fs").watch;
    const onRuntimeError = vi.fn();
    const service = new WorkspaceWatcherService(undefined, { createWatcher, onRuntimeError });

    service.start(workspaceForRoot(firstRoot));
    errorHandlers[0]!(new Error("first failed"));
    expect(onRuntimeError).toHaveBeenCalledWith(expect.objectContaining({ generation: 1, rootPath: firstRoot, errorMessage: "first failed" }));

    service.start(workspaceForRoot(secondRoot));
    errorHandlers[0]!(new Error("stale first failed"));
    errorHandlers[1]!(new Error("second failed"));
    expect(onRuntimeError).toHaveBeenCalledTimes(2);
    expect(onRuntimeError).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 2, rootPath: secondRoot, errorMessage: "second failed" }));
    service.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("observes the canonical ontology file outside a nested Note Root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "stem-ontology-watch-"));
    const noteRoot = path.join(workspaceRoot, "notes");
    await mkdir(noteRoot);
    const event = new Promise<WorkspaceChangeEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("ontology watcher timed out")), 2_000);
      const service = new WorkspaceWatcherService((change) => {
        if (change.filePath !== path.join(workspaceRoot, "ontology.yaml")) return;
        clearTimeout(timeout);
        service.stop();
        resolve(change);
      });
      service.start({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [{ id: "notes", label: "Notes", path: noteRoot }],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });
    });

    // fs.watch registration is asynchronous on macOS; let the kernel watcher
    // settle before mutating the target file so this integration probe does
    // not race its own setup.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(path.join(workspaceRoot, "ontology.yaml"), "ontology_schema: 1\n");
    await expect(event).resolves.toMatchObject({ rootPath: workspaceRoot, filePath: path.join(workspaceRoot, "ontology.yaml") });
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});

function queueForTest(service: WorkspaceWatcherService, event: WorkspaceChangeEvent, generation?: number): void {
  (service as unknown as { queue: (nextEvent: WorkspaceChangeEvent, nextGeneration?: number) => void }).queue(event, generation);
}

function watcherGeneration(service: WorkspaceWatcherService): number {
  return (service as unknown as { activeGeneration: number }).activeGeneration;
}

function emptyWorkspace(workspaceRoot: string) {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [],
    indexedRoots: [],
    indexing: { enabled: false as const, mode: "off" as const, backend: "qmd" as const },
    searchEngine: "filesystem" as const,
  };
}

function workspaceForRoot(rootPath: string) {
  return {
    ...emptyWorkspace(rootPath),
    noteRoots: [{ id: "notes", label: "Notes", path: rootPath }],
  };
}

function fakeWatcherFactory() {
  const callbacks: Array<(eventType: string, filename: string) => void> = [];
  const createWatcher = vi.fn((
    _rootPath: string,
    _options: unknown,
    callback: (eventType: string, filename: string) => void,
  ) => {
    callbacks.push(callback);
    return { on: vi.fn(), close: vi.fn() };
  }) as unknown as typeof import("node:fs").watch;
  return { callbacks, createWatcher };
}
