import { app } from "electron";
import path from "node:path";

import {
  createIndexedRoot,
  embedIndex,
  getIndexStatus,
  syncIndex,
  updateIndex,
  type IndexedRoot,
  type IndexJobMetric,
  type IndexStatus,
  type IndexSyncResult,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

export interface IndexingServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
  getCurrentSettings: () => WorkspaceSettings;
  getRuntimeRoot: () => string;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
  sendState: (event: { state: "running" | "idle" | "error"; reason: string; result?: IndexSyncResult; error?: string }) => void;
  errorMessage: (error: unknown) => string;
}

export class IndexingService {
  private indexSyncTimer: NodeJS.Timeout | null = null;
  private indexSyncPromise: Promise<IndexSyncResult> | null = null;
  private indexSyncQueued = false;
  private indexRefreshTimer: NodeJS.Timeout | null = null;
  private indexRefreshPromise: Promise<IndexSyncResult> | null = null;
  private readonly pendingIndexRefreshRootIds = new Set<string>();
  private indexJobSequence = 0;
  private readonly indexJobMetrics: IndexJobMetric[] = [];

  constructor(private readonly options: IndexingServiceOptions) {}

  shouldUseIndex(model = this.options.getWorkspaceModel()): boolean {
    return model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0;
  }

  async getMeasuredStatus(): Promise<IndexStatus> {
    const status = await getIndexStatus(this.options.getWorkspaceModel(), this.options.getRuntimeRoot());
    return this.attachIndexJobMetrics(status);
  }

  async addRoot(input: { path?: string; name?: string; kind?: string; pattern?: string; ignore?: string[]; force?: boolean }): Promise<WorkspaceSettings> {
    if (!input.path) {
      throw new Error("Missing indexed root path.");
    }
    const settings = this.options.getCurrentSettings();
    const root = createIndexedRoot(input.path, {
      id: input.name ? `index-${input.name}` : undefined,
      label: input.name,
      kind: parseIndexedRootKind(input.kind),
      pattern: input.pattern,
      ignore: input.ignore,
    });
    if (!input.force && isBroadIndexedRoot(root.path)) {
      throw new Error("Refusing to index a broad system folder. Choose a notes folder or pass force.");
    }
    const nextRoots = [
      ...settings.indexedRoots.filter((entry) => path.resolve(entry.path) !== path.resolve(root.path)),
      root,
    ];
    return this.options.saveWorkspaceSettings({
      ...settings,
      indexedRoots: nextRoots,
      indexing: { enabled: true, mode: settings.indexing.mode === "off" ? "lexical" : settings.indexing.mode, backend: "qmd" },
    });
  }

  async removeRoot(target: string): Promise<WorkspaceSettings> {
    if (!target) {
      throw new Error("Missing indexed root target.");
    }
    const settings = this.options.getCurrentSettings();
    const resolvedTarget = path.resolve(target);
    const nextRoots = settings.indexedRoots.filter(
      (root) => root.id !== target && root.path !== target && path.resolve(root.path) !== resolvedTarget,
    );
    return this.options.saveWorkspaceSettings({
      ...settings,
      indexedRoots: nextRoots,
      indexing: nextRoots.length === 0 ? { enabled: false, mode: "off", backend: "qmd" } : settings.indexing,
    });
  }

  async runMeasuredStatusJob(
    kind: IndexJobMetric["kind"],
    reason: string,
    run: () => Promise<IndexStatus>,
  ): Promise<IndexStatus> {
    const startedAtMs = Date.now();
    try {
      const status = await run();
      this.recordIndexJob(kind, reason, startedAtMs, "completed", status);
      return this.attachIndexJobMetrics(status);
    } catch (error) {
      this.recordIndexJob(kind, reason, startedAtMs, "failed", undefined, [], error);
      throw error;
    }
  }

  update(reason: string): Promise<IndexStatus> {
    return this.runMeasuredStatusJob("update", reason, () => updateIndex(this.options.getWorkspaceModel(), this.options.getRuntimeRoot()));
  }

  embed(reason: string): Promise<IndexStatus> {
    return this.runMeasuredStatusJob("embed", reason, () => embedIndex(this.options.getWorkspaceModel(), this.options.getRuntimeRoot()));
  }

  scheduleForFile(filePath: string, reason: string) {
    const settings = this.options.getCurrentSettings();
    if (settings.indexUpdateStrategy !== "on-save" || !this.shouldUseIndex()) {
      return;
    }
    const model = this.options.getWorkspaceModel();
    const matchingRootIds = model.indexedRoots
      .filter((root) => isPathWithin(root.path, filePath))
      .map((root) => root.id);
    if (matchingRootIds.length === 0) {
      return;
    }

    if (model.indexing.mode === "lexical") {
      this.scheduleRefresh(reason, matchingRootIds);
      return;
    }

    this.scheduleSync(reason);
  }

  shouldSyncAfterSettingsApply(previous: WorkspaceSettings, next: WorkspaceSettings): boolean {
    if (!next.indexing.enabled || next.indexing.mode === "off" || next.indexedRoots.length === 0) {
      return false;
    }
    return (
      !previous.indexing.enabled ||
      previous.indexing.mode !== next.indexing.mode ||
      JSON.stringify(previous.indexedRoots.map((root) => root.path).sort()) !== JSON.stringify(next.indexedRoots.map((root) => root.path).sort())
    );
  }

  scheduleSync(reason: string, delayMs = 15_000) {
    if (this.indexSyncTimer) {
      clearTimeout(this.indexSyncTimer);
    }
    this.indexSyncTimer = setTimeout(() => {
      this.indexSyncTimer = null;
      this.runSync(reason).catch((error) => {
        console.warn("[exo] index sync failed", error);
      });
    }, delayMs);
  }

  async runSync(reason: string): Promise<IndexSyncResult> {
    if (!this.shouldUseIndex()) {
      throw new Error("Indexing is disabled or has no indexed roots.");
    }
    if (this.indexSyncPromise) {
      this.indexSyncQueued = true;
      return this.indexSyncPromise;
    }

    const startedAtMs = Date.now();
    this.options.sendState({ state: "running", reason });
    this.indexSyncPromise = syncIndex(this.options.getWorkspaceModel(), this.options.getRuntimeRoot())
      .then((result) => {
        this.recordIndexJob("sync", reason, startedAtMs, "completed", result.status, result.warnings);
        const measuredResult = { ...result, status: this.attachIndexJobMetrics(result.status) };
        this.options.sendState({ state: "idle", reason, result: measuredResult });
        return measuredResult;
      })
      .catch((error) => {
        this.recordIndexJob("sync", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({
          state: "error",
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        this.indexSyncPromise = null;
        if (this.indexSyncQueued) {
          this.indexSyncQueued = false;
          this.runSync("queued").catch((error) => {
            console.warn("[exo] queued index sync failed", error);
          });
        }
      });

    return this.indexSyncPromise;
  }

  private scheduleRefresh(reason: string, rootIds: string[], delayMs = 15_000) {
    for (const rootId of rootIds) {
      this.pendingIndexRefreshRootIds.add(rootId);
    }
    if (this.indexRefreshTimer) {
      clearTimeout(this.indexRefreshTimer);
    }
    this.indexRefreshTimer = setTimeout(() => {
      this.indexRefreshTimer = null;
      const refreshRootIds = Array.from(this.pendingIndexRefreshRootIds);
      this.pendingIndexRefreshRootIds.clear();
      this.runRefresh(reason, refreshRootIds).catch((error) => {
        console.warn("[exo] index refresh failed", error);
      });
    }, delayMs);
  }

  private async runRefresh(reason: string, rootIds: string[]): Promise<IndexSyncResult> {
    if (!this.shouldUseIndex()) {
      throw new Error("Indexing is disabled or has no indexed roots.");
    }
    if (this.indexSyncPromise) {
      return this.indexSyncPromise;
    }
    if (this.indexRefreshPromise) {
      return this.indexRefreshPromise;
    }

    const model = this.options.getWorkspaceModel();
    const startedAtMs = Date.now();
    this.options.sendState({ state: "running", reason });
    this.indexRefreshPromise = updateIndex(model, this.options.getRuntimeRoot(), { rootIds })
      .then((status) => {
        const result: IndexSyncResult = {
          status,
          phases: [
            {
              name: "update",
              status: "completed",
              message: "Indexed documents refreshed for changed root.",
            },
            {
              name: "embed",
              status: "skipped",
              message: "Embeddings are deferred on save; use Sync index to rebuild them.",
            },
          ],
          warnings:
            model.indexing.mode === "lexical"
              ? []
              : ["Save-triggered indexing refreshed documents only; embeddings remain available from the previous sync until rebuilt."],
        };
        this.recordIndexJob("update", reason, startedAtMs, "completed", status, result.warnings);
        const measuredResult = { ...result, status: this.attachIndexJobMetrics(status) };
        this.options.sendState({ state: "idle", reason, result: measuredResult });
        return measuredResult;
      })
      .catch((error) => {
        this.recordIndexJob("update", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({
          state: "error",
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        this.indexRefreshPromise = null;
      });

    return this.indexRefreshPromise;
  }

  private attachIndexJobMetrics(status: IndexStatus): IndexStatus {
    return { ...status, recentJobs: this.indexJobMetrics.slice(0, 8) };
  }

  private recordIndexJob(
    kind: IndexJobMetric["kind"],
    reason: string,
    startedAtMs: number,
    status: "completed" | "failed",
    resultStatus?: IndexStatus,
    warnings: string[] = [],
    error?: unknown,
  ) {
    const completedAtMs = Date.now();
    const metric: IndexJobMetric = {
      id: `index-job-${++this.indexJobSequence}`,
      kind,
      reason,
      status,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      documentCount: resultStatus?.documentCount,
      pendingEmbeddings: resultStatus?.pendingEmbeddings,
      warnings: [...(resultStatus?.warnings ?? []), ...warnings],
      error: error ? this.options.errorMessage(error) : undefined,
    };
    this.indexJobMetrics.unshift(metric);
    this.indexJobMetrics.splice(20);
  }
}

function parseIndexedRootKind(value: string | undefined): IndexedRoot["kind"] {
  return value === "notes" || value === "docs" || value === "code" || value === "mixed" ? value : "mixed";
}

function isBroadIndexedRoot(targetPath: string): boolean {
  const resolvedPath = path.resolve(targetPath);
  return [app.getPath("home"), app.getPath("desktop"), app.getPath("documents")]
    .some((candidate) => path.resolve(candidate) === resolvedPath);
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
