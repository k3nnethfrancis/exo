import path from "node:path";
import { existsSync, watch, type FSWatcher } from "node:fs";

import { isWorkspaceOntologyPath, type WorkspaceModel } from "@exograph/core";

export interface WorkspaceChangeEvent {
  rootPath: string;
  eventType: string;
  filePath: string | null;
}

export type WorkspaceChangeListener = (event: WorkspaceChangeEvent) => void;

export interface WorkspaceWatcherRuntimeError {
  generation: number;
  rootPath: string;
  errorMessage: string;
}

export interface WorkspaceWatcherServiceOptions {
  /** Internal main-process seam; not a renderer, CLI, or command-server API. */
  onRuntimeError?: (error: WorkspaceWatcherRuntimeError) => void;
  createWatcher?: typeof watch;
}

export interface StagedWorkspaceWatchers {
  commit(): void;
  abort(): void;
}

const IGNORED_WORKSPACE_PATH_SEGMENTS = new Set([
  ".DS_Store",
  ".cache",
  ".exograph",
  ".exograph-dev",
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

  constructor(
    onChange?: WorkspaceChangeListener,
    private readonly options: WorkspaceWatcherServiceOptions = {},
  ) {
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

  start(model: WorkspaceModel, workspaceGeneration = ++this.nextGeneration): void {
    this.stage(model, workspaceGeneration).commit();
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
    const createWatcher = this.options.createWatcher ?? watch;

    const rootPaths = model.noteRoots.map((root) => root.path);
    const uniqueRootPaths = [...new Set(rootPaths)];

    for (const rootPath of uniqueRootPaths) {
      if (!existsSync(rootPath)) {
        closeWatchers(watchers);
        throw new Error(`Required workspace note root does not exist: ${rootPath}`);
      }

      try {
        const watcher = createWatcher(rootPath, { recursive: true }, (eventType, filename) => {
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

        watcher.on("error", (error) => this.reportLateWatcherError(generation, rootPath, error));

        watchers.push(watcher);
      } catch (error) {
        closeWatchers(watchers);
        throw new Error(`Required workspace watcher setup failed for ${rootPath}: ${errorMessageFor(error)}`);
      }
    }

    const workspaceRoot = path.resolve(model.workspaceRoot);
    if (!uniqueRootPaths.some((rootPath) => path.resolve(rootPath) === workspaceRoot) && existsSync(workspaceRoot)) {
      try {
        const watcher = createWatcher(workspaceRoot, { recursive: true }, (eventType, filename) => {
          const filePath = typeof filename === "string" && filename.length > 0 ? path.join(workspaceRoot, filename) : null;
          if (!filePath || !isWorkspaceOntologyPath(workspaceRoot, filePath)) return;
          this.queue({ rootPath: workspaceRoot, eventType, filePath }, generation);
        });
        watcher.on("error", (error) => this.reportLateWatcherError(generation, workspaceRoot, error));
        watchers.push(watcher);
      } catch (error) {
        console.warn("[exograph] ontology watcher setup failed", {
          rootPath: workspaceRoot,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return watchers;
  }

  private reportLateWatcherError(generation: number, rootPath: string, error: unknown): void {
    if (generation !== this.activeGeneration) return;
    const errorMessage = errorMessageFor(error);
    console.warn("[exograph] workspace watcher error", { rootPath, error: errorMessage });
    this.options.onRuntimeError?.({ generation, rootPath, errorMessage });
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

function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function closeWatchers(watchers: FSWatcher[]): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch (error) {
      // Closing an already-dead kernel watcher must never turn a committed
      // Workspace transition into a false failure after discovery is live.
      console.warn("[exograph] workspace watcher close failed", error);
    }
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
