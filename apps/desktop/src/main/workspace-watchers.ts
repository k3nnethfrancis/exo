import path from "node:path";
import { existsSync, watch, type FSWatcher } from "node:fs";

import { isWorkspaceOntologyPath, type WorkspaceModel } from "@exo/core";

export interface WorkspaceChangeEvent {
  rootPath: string;
  eventType: string;
  filePath: string | null;
}

export type WorkspaceChangeListener = (event: WorkspaceChangeEvent) => void;

export interface StagedWorkspaceWatchers {
  commit(): void;
  abort(): void;
}

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
  private activeGeneration = 0;
  private nextGeneration = 0;

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
    this.stage(model).commit();
  }

  /**
   * Opens destination watchers without replacing the current Workspace. The
   * coordinator commits this only after every other critical resource staged.
   */
  stage(model: WorkspaceModel, workspaceGeneration = ++this.nextGeneration): StagedWorkspaceWatchers {
    const generation = workspaceGeneration;
    this.nextGeneration = Math.max(this.nextGeneration, generation);
    const watchers = this.createWatchers(model, generation);
    let settled = false;

    return {
      commit: () => {
        if (settled) return;
        settled = true;
        this.stopActiveWatchers();
        this.activeGeneration = generation;
        this.watchers = watchers;
      },
      abort: () => {
        if (settled) return;
        settled = true;
        closeWatchers(watchers);
      },
    };
  }

  private createWatchers(model: WorkspaceModel, generation: number): FSWatcher[] {
    const watchers: FSWatcher[] = [];

    const rootPaths = model.noteRoots.map((root) => root.path);
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
          }, generation);
        });

        watcher.on("error", (error) => {
          console.warn("[exo] workspace watcher error", {
            rootPath,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        watchers.push(watcher);
      } catch (error) {
        console.warn("[exo] workspace watcher setup failed", {
          rootPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const workspaceRoot = path.resolve(model.workspaceRoot);
    if (!uniqueRootPaths.some((rootPath) => path.resolve(rootPath) === workspaceRoot) && existsSync(workspaceRoot)) {
      try {
        const watcher = watch(workspaceRoot, (eventType, filename) => {
          const filePath = typeof filename === "string" && filename.length > 0 ? path.join(workspaceRoot, filename) : null;
          if (!filePath || !isWorkspaceOntologyPath(workspaceRoot, filePath)) return;
          this.queue({ rootPath: workspaceRoot, eventType, filePath }, generation);
        });
        watcher.on("error", (error) => {
          console.warn("[exo] ontology watcher error", {
            rootPath: workspaceRoot,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        watchers.push(watcher);
      } catch (error) {
        console.warn("[exo] ontology watcher setup failed", {
          rootPath: workspaceRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return watchers;
  }

  stop(): void {
    this.activeGeneration = ++this.nextGeneration;
    this.stopActiveWatchers();

    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.pendingEvents.clear();
  }

  private stopActiveWatchers(): void {
    closeWatchers(this.watchers);
    this.watchers = [];
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.pendingEvents.clear();
  }

  private queue(event: WorkspaceChangeEvent, generation = this.activeGeneration): void {
    if (generation !== this.activeGeneration) {
      return;
    }
    const key = `${event.rootPath}:${event.filePath ?? ""}:${event.eventType}`;
    this.pendingEvents.set(key, event);

    if (this.broadcastTimer) {
      return;
    }

    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      if (generation !== this.activeGeneration) {
        this.pendingEvents.clear();
        return;
      }
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

function closeWatchers(watchers: FSWatcher[]): void {
  for (const watcher of watchers) {
    watcher.close();
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
