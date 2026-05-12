import path from "node:path";
import { watch, type FSWatcher } from "node:fs";

import type { WorkspaceModel } from "@exo/core";

export interface WorkspaceChangeEvent {
  rootPath: string;
  eventType: string;
  filePath: string | null;
}

export class WorkspaceWatcherService {
  private watchers: FSWatcher[] = [];
  private pendingEvents = new Map<string, WorkspaceChangeEvent>();
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: (event: WorkspaceChangeEvent) => void) {}

  start(model: WorkspaceModel): void {
    this.stop();

    const rootPaths = [...model.noteRoots.map((root) => root.path), ...model.projectRoots.map((root) => root.path)];
    const uniqueRootPaths = [...new Set(rootPaths)];

    for (const rootPath of uniqueRootPaths) {
      try {
        const watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
          this.queue({
            rootPath,
            eventType,
            filePath: typeof filename === "string" && filename.length > 0 ? path.join(rootPath, filename) : null,
          });
        });

        watcher.on("error", (error) => {
          console.warn("[exo] workspace watcher error", {
            rootPath,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        this.watchers.push(watcher);
      } catch (error) {
        console.warn("[exo] workspace watcher setup failed", {
          rootPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.pendingEvents.clear();
  }

  private queue(event: WorkspaceChangeEvent): void {
    const key = `${event.rootPath}:${event.filePath ?? ""}:${event.eventType}`;
    this.pendingEvents.set(key, event);

    if (this.broadcastTimer) {
      return;
    }

    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const events = [...this.pendingEvents.values()];
      this.pendingEvents.clear();

      for (const nextEvent of events) {
        this.onChange(nextEvent);
      }
    }, 120);
  }
}
