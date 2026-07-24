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
  hasExhaustedAutoEmbeddingRetries,
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
  foregroundDerivedIndexFactory?: () => DerivedIndexClient;
  maintenanceDerivedIndex?: DerivedIndexClient;
  /** Creates an isolated maintenance worker for each Workspace generation. */
  maintenanceDerivedIndexFactory?: () => DerivedIndexClient;
  now?: () => number;
  getSystemIdleTimeMs?: () => number;
  autoEmbeddingPolicy?: AutoEmbeddingPolicy;
}

export interface IndexingWorkspaceActivation {
  model: WorkspaceModel;
  settings: WorkspaceSettings;
  runtimeRoot: string;
}

interface IndexingWorkspaceScope extends IndexingWorkspaceActivation {
  generation: number;
  maintenanceAbortController: AbortController;
}

/**
 * Every asynchronous index operation belongs to exactly one Workspace
 * generation. Swapping this object on activation makes it impossible for a
 * held request from A to occupy B's queue, cache, or renderer state.
 */
interface WorkspaceMaintenanceState {
  scope: IndexingWorkspaceScope;
  indexSyncPromise: Promise<IndexSyncResult> | null;
  indexSyncQueued: boolean;
  indexRefreshTimer: NodeJS.Timeout | null;
  indexRefreshPromise: Promise<IndexSyncResult> | null;
  indexRefreshDue: boolean;
  indexRefreshReason: string;
  pendingIndexRefreshRootIds: Set<string>;
  autoEmbeddingTimer: NodeJS.Timeout | null;
  autoEmbeddingPromise: Promise<void> | null;
  autoEmbeddingState: AutoEmbeddingSchedulerState;
  pendingEmbeddings: number;
  lastKnownStatus: IndexStatus | null;
  lastKnownStatusWorkspaceRoot: string | null;
  maintenanceWorkCount: number;
  foregroundWorkCount: number;
  foregroundIdleWaiters: Set<() => void>;
  foregroundAbortController: AbortController;
  indexJobSequence: number;
  indexJobMetrics: IndexJobMetric[];
}

export class IndexingService {
  private disposed = false;
  private foregroundDerivedIndex: DerivedIndexClient;
  private readonly createForegroundDerivedIndex: (() => DerivedIndexClient) | null;
  private maintenanceDerivedIndex: DerivedIndexClient;
  private readonly createMaintenanceDerivedIndex: (() => DerivedIndexClient) | null;
  private readonly now: () => number;
  private readonly getSystemIdleTimeMs: () => number;
  private readonly autoEmbeddingPolicy: AutoEmbeddingPolicy;
  private workspaceGeneration = 0;
  private state: WorkspaceMaintenanceState;

  constructor(private readonly options: IndexingServiceOptions) {
    this.createForegroundDerivedIndex = options.foregroundDerivedIndexFactory
      ?? (options.foregroundDerivedIndex ? null : () => new UtilityDerivedIndexClient());
    this.foregroundDerivedIndex = this.createForegroundDerivedIndex
      ? this.createForegroundDerivedIndex()
      : options.foregroundDerivedIndex!;
    this.createMaintenanceDerivedIndex = options.maintenanceDerivedIndexFactory
      ?? (options.maintenanceDerivedIndex ? null : () => new UtilityDerivedIndexClient());
    this.maintenanceDerivedIndex = this.createMaintenanceDerivedIndex
      ? this.createMaintenanceDerivedIndex()
      : options.maintenanceDerivedIndex!;
    this.now = options.now ?? Date.now;
    this.getSystemIdleTimeMs = options.getSystemIdleTimeMs ?? (() => 0);
    this.autoEmbeddingPolicy = options.autoEmbeddingPolicy ?? DEFAULT_AUTO_EMBEDDING_POLICY;
    this.state = this.createMaintenanceState({
      model: options.getWorkspaceModel(),
      settings: options.getCurrentSettings(),
      runtimeRoot: options.getRuntimeRoot(),
    });
  }

  /** Rebinds maintenance to one immutable Workspace scope and aborts old work. */
  activateWorkspace(activation: IndexingWorkspaceActivation): void {
    const previousForegroundClient = this.foregroundDerivedIndex;
    const previousMaintenanceClient = this.maintenanceDerivedIndex;
    this.state.scope.maintenanceAbortController.abort();
    this.state.foregroundAbortController.abort();
    this.disposeMaintenanceState(this.state);
    // A utility process can be in a native/QMD call that only cooperatively
    // observes cancellation.  A new client is the generation boundary: B
    // never queues behind an uninterruptible A operation.
    if (this.createForegroundDerivedIndex) {
      this.foregroundDerivedIndex = this.createForegroundDerivedIndex();
      previousForegroundClient.dispose();
    }
    if (this.createMaintenanceDerivedIndex) {
      this.maintenanceDerivedIndex = this.createMaintenanceDerivedIndex();
      previousMaintenanceClient.dispose();
    }
    this.state = this.createMaintenanceState(activation);
    this.options.sendState({ state: "idle", reason: "workspace-activated" });
  }

  shouldUseIndex(model = this.state.scope.model): boolean {
    return model.searchEngine !== "filesystem" && model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0;
  }

  async getMeasuredStatus(): Promise<IndexStatus> {
    const state = this.state;
    const scope = state.scope;
    const model = scope.model;
    if (state.maintenanceWorkCount > 0) {
      const cached = state.lastKnownStatusWorkspaceRoot === model.workspaceRoot ? state.lastKnownStatus : null;
      const status = this.presentStatus(cached ?? this.emptyMaintenanceStatus(model));
      return this.attachIndexJobMetrics({
        ...status,
        warnings: [...status.warnings, MAINTENANCE_STATUS_WARNING],
      });
    }
    state.foregroundWorkCount += 1;
    try {
      const status = await this.foregroundDerivedIndex.status(model, scope.runtimeRoot, state.foregroundAbortController.signal);
      this.assertCurrentState(state);
      this.cacheStatus(state, status, model.workspaceRoot);
      return this.attachIndexJobMetrics(this.presentStatus(status));
    } finally {
      this.finishForegroundWork(state);
    }
  }

  async search(query: string, options: IndexSearchOptions = {}): Promise<WorkspaceIndexSearchResponse> {
    const state = this.state;
    const maintenanceActive = state.maintenanceWorkCount > 0;
    const scope = state.scope;
    const model = scope.model;
    const searchModel = maintenanceActive
      ? { ...model, searchEngine: "filesystem" as const }
      : model;
    state.foregroundWorkCount += 1;
    try {
      const response = await this.foregroundDerivedIndex.search(
        searchModel,
        scope.runtimeRoot,
        query,
        options,
        state.foregroundAbortController.signal,
      );
      this.assertCurrentState(state);
      return maintenanceActive
        ? { ...response, warnings: [...response.warnings, MAINTENANCE_SEARCH_WARNING] }
        : response;
    } finally {
      this.finishForegroundWork(state);
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

  private async runMeasuredStatusJob(
    state: WorkspaceMaintenanceState,
    kind: IndexJobMetric["kind"],
    reason: string,
    run: () => Promise<IndexStatus>,
  ): Promise<IndexStatus> {
    const startedAtMs = this.now();
    try {
      const status = await run();
      if (this.isCurrentState(state)) {
        this.recordIndexJob(state, kind, reason, startedAtMs, "completed", this.presentStatus(status));
      }
      return status;
    } catch (error) {
      if (this.isCurrentState(state) && !isAbortError(error)) {
        this.recordIndexJob(state, kind, reason, startedAtMs, "failed", undefined, [], error);
      }
      throw error;
    }
  }

  update(reason: string): Promise<IndexStatus> {
    const state = this.state;
    const scope = state.scope;
    return this.runMeasuredStatusJob(state, "update", reason, () => this.runMaintenance(state, () => (
      this.maintenanceDerivedIndex.update(scope.model, scope.runtimeRoot, undefined, scope.maintenanceAbortController.signal)
    ))).then((status) => {
      this.assertCurrentState(state);
      return this.attachIndexJobMetrics(this.presentStatus(this.observePendingEmbeddings(state, status)));
    });
  }

  embed(reason: string): Promise<IndexStatus> {
    const state = this.state;
    const scope = state.scope;
    return this.runMeasuredStatusJob(state, "embed", reason, () => this.runMaintenance(state, () => (
      this.maintenanceDerivedIndex.embed(scope.model, scope.runtimeRoot, undefined, scope.maintenanceAbortController.signal)
    ))).then((status) => {
      this.assertCurrentState(state);
      state.autoEmbeddingState = recordAutoEmbeddingSuccess(state.autoEmbeddingState);
      return this.attachIndexJobMetrics(this.presentStatus(this.observePendingEmbeddings(state, status)));
    });
  }

  scheduleForFile(filePath: string, reason: string) {
    const state = this.state;
    const { settings, model } = state.scope;
    if (settings.indexUpdateStrategy !== "on-save" || !this.shouldUseIndex()) {
      return;
    }
    const matchingRootIds = model.indexedRoots
      .filter((root) => isPathWithin(root.path, filePath))
      .map((root) => root.id);
    if (matchingRootIds.length === 0) {
      return;
    }

    state.autoEmbeddingState = recordAutoEmbeddingSave(state.autoEmbeddingState, this.now());
    this.scheduleRefresh(state, reason, matchingRootIds);
  }

  scheduleReconciliation(reason: string, delayMs = 0): void {
    if (!this.shouldAutomaticallyMaintainIndex()) {
      this.applyCurrentAutomaticPolicy();
      return;
    }
    this.clearAutomaticEmbeddingTimer(this.state);
    this.scheduleRefresh(this.state, reason, this.state.scope.model.indexedRoots.map((root) => root.id), delayMs);
  }

  applyCurrentAutomaticPolicy(): void {
    if (this.shouldAutomaticallyMaintainIndex()) {
      this.scheduleAutomaticEmbeddingCheck();
      return;
    }
    const state = this.state;
    if (state.indexRefreshTimer) clearTimeout(state.indexRefreshTimer);
    state.indexRefreshTimer = null;
    state.indexRefreshDue = false;
    state.pendingIndexRefreshRootIds.clear();
    this.clearAutomaticEmbeddingTimer(state);
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
    const state = this.state;
    const scope = state.scope;
    if (!this.shouldUseIndex()) {
      throw new Error("Indexing is disabled or has no indexed roots.");
    }
    if (state.indexSyncPromise) {
      state.indexSyncQueued = true;
      return state.indexSyncPromise;
    }

    const startedAtMs = this.now();
    this.options.sendState({ state: "running", reason });
    const sync = this.runMaintenance(state, () => (
      this.maintenanceDerivedIndex.sync(scope.model, scope.runtimeRoot, scope.maintenanceAbortController.signal)
    ))
      .then((result) => {
        if (!this.isCurrentState(state)) throw abortError();
        state.autoEmbeddingState = recordAutoEmbeddingSuccess(state.autoEmbeddingState);
        const rawStatus = this.observePendingEmbeddings(state, result.status);
        const status = this.presentStatus(rawStatus);
        this.recordIndexJob(state, "sync", reason, startedAtMs, "completed", status, result.warnings);
        const measuredResult = { ...result, status: this.attachIndexJobMetrics(status) };
        this.options.sendState({ state: "idle", reason, result: measuredResult });
        return measuredResult;
      })
      .catch((error) => {
        if (!this.isCurrentState(state) || isAbortError(error)) throw error;
        this.recordIndexJob(state, "sync", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({
          state: "error",
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        if (state.indexSyncPromise === sync) state.indexSyncPromise = null;
        if (!this.isCurrentState(state)) return;
        if (state.indexSyncQueued) {
          state.indexSyncQueued = false;
          this.runSync("queued").catch((error) => {
            console.warn("[exo] queued index sync failed", error);
          });
        } else {
          this.drainScheduledRefresh();
        }
      });
    state.indexSyncPromise = sync;
    return sync;
  }

  private scheduleRefresh(state: WorkspaceMaintenanceState, reason: string, rootIds: string[], delayMs = 15_000) {
    if (this.disposed || !this.isCurrentState(state)) return;
    for (const rootId of rootIds) {
      state.pendingIndexRefreshRootIds.add(rootId);
    }
    state.indexRefreshReason = reason;
    if (state.indexRefreshDue) {
      this.drainScheduledRefresh(state);
      return;
    }
    if (state.indexRefreshTimer) {
      clearTimeout(state.indexRefreshTimer);
    }
    state.indexRefreshTimer = setTimeout(() => {
      if (!this.isCurrentState(state)) return;
      state.indexRefreshTimer = null;
      state.indexRefreshDue = true;
      this.drainScheduledRefresh(state);
    }, delayMs);
  }

  private drainScheduledRefresh(state = this.state): void {
    if (
      this.disposed
      || !this.isCurrentState(state)
      || !state.indexRefreshDue
      || state.indexRefreshPromise
      || state.indexSyncPromise
      || state.autoEmbeddingPromise
      || state.maintenanceWorkCount > 0
    ) return;
    if (!this.shouldAutomaticallyMaintainIndex()) {
      state.indexRefreshDue = false;
      state.pendingIndexRefreshRootIds.clear();
      return;
    }
    const rootIds = Array.from(state.pendingIndexRefreshRootIds);
    if (rootIds.length === 0) {
      state.indexRefreshDue = false;
      return;
    }
    const reason = state.indexRefreshReason;
    state.indexRefreshDue = false;
    state.pendingIndexRefreshRootIds.clear();
    void this.runRefresh(state, reason, rootIds).catch((error) => {
      if (isAbortError(error)) return;
      console.warn("[exo] index refresh failed", error);
    });
  }

  private runRefresh(state: WorkspaceMaintenanceState, reason: string, rootIds: string[]): Promise<IndexSyncResult> {
    const scope = state.scope;
    const model = scope.model;
    const startedAtMs = this.now();
    this.options.sendState({ state: "running", reason });
    const refresh = this.runMaintenance(state, () => (
      this.maintenanceDerivedIndex.update(model, scope.runtimeRoot, rootIds, scope.maintenanceAbortController.signal)
    ))
      .then((rawStatus) => {
        if (!this.isCurrentState(state)) {
          return staleRefreshResult(rawStatus);
        }
        this.observePendingEmbeddings(state, rawStatus);
        const status = this.presentStatus(rawStatus);
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
        this.recordIndexJob(state, "update", reason, startedAtMs, "completed", status, result.warnings);
        const measuredResult = { ...result, status: this.attachIndexJobMetrics(status) };
        this.options.sendState({ state: "idle", reason, result: measuredResult });
        return measuredResult;
      })
      .catch((error) => {
        if (!this.isCurrentState(state) || isAbortError(error)) {
          return staleRefreshResult(this.emptyMaintenanceStatus(model));
        }
        this.recordIndexJob(state, "update", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({
          state: "error",
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        if (state.indexRefreshPromise === refresh) {
          state.indexRefreshPromise = null;
        }
        if (this.isCurrentState(state)) {
          if (state.indexRefreshDue) this.drainScheduledRefresh(state);
          this.scheduleAutomaticEmbeddingCheck(state);
        }
      });
    state.indexRefreshPromise = refresh;
    return refresh;
  }

  private observePendingEmbeddings(state: WorkspaceMaintenanceState, rawStatus: IndexStatus): IndexStatus {
    if (!this.isCurrentState(state)) return rawStatus;
    state.pendingEmbeddings = Math.max(0, rawStatus.pendingEmbeddings);
    this.cacheStatus(state, rawStatus, state.scope.model.workspaceRoot);
    this.scheduleAutomaticEmbeddingCheck(state);
    return rawStatus;
  }

  private scheduleAutomaticEmbeddingCheck(state = this.state): void {
    this.clearAutomaticEmbeddingTimer(state);
    if (
      this.disposed
      || !this.isCurrentState(state)
      || state.autoEmbeddingPromise
      || state.indexRefreshPromise
      || state.indexRefreshDue
      || state.indexSyncPromise
    ) return;

    const nowMs = this.now();
    const idleTimeMs = Math.max(0, this.getSystemIdleTimeMs());
    state.autoEmbeddingState = recordAutoEmbeddingActivity(state.autoEmbeddingState, nowMs - idleTimeMs);
    const model = state.scope.model;
    const decision = decideAutoEmbedding(state.autoEmbeddingState, {
      nowMs,
      indexMode: model.indexing.mode,
      updateStrategy: state.scope.settings.indexUpdateStrategy,
      pendingEmbeddings: state.pendingEmbeddings,
      foregroundWorkActive: state.foregroundWorkCount > 0,
      maintenanceActive: state.maintenanceWorkCount > 0,
    }, this.autoEmbeddingPolicy);

    if (decision.action === "run") {
      void this.runAutomaticEmbedding(state);
      return;
    }
    if (decision.action === "wait" && decision.reconsiderAtMs !== undefined) {
      state.autoEmbeddingTimer = setTimeout(
        () => {
          if (!this.isCurrentState(state)) return;
          state.autoEmbeddingTimer = null;
          this.scheduleAutomaticEmbeddingCheck(state);
        },
        Math.max(1, decision.reconsiderAtMs - nowMs),
      );
    }
  }

  private async runAutomaticEmbedding(state = this.state): Promise<void> {
    if (this.disposed || !this.isCurrentState(state) || state.autoEmbeddingPromise) return;
    const reason = "automatic-embedding";
    const startedAtMs = this.now();
    const pendingBefore = state.pendingEmbeddings;
    const scope = state.scope;
    this.options.sendState({ state: "running", reason });
    const embedding = this.runMaintenance(state, () => (
      this.maintenanceDerivedIndex.embed(
        scope.model,
        scope.runtimeRoot,
        AUTO_EMBED_OPTIONS,
        scope.maintenanceAbortController.signal,
      )
    ))
      .then((rawStatus) => {
        if (!this.isCurrentState(state)) return;
        const status = this.presentStatus(rawStatus);
        const reportedPending = Math.max(0, status.pendingEmbeddings);
        state.pendingEmbeddings = status.errors.length > 0
          ? Math.max(pendingBefore, reportedPending)
          : reportedPending;
        this.cacheStatus(state, rawStatus, scope.model.workspaceRoot);
        if (status.errors.length > 0 || (state.pendingEmbeddings > 0 && state.pendingEmbeddings >= pendingBefore)) {
          throw new Error(status.errors[0] ?? "Automatic embedding made no progress.");
        }
        state.autoEmbeddingState = recordAutoEmbeddingSuccess(state.autoEmbeddingState);
        state.autoEmbeddingState = recordAutoEmbeddingActivity(state.autoEmbeddingState, this.now());
        this.recordIndexJob(state, "embed", reason, startedAtMs, "completed", status);
        const result: IndexSyncResult = {
          status: this.attachIndexJobMetrics(status),
          phases: [{ name: "embed", status: "completed", message: "Pending embeddings caught up while Exo was idle." }],
          warnings: [],
        };
        this.options.sendState({ state: "idle", reason, result });
      })
      .catch((error) => {
        if (!this.isCurrentState(state) || isAbortError(error)) return;
        state.autoEmbeddingState = recordAutoEmbeddingFailure(
          state.autoEmbeddingState,
          this.now(),
          this.autoEmbeddingPolicy,
        );
        this.recordIndexJob(state, "embed", reason, startedAtMs, "failed", undefined, [], error);
        this.options.sendState({ state: "error", reason, error: this.options.errorMessage(error) });
      })
      .finally(() => {
        if (state.autoEmbeddingPromise === embedding) state.autoEmbeddingPromise = null;
        if (this.isCurrentState(state)) {
          this.drainScheduledRefresh(state);
          this.scheduleAutomaticEmbeddingCheck(state);
        }
      });
    state.autoEmbeddingPromise = embedding;
    await embedding;
  }

  private async runMaintenance<Result>(state: WorkspaceMaintenanceState, run: () => Promise<Result>): Promise<Result> {
    if (this.disposed) throw new Error("Indexing service has been disposed.");
    state.maintenanceWorkCount += 1;
    this.clearAutomaticEmbeddingTimer(state);
    try {
      await this.waitForForegroundIdle(state);
      if (this.disposed || !this.isCurrentState(state)) throw abortError();
      return await run();
    } finally {
      state.maintenanceWorkCount -= 1;
      if (state.maintenanceWorkCount === 0 && this.isCurrentState(state)) {
        this.drainScheduledRefresh(state);
        this.scheduleAutomaticEmbeddingCheck(state);
      }
    }
  }

  private waitForForegroundIdle(state: WorkspaceMaintenanceState): Promise<void> {
    if (state.foregroundWorkCount === 0) return Promise.resolve();
    return new Promise((resolve) => state.foregroundIdleWaiters.add(resolve));
  }

  private finishForegroundWork(state: WorkspaceMaintenanceState): void {
    state.foregroundWorkCount -= 1;
    if (state.foregroundWorkCount !== 0) return;
    for (const resolve of state.foregroundIdleWaiters) resolve();
    state.foregroundIdleWaiters.clear();
    this.scheduleAutomaticEmbeddingCheck(state);
  }

  private shouldAutomaticallyMaintainIndex(): boolean {
    return this.state.scope.settings.indexUpdateStrategy === "on-save" && this.shouldUseIndex();
  }

  private clearAutomaticEmbeddingTimer(state: WorkspaceMaintenanceState): void {
    if (state.autoEmbeddingTimer) clearTimeout(state.autoEmbeddingTimer);
    state.autoEmbeddingTimer = null;
  }

  private cacheStatus(state: WorkspaceMaintenanceState, status: IndexStatus, workspaceRoot: string): void {
    state.lastKnownStatus = status;
    state.lastKnownStatusWorkspaceRoot = workspaceRoot;
  }

  private presentStatus(status: IndexStatus): IndexStatus {
    if (status.pendingEmbeddings <= 0 || status.mode === "lexical") return status;
    const count = status.pendingEmbeddings;
    const subject = `${count} document hash${count === 1 ? "" : "es"}`;
    const need = count === 1 ? "needs" : "need";
    const strategy = this.state.scope.settings.indexUpdateStrategy;
    const policyWarning = hasExhaustedAutoEmbeddingRetries(this.state.autoEmbeddingState, this.autoEmbeddingPolicy)
      ? `${subject} ${need} embeddings; automatic catch-up failed after ${this.state.autoEmbeddingState.failureCount} attempts. Run Sync to repair it.`
      : strategy === "manual"
      ? `${subject} ${need} embeddings; automatic updates are paused.`
      : count > this.autoEmbeddingPolicy.maxPendingEmbeddings
        ? `${subject} ${need} embeddings; automatic catch-up only runs for ${this.autoEmbeddingPolicy.maxPendingEmbeddings} or fewer.`
        : `${subject} ${need} embeddings and ${count === 1 ? "is" : "are"} waiting for automatic catch-up.`;
    return { ...status, warnings: [...status.warnings, policyWarning] };
  }

  private emptyMaintenanceStatus(model: WorkspaceModel): IndexStatus {
    const runtimePath = path.join(this.state.scope.runtimeRoot, "qmd");
    return {
      enabled: model.indexing.enabled,
      mode: model.indexing.mode,
      backend: model.indexing.backend,
      dbPath: path.join(runtimePath, "index.sqlite"),
      runtimePath,
      indexedRoots: model.indexedRoots,
      documentCount: 0,
      pendingEmbeddings: this.state.pendingEmbeddings,
      hasVectorIndex: false,
      lastUpdated: null,
      warnings: [],
      errors: [],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state.scope.maintenanceAbortController.abort();
    this.state.foregroundAbortController.abort();
    this.disposeMaintenanceState(this.state);
    for (const client of new Set([this.foregroundDerivedIndex, this.maintenanceDerivedIndex])) {
      client.dispose();
    }
  }

  private attachIndexJobMetrics(status: IndexStatus, state = this.state): IndexStatus {
    return { ...status, recentJobs: state.indexJobMetrics.slice(0, 8) };
  }

  private recordIndexJob(
    state: WorkspaceMaintenanceState,
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
      id: `index-job-${++state.indexJobSequence}`,
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
    state.indexJobMetrics.unshift(metric);
    state.indexJobMetrics.splice(20);
  }

  private createWorkspaceScope(activation: IndexingWorkspaceActivation): IndexingWorkspaceScope {
    return {
      ...activation,
      generation: ++this.workspaceGeneration,
      maintenanceAbortController: new AbortController(),
    };
  }

  private createMaintenanceState(activation: IndexingWorkspaceActivation): WorkspaceMaintenanceState {
    return {
      scope: this.createWorkspaceScope(activation),
      indexSyncPromise: null,
      indexSyncQueued: false,
      indexRefreshTimer: null,
      indexRefreshPromise: null,
      indexRefreshDue: false,
      indexRefreshReason: "scheduled-refresh",
      pendingIndexRefreshRootIds: new Set(),
      autoEmbeddingTimer: null,
      autoEmbeddingPromise: null,
      autoEmbeddingState: createAutoEmbeddingSchedulerState(),
      pendingEmbeddings: 0,
      lastKnownStatus: null,
      lastKnownStatusWorkspaceRoot: null,
      maintenanceWorkCount: 0,
      foregroundWorkCount: 0,
      foregroundIdleWaiters: new Set(),
      foregroundAbortController: new AbortController(),
      indexJobSequence: 0,
      indexJobMetrics: [],
    };
  }

  private isCurrentState(state: WorkspaceMaintenanceState): boolean {
    return state === this.state && !state.scope.maintenanceAbortController.signal.aborted;
  }

  private assertCurrentState(state: WorkspaceMaintenanceState): void {
    if (!this.isCurrentState(state) || state.foregroundAbortController.signal.aborted) throw abortError();
  }

  private disposeMaintenanceState(state: WorkspaceMaintenanceState): void {
    if (state.indexRefreshTimer) clearTimeout(state.indexRefreshTimer);
    this.clearAutomaticEmbeddingTimer(state);
    state.indexRefreshTimer = null;
    state.indexRefreshDue = false;
    state.pendingIndexRefreshRootIds.clear();
    state.indexSyncQueued = false;
    state.autoEmbeddingState = disposeAutoEmbeddingScheduler(state.autoEmbeddingState);
    for (const resolve of state.foregroundIdleWaiters) resolve();
    state.foregroundIdleWaiters.clear();
  }
}

function staleRefreshResult(status: IndexStatus): IndexSyncResult {
  return { status, phases: [], warnings: [] };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("Index maintenance was superseded by a Workspace change.");
  error.name = "AbortError";
  return error;
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
