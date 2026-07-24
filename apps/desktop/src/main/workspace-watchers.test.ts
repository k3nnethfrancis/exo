import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldIgnoreWorkspaceChange, WorkspaceWatcherService } from "./workspace-watchers";
import type { WorkspaceChangeEvent } from "./workspace-watchers";

afterEach(() => vi.useRealTimers());

describe("workspace watcher filtering", () => {
  const rootPath = "/workspace/exo";

  it("keeps source and note changes visible to the workspace", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/src/App.tsx")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/issues.md")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, null)).toBe(false);
  });

  it("drops noisy generated and vendor changes before they churn the renderer", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/.git/index")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/node_modules/.vite/deps.ts")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/.exo/server.json")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/dist/index.js")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/coverage/index.html")).toBe(true);
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
      rootPath: "/workspace/exo",
      eventType: "change",
      filePath: "/workspace/exo/issues.md",
    });
    await vi.advanceTimersByTimeAsync(120);

    expect(first).toHaveBeenCalledWith({
      rootPath: "/workspace/exo",
      eventType: "change",
      filePath: "/workspace/exo/issues.md",
    });
    expect(second).toHaveBeenCalledWith({
      rootPath: "/workspace/exo",
      eventType: "change",
      filePath: "/workspace/exo/issues.md",
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
      rootPath: "/workspace/exo",
      eventType: "change",
      filePath: "/workspace/exo/issues.md",
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

  it("observes the canonical ontology file outside a nested Note Root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-ontology-watch-"));
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
