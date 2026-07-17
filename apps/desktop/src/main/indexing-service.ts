import { app } from "electron";
import path from "node:path";

import {
  createIndexedRoot,
  type IndexedRoot,
  type IndexJobMetric,
  type IndexSearchOptions,
  type IndexStatus,
  type IndexSyncResult,
  type WorkspaceIndexSearchResponse,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import { UtilityDerivedIndexClient, type DerivedIndexClient } from "./derived-index-process";
import {
  createAutoEmbeddingSchedulerState,
  decideAutoEmbedding,
  disposeAutoEmbeddingScheduler,
  recordAutoEmbeddingActivity,
  recordAutoEmbeddingFailure,
  recordAutoEmbeddingSave,
  recordAutoEmbeddingSuccess,
  type AutoEmbeddingPolicy,
  type AutoEmbeddingSchedulerState,
} from "./indexing-auto-scheduler";

const DEFAULT_AUTO_EMBEDDING_POLICY: AutoEmbeddingPolicy = {
  quietPeriodMs: 45_000,
  idlePeriodMs: 10_000,
  maxPendingEmbeddings: 4,
  retryBaseDelayMs: 5_000,
  retryMaxDelayMs: 60_000,
  maxRetryAttempts: 3,
};

const AUTO_EMBED_OPTIONS = {
  maxDocuments: 4,
  maxDocsPerBatch: 1,
  maxDurationMs: 15_000,
} as const;

const MAINTENANCE_SEARCH_WARNING = "Index maintenance is running; showing Simple search results until it completes.";
const MAINTENANCE_STATUS_WARNING = "Index maintenance is running; showing the last available index status until it finishes.";

export interface IndexingServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
  getCurrentSettings: () => WorkspaceSettings;
  getRuntimeRoot: () => string;
  saveWorkspaceSettings: (settings: WorkspaceSettings) => Promise<WorkspaceSettings>;
  sendState: (event: { state: "running" | "idle" | "error"; reason: string; result?: IndexSyncResult; error?: string }) => void;
  errorMessage: (error: unknown) => string;
  foregroundDerivedIndex?: DerivedIndexClient;
  maintenanceDerivedIndex?: DerivedIndexClient;
  now?: () => number;
  getSystemIdleTimeMs?: () => number;
  autoEmbeddingPolicy?: AutoEmbeddingPolicy;
}

export class IndexingService {
  private indexSyncPromise: Promise<IndexSyncResult> | null = null;
  private indexSyncQueued = false;
  private indexRefreshTimer: NodeJS.Timeout | null = null;
  private indexRefreshPromise: Promise<IndexSyncResult> | null = null;
  private indexRefreshDue = false;
  private indexRefreshReason = "scheduled-refresh";
  private readonly pendingIndexRefreshRootIds = new Set<string>();
  private autoEmbeddingTimer: NodeJS.Timeout | null = null;
  private autoEmbeddingPromise: Promise<void> | null = null;
  private autoEmbeddingState: AutoEmbeddingSchedulerState = createAutoEmbeddingSchedulerState();
  private pendingEmbeddings = 0;
  private lastKnownStatus: IndexStatus | null = null;
  private lastKnownStatusWorkspaceRoot: string | null = null;
  private maintenanceWorkCount = 0;
  private foregroundWorkCount = 0;
  private readonly foregroundIdleWaiters = new Set<() => void>();
  private disposed = false;
  private indexJobSequence = 0;
  private readonly indexJobMetrics: IndexJobMetric[] = [];
  private readonly foregroundDerivedIndex: DerivedIndexClient;
  private readonly maintenanceDerivedIndex: DerivedIndexClient;
  private readonly now: () => number;
  private readonly getSystemIdleTimeMs: () => number;
  private readonly autoEmbeddingPolicy: AutoEmbeddingPolicy;

  constructor(private readonly options: IndexingServiceOptions) {
    this.foregroundDerivedIndex = options.foregroundDerivedIndex ?? new UtilityDerivedIndexClient();
    this.maintenanceDerivedIndex = options.maintenanceDerivedIndex ?? new UtilityDerivedIndexClient();
    this.now = options.now ?? Date.now;
    this.getSystemIdleTimeMs = options.getSystemIdleTimeMs ?? (() => 0);
    this.autoEmbeddingPolicy = options.autoEmbeddingPolicy ?? DEFAULT_AUTO_EMBEDDING_POLICY;
  }

  shouldUseIndex(model = this.options.getWorkspaceModel()): boolean {
    return model.searchEngine !== "filesystem" && model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0;
  }

  async getMeasuredStatus(): Promise<IndexStatus> {
    const model = this.options.getWorkspaceModel();
    if (this.maintenanceWorkCount > 0) {
      const cached = this.lastKnownStatusWorkspaceRoot === model.workspaceRoot ? this.lastKnownStatus : null;
      const status = cached ?? this.emptyMaintenanceStatus(model);
      return this.attachIndexJobMetrics({
        ...status,
        warnings: [...status.warnings, MAINTENANCE_STATUS_WARNING],
      });
    }
    this.foregroundWorkCount += 1;
    try {
      const status = await this.foregroundDerivedIndex.status(model, this.options.getRuntimeRoot());
      this.cacheStatus(status, model.workspaceRoot);
      return this.attachIndexJobMetrics(status);
    } finally {
      this.finishForegroundWork();
    }
  }

  async search(query: string, options: IndexSearchOptions = {}): Promise<WorkspaceIndexSearchResponse> {
    const maintenanceActive = this.maintenanceWorkCount > 0;
    const model = this.options.getWorkspaceModel();
    const searchModel = maintenanceActive
      ? { ...model, searchEngine: "filesystem" as const }
      : model;
    this.foregroundWorkCount += 1;
    try {
      const response = await this.foregroundDerivedIndex.search(searchModel, this.options.getRuntimeRoot(), query, options);
      return maintenanceActive
        ? { ...response, warnings: [...response.warnings, MAINTENANCE_SEARCH_WARNING] }
        : response;
    } finally {
      this.finishForegroundWork();
    }
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
    const startedAtMs = this.now();
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
    return this.runMeasuredStatusJob("update", reason, () => this.runMaintenance(() => (
      this.maintenanceDerivedIndex.update(this.options.getWorkspaceModel(), this.options.getRuntimeRoot())
    ))).then((status) => {
      this.observePendingEmbeddings(status);
      return status;
    });
  }

  embed(reason: string): Promise<IndexStatus> {
    return this.runMeasuredStatusJob("embed", reason, () => this.runMaintenance(() => (
      this.maintenanceDerivedIndex.embed(this.options.getWorkspaceModel(), this.options.getRuntimeRoot())
    ))).then((status) => {
      this.autoEmbeddingState = recordAutoEmbeddingSuccess(this.autoEmbeddingState);
      this.observePendingEmbeddings(status);
      return status;
    });
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

    this.autoEmbeddingState = recordAutoEmbeddingSave(this.autoEmbeddingState, this.now());
    this.scheduleRefresh(reason, matchingRootIds);
  }

  scheduleReconciliation(reason: string, delayMs = 0): void {
    if (!this.shouldAutomaticallyMaintainIndex()) {
      this.applyCurrentAutomaticPolicy();
      return;
    }
    this.clearAutomaticEmbeddingTimer();
    this.scheduleRefresh(reason, this.options.getWorkspaceModel().indexedRoots.map((root) => root.id), delayMs);
  }

  applyCurrentAutomaticPolicy(): void {
    if (this.shouldAutomaticallyMaintainIndex()) {
      this.scheduleAutomaticEmbeddingCheck();
      return;
    }
    if (this.indexRefreshTimer) clearTimeout(this.indexRefreshTimer);
    this.indexRefreshTimer = null;
    this.indexRefreshDue = false;
    this.pendingIndexRefreshRootIds.clear();
    this.clearAutomaticEmbeddingTimer();
  }

  shouldReconcileAfterSettingsApply(previous: WorkspaceSettings, next: WorkspaceSettings): boolean {
    if (next.searchEngine === "filesystem" || !next.indexing.enabled || next.indexing.mode === "off" || next.indexedRoots.length === 0) {
      return false;
    }
    return (
      previous.searchEngine === "filesystem" ||
      !previous.indexing.enabled ||
      (previous.indexUpdateStrategy !== "on-save" && next.indexUpdateStrategy === "on-save") ||
      previous.indexing.mode !== next.indexing.mode ||
      JSON.stringify(previous.indexedRoots.map((root) => root.path).sort()) !== JSON.stringify(next.indexedRoots.map((root) => root.path).sort())
    );
  }

  async runSync(reason: string): Promise<IndexSyncResult> {
    if (!this.shouldUseIndex()) {
      throw new Error("Indexing is disabled or has no indexed roots.");
    }
    if (this.indexSyncPromise) {
      this.indexSyncQueued = true;
      return this.indexSyncPromise;
    }

    const startedAtMs = this.now();
    this.options.sendState({ state: "running", reason });
    this.indexSyncPromise = this.runMaintenance(() => (
      this.maintenanceDerivedIndex.sync(this.options.getWorkspaceModel(), this.options.getRuntimeRoot())
    ))
      .then((result) => {
        this.autoEmbeddingState = recordAutoEmbeddingSuccess(this.autoEmbeddingState);
        this.observePendingEmbeddings(result.status);
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
        } else {
          this.drainScheduledRefresh();
        }
      });

    return this.indexSyncPromise;
  }

  private scheduleRefresh(reason: string, rootIds: string[], delayMs = 15_000) {
    if (this.disposed) return;
    for (const rootId of rootIds) {
      this.pendingIndexRefreshRootIds.add(rootId);
    }
    this.indexRefreshReason = reason;
    if (this.indexRefreshDue) {
      this.drainScheduledRefresh();
      return;
    }
    if (this.indexRefreshTimer) {
      clearTimeout(this.indexRefreshTimer);
    }
    this.indexRefreshTimer = setTimeout(() => {
      this.indexRefreshTimer = null;
      this.indexRefreshDue = true;
      this.drainScheduledRefresh();
    }, delayMs);
  }

  private drainScheduledRefresh(): void {
    if (
      this.disposed
      || !this.indexRefreshDue
      || this.indexRefreshPromise
      || this.indexSyncPromise
      || this.autoEmbeddingPromise
      || this.maintenanceWorkCount > 0
    ) return;
    if (!this.shouldAutomaticallyMaintainIndex()) {
      this.indexRefreshDue = false;
      this.pendingIndexRefreshRootIds.clear();
      return;
    }
    const rootIds = Array.from(this.pendingIndexRefreshRootIds);
    if (rootIds.length === 0) {
      this.indexRefreshDue = false;
      return;
    }
    const reason = this.indexRefreshReason;
    this.indexRefreshDue = false;
    this.pendingIndexRefreshRootIds.clear();
    void this.runRefresh(reason, rootIds).catch((error) => {
      console.warn("[exo] index refresh failed", error);
    });
  }

  private runRefresh(reason: string, rootIds: string[]): Promise<IndexSyncResult> {
    const model = this.options.getWorkspaceModel();
    const startedAtMs = this.now();
    this.options.sendState({ state: "running", reason });
    this.indexRefreshPromise = this.runMaintenance(() => (
      this.maintenanceDerivedIndex.update(model, this.options.getRuntimeRoot(), rootIds)
    ))
      .then((status) => {
        this.observePendingEmbeddings(status);
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
              message: model.indexing.mode === "lexical"
                ? "Embeddings are not needed in lexical mode."
                : "Embeddings will catch up automatically after Exo becomes quiet and idle.",
            },
          ],
          warnings:
            model.indexing.mode === "lexical" || status.pendingEmbeddings === 0
              ? []
              : [`${status.pendingEmbeddings} embedding${status.pendingEmbeddings === 1 ? " is" : "s are"} waiting for automatic catch-up.`],
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
        if (this.indexRefreshDue) this.drainScheduledRefresh();
        this.scheduleAutomaticEmbeddingCheck();
      });

    return this.indexRefreshPromise;
  }

  private observePendingEmbeddings(status: IndexStatus): void {
    this.pendingEmbeddings = Math.max(0, status.pendingEmbeddings);
    this.cacheStatus(status, this.options.getWorkspaceModel().workspaceRoot);
    this.scheduleAutomaticEmbeddingCheck();
  }

  private scheduleAutomaticEmbeddingCheck(): void {
    this.clearAutomaticEmbeddingTimer();
    if (
      this.disposed
      || this.autoEmbeddingPromise
      || this.indexRefreshPromise
      || this.indexRefreshDue
      || this.indexSyncPromise
    ) return;

    const nowMs = this.now();
    const idleTimeMs = Math.max(0, this.getSystemIdleTimeMs());
    this.autoEmbeddingState = recordAutoEmbeddingActivity(this.autoEmbeddingState, nowMs - idleTimeMs);
    const model = this.options.getWorkspaceModel();
    const decision = decideAutoEmbedding(this.autoEmbeddingState, {
      nowMs,
      indexMode: model.indexing.mode,
      updateStrategy: this.options.getCurrentSettings().indexUpdateStrategy,
      pendingEmbeddings: this.pendingEmbeddings,
      foregroundWorkActive: this.foregroundWorkCount > 0,
      maintenanceActive: this.maintenanceWorkCount > 0,
    }, this.autoEmbeddingPolicy);

    if (decision.action === "run") {
      void this.runAutomaticEmbedding();
      return;
    }
    if (decision.action === "wait" && decision.reconsiderAtMs !== undefined) {
      this.autoEmbeddingTimer = setTimeout(
        () => {
          this.autoEmbeddingTimer = null;
          this.scheduleAutomaticEmbeddingCheck();
        },
        Math.max(1, decision.reconsiderAtMs - nowMs),
      );
    }
  }

  private async runAutomaticEmbedding(): Promise<void> {
    if (this.disposed || this.autoEmbeddingPromise) return;
    const reason = "automatic-embedding";
    const startedAtMs = this.now();
    const pendingBefore = this.pendingEmbeddings;
    this.options.sendState({ state: "running", reason });
    this.autoEmbeddingPromise = this.runMaintenance(() => (
      this.maintenanceDerivedIndex.embed(
        this.options.getWorkspaceModel(),
        this.options.getRuntimeRoot(),
        AUTO_EMBED_OPTIONS,
      )
    ))
      .then((status) => {
        const reportedPending = Math.max(0, status.pendingEmbeddings);
        this.pendingEmbeddings = status.errors.length > 0
          ? Math.max(pendingBefore, reportedPending)
          : reportedPending;
        this.cacheStatus(status, this.options.getWorkspaceModel().workspaceRoot);
        if (status.errors.length > 0 || (this.pendingEmbeddings > 0 && this.pendingEmbeddings >= pendingBefore)) {
          throw new Error(status.errors[0] ?? "Automatic embedding made no progress.");
        }
        this.autoEmbeddingState = recordAutoEmbeddingSuccess(this.autoEmbeddingState);
        this.autoEmbeddingState = recordAutoEmbeddingActivity(this.autoEmbeddingState, this.now());
        this.recordIndexJob("embed", reason, startedAtMs, "completed", status);
        const result: IndexSyncResult = {
          status: this.attachIndexJobMetrics(status),
          phases: [{ name: "embed", status: "completed", message: "Pending embeddings caught up while Exo was idle." }],
          warnings: [],
        };
        this.options.sendState({ state: "idle", reason, result });
      })
      .catch((error) => {
        this.autoEmbeddingState = recordAutoEmbeddingFailure(
          this.autoEmbeddingState,
          this.now(),
          this.autoEmbeddingPolicy,
        );
        this.recordIndexJob("embed", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({ state: "error", reason, error: this.options.errorMessage(error) });
      })
      .finally(() => {
        this.autoEmbeddingPromise = null;
        this.drainScheduledRefresh();
        this.scheduleAutomaticEmbeddingCheck();
      });
    await this.autoEmbeddingPromise;
  }

  private async runMaintenance<Result>(run: () => Promise<Result>): Promise<Result> {
    if (this.disposed) throw new Error("Indexing service has been disposed.");
    this.maintenanceWorkCount += 1;
    this.clearAutomaticEmbeddingTimer();
    try {
      await this.waitForForegroundIdle();
      if (this.disposed) throw new Error("Indexing service has been disposed.");
      return await run();
    } finally {
      this.maintenanceWorkCount -= 1;
      if (this.maintenanceWorkCount === 0) {
        this.drainScheduledRefresh();
        this.scheduleAutomaticEmbeddingCheck();
      }
    }
  }

  private waitForForegroundIdle(): Promise<void> {
    if (this.foregroundWorkCount === 0) return Promise.resolve();
    return new Promise((resolve) => this.foregroundIdleWaiters.add(resolve));
  }

  private finishForegroundWork(): void {
    this.foregroundWorkCount -= 1;
    if (this.foregroundWorkCount !== 0) return;
    for (const resolve of this.foregroundIdleWaiters) resolve();
    this.foregroundIdleWaiters.clear();
    this.scheduleAutomaticEmbeddingCheck();
  }

  private shouldAutomaticallyMaintainIndex(): boolean {
    return this.options.getCurrentSettings().indexUpdateStrategy === "on-save" && this.shouldUseIndex();
  }

  private clearAutomaticEmbeddingTimer(): void {
    if (this.autoEmbeddingTimer) clearTimeout(this.autoEmbeddingTimer);
    this.autoEmbeddingTimer = null;
  }

  private cacheStatus(status: IndexStatus, workspaceRoot: string): void {
    this.lastKnownStatus = status;
    this.lastKnownStatusWorkspaceRoot = workspaceRoot;
  }

  private emptyMaintenanceStatus(model: WorkspaceModel): IndexStatus {
    const runtimePath = path.join(this.options.getRuntimeRoot(), "qmd");
    return {
      enabled: model.indexing.enabled,
      mode: model.indexing.mode,
      backend: model.indexing.backend,
      dbPath: path.join(runtimePath, "index.sqlite"),
      runtimePath,
      indexedRoots: model.indexedRoots,
      documentCount: 0,
      pendingEmbeddings: this.pendingEmbeddings,
      hasVectorIndex: false,
      lastUpdated: null,
      warnings: [],
      errors: [],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.indexRefreshTimer) clearTimeout(this.indexRefreshTimer);
    this.clearAutomaticEmbeddingTimer();
    this.indexRefreshTimer = null;
    this.indexRefreshDue = false;
    this.pendingIndexRefreshRootIds.clear();
    this.autoEmbeddingState = disposeAutoEmbeddingScheduler(this.autoEmbeddingState);
    for (const resolve of this.foregroundIdleWaiters) resolve();
    this.foregroundIdleWaiters.clear();
    for (const client of new Set([this.foregroundDerivedIndex, this.maintenanceDerivedIndex])) {
      client.dispose();
    }
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
    const completedAtMs = this.now();
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
