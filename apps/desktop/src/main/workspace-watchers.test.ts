import { describe, expect, it, vi } from "vitest";

import { shouldIgnoreWorkspaceChange, WorkspaceWatcherService } from "./workspace-watchers";
import type { WorkspaceChangeEvent } from "./workspace-watchers";

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
});

function queueForTest(service: WorkspaceWatcherService, event: WorkspaceChangeEvent): void {
  (service as unknown as { queue: (nextEvent: WorkspaceChangeEvent) => void }).queue(event);
}
