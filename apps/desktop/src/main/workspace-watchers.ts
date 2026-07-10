import path from "node:path";
import { existsSync, watch, type FSWatcher } from "node:fs";

import type { WorkspaceModel } from "@exo/core";

export interface WorkspaceChangeEvent {
  rootPath: string;
  eventType: string;
  filePath: string | null;
}

export type WorkspaceChangeListener = (event: WorkspaceChangeEvent) => void;

const IGNORED_WORKSPACE_PATH_SEGMENTS = new Set([
  ".DS_Store",
  ".cache",
  ".exo",
  ".exo-dev",
  ".git",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".turbo",
  ".venv",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "tmp",
]);

export class WorkspaceWatcherService {
  private watchers: FSWatcher[] = [];
  private pendingEvents = new Map<string, WorkspaceChangeEvent>();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<WorkspaceChangeListener>();

  constructor(onChange?: WorkspaceChangeListener) {
    if (onChange) {
      this.listeners.add(onChange);
    }
  }

  subscribe(listener: WorkspaceChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(model: WorkspaceModel): void {
    this.stop();

    const rootPaths = [...model.noteRoots.map((root) => root.path), ...model.projectRoots.map((root) => root.path)];
    const uniqueRootPaths = [...new Set(rootPaths)];

    for (const rootPath of uniqueRootPaths) {
      if (!existsSync(rootPath)) {
        continue;
      }

      try {
        const watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
          const filePath = typeof filename === "string" && filename.length > 0 ? path.join(rootPath, filename) : null;
          if (shouldIgnoreWorkspaceChange(rootPath, filePath)) {
            return;
          }

          this.queue({
            rootPath,
            eventType,
            filePath,
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
        for (const listener of this.listeners) {
          listener(nextEvent);
        }
      }
    }, 120);
  }
}

export function shouldIgnoreWorkspaceChange(rootPath: string, filePath: string | null): boolean {
  if (!filePath) {
    return false;
  }

  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }

  return relativePath
    .split(path.sep)
    .some((segment) => IGNORED_WORKSPACE_PATH_SEGMENTS.has(segment));
}
