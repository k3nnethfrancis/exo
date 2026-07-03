import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  resolveLaunchableAgentLaunchPlan,
  resolveRuntimeConfig,
  syncRuntimeContextFiles,
  terminalSubstrateKindForManagedAgentKind,
  type RuntimeConfig,
} from "@exo/core";
import {
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  DEFAULT_TERMINAL_MINIMUM_ROWS,
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
} from "@exo/core/terminal-settings";

import type { TerminalCreateOptions, TerminalHealthState, TerminalSessionInfo, TerminalKind, TerminalWriteResult } from "../shared/api";
import { agentInstructionOverlayEnv, writeAgentInstructionOverlaysSync } from "./agent-instruction-overlays";
import { terminalDiagnosticsFromRecord } from "./terminal-diagnostics";
import {
  harnessLaunchArgs,
  initialHarnessReadiness,
  initialHarnessReadinessDetail,
  isAgentHarnessKind,
  observeHarnessReadiness,
  semanticMessageWrite,
  shouldGateHarnessStartupInput,
  shouldQueueRawWrite,
  shouldQueueSemanticMessage,
  startupGraceReadyDetail,
  type PendingTerminalWrite,
} from "./terminal-harness-readiness";
import { terminalHealth, terminalHealthDetail } from "./terminal-health";
import { selectTerminalLiveTail } from "./terminal-live-tail-policy";
import type { TerminalRuntime, TerminalRuntimePaneInfo, TerminalRuntimeProcess, TerminalRuntimeRestoreSnapshot } from "./terminal-runtime";
import { TmuxTerminalRuntime } from "./terminal-runtime-tmux";
import { TerminalGeometryService } from "./terminal-geometry-service";
import { TerminalSessionRegistry, type PersistedTerminalSession } from "./terminal-session-registry";
import { TerminalTailCache, normalizeTailLineLimit } from "./terminal-tail-cache";
import { sanitizeTranscriptName, TerminalTranscriptStore } from "./terminal-transcripts";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: TerminalRuntimeProcess;
  tmuxSessionName: string;
  tmuxPaneId: string;
  createdAt: string;
  tailCache: TerminalTailCache;
  transcriptPath: string;
  pendingWrites: PendingTerminalWrite[];
  rawInputBuffer: string;
  rawInputTimer?: NodeJS.Timeout;
  readinessTimer?: NodeJS.Timeout;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
  bridgeDetached?: boolean;
  paneStatus?: "alive" | "dead" | "missing" | "unknown";
  tmuxPaneGeometry?: { width: number; height: number };
  tmuxClientGeometry?: { width: number; height: number };
  geometryDivergentSince?: number;
  reconnecting?: boolean;
  terminating?: boolean;
}

const DEFAULT_LIVE_SCROLLBACK_LINES = 100_000;
const DEFAULT_BUFFER_LINE_LIMIT = DEFAULT_LIVE_SCROLLBACK_LINES;
const MIN_LIVE_SCROLLBACK_LINES = 500;

export interface TerminalRuntimeOptions {
  inputCoalesceMs?: number;
  agentStartupGraceMs?: number;
  agentSubmitDelayMs?: number;
  initialColumns?: number;
  initialRows?: number;
  minimumColumns?: number;
  minimumRows?: number;
  unresponsiveThresholdMs?: number;
  idleThresholdMs?: number;
}

const DEFAULT_TERMINAL_RUNTIME_OPTIONS: Required<TerminalRuntimeOptions> = {
  inputCoalesceMs: DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  agentStartupGraceMs: DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  agentSubmitDelayMs: DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  initialColumns: DEFAULT_TERMINAL_INITIAL_COLUMNS,
  initialRows: DEFAULT_TERMINAL_INITIAL_ROWS,
  minimumColumns: DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  minimumRows: DEFAULT_TERMINAL_MINIMUM_ROWS,
  unresponsiveThresholdMs: DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
  idleThresholdMs: DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
};

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private bufferLineLimit: number | null;
  private transcriptRetentionDays: number;
  private nextId = 1;
  private runtimeConfig = resolveRuntimeConfig();
  private transcripts: TerminalTranscriptStore;
  private nextWriteId = 1;
  private nextAttachGeneration = 1;
  private sessionRegistry = this.createSessionRegistry();
  private terminalRuntimeOptions: Required<TerminalRuntimeOptions>;
  private geometryService: TerminalGeometryService;

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_BUFFER_LINE_LIMIT,
    transcriptRetentionDays = 0,
    terminalRuntimeOptions: TerminalRuntimeOptions = {},
    private readonly terminalRuntime: TerminalRuntime = new TmuxTerminalRuntime(),
  ) {
    super();
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(transcriptRetentionDays);
    this.terminalRuntimeOptions = normalizeTerminalRuntimeOptions(terminalRuntimeOptions);
    this.geometryService = this.createGeometryService();
    this.transcripts = this.createTranscriptStore();
    this.restorePersistedSessions();
  }

  list(): TerminalSessionInfo[] {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .map((record) => {
        record.info.health = this.terminalHealth(record, now);
        record.info.healthDetail = this.terminalHealthDetail(record, now);
        return record.info;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  diagnostics() {
    const now = Date.now();
    this.reconcileTmuxState();
    return Array.from(this.sessions.values())
      .map((record) =>
        terminalDiagnosticsFromRecord({
          info: record.info,
          kind: record.info.kind,
          status: record.info.status,
          exitCode: record.info.exitCode,
          health: this.terminalHealth(record, now),
          healthDetail: this.terminalHealthDetail(record, now),
          tmuxSessionName: record.tmuxSessionName,
          tmuxPaneId: record.tmuxPaneId,
          bridgeDetached: record.bridgeDetached,
          paneStatus: record.paneStatus,
          tmuxPaneGeometry: record.tmuxPaneGeometry,
          tmuxClientGeometry: record.tmuxClientGeometry,
          geometryDivergentSince: record.geometryDivergentSince,
          cwd: record.info.cwd,
          title: record.info.title,
          command: record.info.command,
          bufferedLines: record.tailCache.lineCount(),
          bufferedChars: record.tailCache.charCount(),
          transcriptPath: record.transcriptPath,
          lastInputAt: record.lastInputAt,
          lastOutputAt: record.lastOutputAt,
          lastWriteId: record.lastWriteId,
          lastWriteLatencyMs: record.lastWriteLatencyMs,
          now,
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getInfo(id: string): TerminalSessionInfo | null {
    return this.sessions.get(id)?.info ?? null;
  }

  async ensureDefault(): Promise<TerminalSessionInfo> {
    const existing = this.list().find((session) => session.kind === "shell");
    if (existing) {
      return existing;
    }

    return this.create({ kind: "shell" });
  }

  getRuntimeConfig() {
    return this.runtimeConfig;
  }

  setRuntimeConfig(runtimeConfig: RuntimeConfig = resolveRuntimeConfig()) {
    const previousRuntimeRoot = this.runtimeConfig.runtimeRoot;
    this.runtimeConfig = runtimeConfig;
    this.sessionRegistry = this.createSessionRegistry();
    if (runtimeConfig.runtimeRoot === previousRuntimeRoot) {
      return;
    }

    this.flushAllTranscripts();
    this.transcripts = this.createTranscriptStore();
    this.restorePersistedSessions();
  }

  setDefaultCwd(cwd: string) {
    this.defaultCwd = cwd;
  }

  setBufferLineLimit(bufferLineLimit: number | null) {
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    for (const record of this.sessions.values()) {
      record.tailCache.resize(this.bufferLineLimit);
      this.applyRuntimeSessionOptions(record);
    }
  }

  setTranscriptRetentionDays(retentionDays: number) {
    this.flushAllTranscripts();
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(retentionDays);
    this.transcripts = this.createTranscriptStore();
  }

  setTerminalRuntimeOptions(options: TerminalRuntimeOptions) {
    this.terminalRuntimeOptions = normalizeTerminalRuntimeOptions(options);
    this.geometryService = this.createGeometryService();
  }

  private terminalHealth(record: TerminalRecord, now = Date.now()): TerminalHealthState {
    return terminalHealth(terminalHealthInput(record), this.terminalRuntimeOptions, now);
  }

  private terminalHealthDetail(record: TerminalRecord, now = Date.now()): string {
    return terminalHealthDetail(terminalHealthInput(record), this.terminalRuntimeOptions, now);
  }

  async syncRuntimeContext() {
    return syncRuntimeContextFiles(this.runtimeConfig);
  }

  async create(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
    const cwd = options.cwd ?? this.defaultCwd;
    const launch = resolveLaunchableAgentLaunchPlan(this.runtimeConfig, options.kind, cwd);
    await this.syncRuntimeContext();
    const id = this.allocateTerminalId();
    const isAgent = isAgentHarnessKind(options.kind);
    const overlayEnv = isAgent ? agentInstructionOverlayEnv(this.runtimeConfig.workspace, launch.cwd) : {};
    if (isAgent) {
      writeAgentInstructionOverlaysSync(this.runtimeConfig.workspace);
    }
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_CTYPE: process.env.LC_CTYPE ?? process.env.LANG ?? "en_US.UTF-8",
      SHELL_SESSIONS_DISABLE: "1",
      ...launch.env,
      ...overlayEnv,
    };

    const spawnArgs = harnessLaunchArgs(options.kind, launch.args, this.runtimeConfig, launch.cwd);
    const createdAt = new Date().toISOString();
    const launchToken = `${id}-${createdAt}-${randomUUID().slice(0, 8)}`;
    const geometry = this.geometryService.initialDefault(createdAt);
    const attachSize = this.geometryService.attachSize(geometry);
    const runtimeSession = this.terminalRuntime.createSession({
      sessionToken: launchToken,
      workspaceRoot: this.runtimeConfig.workspace.workspaceRoot,
      command: launch.command,
      args: spawnArgs,
      cwd: launch.cwd,
      env,
      cols: attachSize.cols,
      rows: attachSize.rows,
      historyLimit: this.tmuxHistoryLimit(),
    });
    const tmuxSessionName = runtimeSession.sessionName;
    const tmuxPaneId = runtimeSession.paneId;
    const processHandle = runtimeSession.process;

    const transcriptPath = this.makeTranscriptPath(id, options.kind, createdAt, launchToken);
    const info: TerminalSessionInfo = {
      id,
      title: launch.title,
      cwd: launch.cwd,
      ...terminalSessionIdentity(options.kind),
      kind: options.kind,
      command: launch.command,
      instructionOverlayPath: overlayEnv.EXO_INSTRUCTIONS ?? null,
      transcriptPath,
      status: "running",
      readiness: initialHarnessReadiness(options.kind),
      readinessDetail: initialHarnessReadinessDetail(options.kind),
      queuedInputCount: 0,
      geometry,
      attachGeneration: this.allocateAttachGeneration(),
    };

    const record: TerminalRecord = {
      info,
      process: processHandle,
      tmuxSessionName,
      tmuxPaneId,
      createdAt,
      tailCache: new TerminalTailCache(this.bufferLineLimit),
      transcriptPath,
      pendingWrites: [],
      rawInputBuffer: "",
      lastWriteId: 0,
    };

    if (shouldGateHarnessStartupInput(info)) {
      record.readinessTimer = setTimeout(() => {
        const current = this.sessions.get(id);
        if (!current || current.info.readiness !== "starting") {
          return;
        }
        this.markReady(current, startupGraceReadyDetail(current.info.kind));
      }, this.terminalRuntimeOptions.agentStartupGraceMs);
    }

    this.sessions.set(id, record);

    this.appendTranscript(id, this.transcriptHeader(info));
    this.wireProcess(id, processHandle, info.attachGeneration);
    this.persistSessions();

    this.emit("created", info);
    return info;
  }

  async write(id: string, data: string): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited" || record.bridgeDetached) {
      return { ok: false, delivery: "not-found" };
    }

    if (shouldCoalesceRawInput(data)) {
      return this.queueRawInput(record, data);
    }

    this.flushRawInput(record);
    return this.writeToRecord(record, { data, delayedSubmit: false }, shouldQueueRawWrite(record.info, data));
  }

  async sendMessage(id: string, message: string, submit = true): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited" || record.bridgeDetached) {
      return { ok: false, delivery: "not-found" };
    }

    this.flushRawInput(record);
    const pendingWrite = {
      data: semanticMessageWrite(record.info.kind, message),
      delayedSubmit: submit,
    };
    return this.writeToRecord(record, pendingWrite, shouldQueueSemanticMessage(record.info, submit));
  }

  async reconnect(id: string): Promise<TerminalSessionInfo | null> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return null;
    }

    this.reconcileTmuxState();
    if (record.paneStatus !== "alive") {
      record.info.health = "unhealthy";
      record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
      return record.info;
    }

    record.reconnecting = true;
    const attachSize = this.geometryService.attachSize(record.info.geometry ?? this.geometryService.initialDefault());
    const attachGeneration = this.allocateAttachGeneration();
    record.info.attachGeneration = attachGeneration;
    await killAndWaitForBridgeExit(record.process);
    let processHandle: TerminalRuntimeProcess;
    try {
      processHandle = this.terminalRuntime.attachSession({
        sessionName: record.tmuxSessionName,
        paneId: record.tmuxPaneId,
        cwd: record.info.cwd,
        cols: attachSize.cols,
        rows: attachSize.rows,
      });
    } catch (error) {
      record.reconnecting = false;
      record.bridgeDetached = true;
      record.info.health = "unhealthy";
      record.info.healthDetail = error instanceof Error ? error.message : String(error);
      return record.info;
    }
    record.process = processHandle;
    record.reconnecting = false;
    record.bridgeDetached = false;
    record.paneStatus = "alive";
    record.info.health = this.terminalHealth(record, Date.now());
    record.info.healthDetail = "Reattached to live tmux session.";
    this.wireProcess(id, processHandle, attachGeneration);
    this.persistSessions();
    this.emit("updated", record.info);
    return record.info;
  }

  reconnectRecoverableTerminals(): void {
    this.reconcileTmuxState();
    for (const record of this.sessions.values()) {
      if (record.info.status !== "running" || record.paneStatus !== "alive" || record.reconnecting) {
        continue;
      }
      void this.reconnect(record.info.id).catch((error) => {
        console.warn("[exo] failed to reconnect detached terminal", {
          id: record.info.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  readTail(id: string, options: { maxLines?: number } = {}): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    const buffered = record.tailCache.text();
    const maxLines = normalizeTailLineLimit(options.maxLines);
    const captured = this.captureTmuxHistory(record, maxLines);
    const selected = selectTerminalLiveTail({ buffered, captured, maxLines });
    if (selected.cacheCapturedTail) {
      this.cacheCapturedTail(record, selected.text);
    }
    return selected.text;
  }

  readTranscript(id: string, tailChars = 0): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    this.flushTranscript(id);
    return this.transcripts.read(record.transcriptPath, tailChars);
  }

  readRestoreSnapshot(id: string): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    return this.captureRestoreSnapshot(record);
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return;
    }

    const geometry = this.geometryService.rendererFit(cols, rows);
    record.info.geometry = geometry;
    this.persistSessions();
    try {
      record.process.resize(geometry.cols, geometry.rows);
    } catch (error) {
      record.bridgeDetached = true;
      record.info.health = "unhealthy";
      record.info.healthDetail = error instanceof Error ? `Terminal resize failed: ${error.message}` : "Terminal resize failed.";
      console.warn("[exo] terminal resize failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async kill(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) {
      return;
    }

    this.flushTranscript(id);
    this.clearReadinessTimer(record);
    this.discardRawInputForKill(record);
    this.discardPendingWrites(record, "terminal was killed before queued input could be delivered");
    record.terminating = true;
    try {
      this.terminalRuntime.terminate(record.tmuxSessionName);
    } catch (error) {
      console.warn("[exo] failed to kill tmux terminal session", {
        id,
        tmuxSessionName: record.tmuxSessionName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    record.process.kill();
    this.sessions.delete(id);
    this.persistSessions();
  }

  // --- internals ---

  private writeToRecord(record: TerminalRecord, pendingWrite: PendingTerminalWrite, queue: boolean): TerminalWriteResult {
    if (queue) {
      record.pendingWrites.push(pendingWrite);
      this.updateQueuedInputCount(record);
      return {
        ok: true,
        delivery: "queued",
        queuedInputCount: record.pendingWrites.length,
        readiness: record.info.readiness,
        readinessDetail: record.info.readinessDetail,
      };
    }

    const writeId = this.nextWriteId++;
    record.lastWriteId = writeId;
    record.lastInputAt = Date.now();
    this.writePendingData(record, pendingWrite);
    return {
      ok: true,
      delivery: "sent",
      writeId,
      queuedInputCount: record.pendingWrites.length,
      readiness: record.info.readiness,
      readinessDetail: record.info.readinessDetail,
    };
  }

  private queueRawInput(record: TerminalRecord, data: string): TerminalWriteResult {
    const writeId = this.nextWriteId++;
    record.lastWriteId = writeId;
    record.lastInputAt = Date.now();
    record.rawInputBuffer += data;
    if (record.rawInputTimer) {
      clearTimeout(record.rawInputTimer);
    }
    record.rawInputTimer = setTimeout(() => this.flushRawInput(record), this.terminalRuntimeOptions.inputCoalesceMs);
    return {
      ok: true,
      delivery: "sent",
      writeId,
      queuedInputCount: record.pendingWrites.length,
      readiness: record.info.readiness,
      readinessDetail: record.info.readinessDetail,
    };
  }

  private flushRawInput(record: TerminalRecord): void {
    if (record.rawInputTimer) {
      clearTimeout(record.rawInputTimer);
      record.rawInputTimer = undefined;
    }
    if (record.rawInputBuffer.length === 0) {
      return;
    }
    if (!canDeliverInput(record)) {
      this.discardRawInput(record, "terminal is not writable");
      return;
    }
    const data = record.rawInputBuffer;
    record.rawInputBuffer = "";
    record.process.write(data);
  }

  private discardRawInput(record: TerminalRecord, reason: string): void {
    if (record.rawInputTimer) {
      clearTimeout(record.rawInputTimer);
      record.rawInputTimer = undefined;
    }
    if (record.rawInputBuffer.length === 0) {
      return;
    }
    const discardedChars = record.rawInputBuffer.length;
    record.rawInputBuffer = "";
    console.warn("[exo] dropped buffered terminal input", {
      id: record.info.id,
      discardedChars,
      reason,
    });
  }

  private discardPendingWrites(record: TerminalRecord, reason: string): void {
    if (record.pendingWrites.length === 0) {
      return;
    }
    const discardedWrites = record.pendingWrites.length;
    record.pendingWrites = [];
    this.updateQueuedInputCount(record);
    console.warn("[exo] dropped queued terminal input", {
      id: record.info.id,
      discardedWrites,
      reason,
    });
  }

  private discardRawInputOnExit(record: TerminalRecord): void {
    this.discardRawInput(record, "terminal exited before buffered input could be delivered");
  }

  private discardRawInputForKill(record: TerminalRecord): void {
    // Explicit terminal kill is destructive by user intent. Do not race a
    // final coalesced keystroke into a tmux pane that is being terminated.
    this.discardRawInput(record, "terminal was killed before buffered input could be delivered");
  }

  private dropQueuedInputIfUndeliverable(record: TerminalRecord): boolean {
    if (canDeliverInput(record)) {
      return false;
    }
    this.discardPendingWrites(
      record,
      record.info.status === "exited"
        ? "terminal exited before queued input could be delivered"
        : "terminal bridge is detached",
    );
    return true;
  }

  private wireProcess(id: string, processHandle: TerminalRuntimeProcess, attachGeneration: number) {
    processHandle.onData((data) => {
      const record = this.sessions.get(id);
      const sanitizedData = stripMouseTrackingModes(data);
      if (record) {
        if (record.info.attachGeneration !== attachGeneration) {
          return;
        }
        record.bridgeDetached = false;
        this.appendTranscript(id, sanitizedData);
        record.lastOutputAt = Date.now();
        if (record.lastInputAt) {
          record.lastWriteLatencyMs = record.lastOutputAt - record.lastInputAt;
        }
        record.tailCache.append(sanitizedData);
        this.updateAgentReadiness(record);
        record.info.health = this.terminalHealth(record, Date.now());
        record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
        this.emit("data", { id, generation: attachGeneration, data: sanitizedData });
      }
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record) {
        return;
      }
      if (record.info.attachGeneration !== attachGeneration) {
        return;
      }

      if (record.tmuxSessionName && !record.terminating) {
        if (record.reconnecting) {
          return;
        }
        this.reconcileTmuxState();
        if (record.paneStatus === "missing" || record.paneStatus === "dead") {
          if (isAgentTerminal(record)) {
            // Agent harnesses exit back to no useful interactive shell in this
            // product model, so retire the tab instead of leaving a stale
            // terminal that looks writable but cannot do work.
            this.retireExitedTerminal(record, exitCode);
            return;
          }
          this.markExited(record, exitCode);
          this.persistSessions();
          this.emit("exit", { id, exitCode });
          return;
        }
        // A bridge exit with a live pane means the user process may still be
        // healthy in tmux. Mark the bridge detached and require explicit
        // reconnect rather than replaying history or killing the session.
        record.info.health = "unhealthy";
        record.info.healthDetail = `Tmux attach bridge exited with code ${exitCode ?? "unknown"}; session may still be running.`;
        record.bridgeDetached = true;
        this.persistSessions();
        return;
      }

      this.markExited(record, exitCode);
      this.persistSessions();
      this.emit("exit", { id, exitCode });
    });
  }

  private retireExitedTerminal(record: TerminalRecord, exitCode?: number): void {
    this.flushTranscript(record.info.id);
    this.markExited(record, exitCode);
    this.persistSessions();
    this.emit("exit", { id: record.info.id, exitCode });
  }

  private markExited(record: TerminalRecord, exitCode?: number): void {
    this.discardRawInputOnExit(record);
    this.discardPendingWrites(record, "terminal exited before queued input could be delivered");
    record.info.status = "exited";
    record.info.health = "exited";
    record.info.healthDetail = exitCode === undefined ? "Process exited." : `Process exited with code ${exitCode}.`;
    record.info.exitCode = exitCode;
    this.clearReadinessTimer(record);
  }

  private makeTranscriptPath(id: string, kind: TerminalKind, createdAt: string, launchToken: string): string {
    const nonce = launchToken.slice(-8);
    const name = sanitizeTranscriptName(`${id}-${kind}-${createdAt}-${nonce}`);
    return path.join(this.transcripts.directory, `${name}.ansi.log`);
  }

  private transcriptHeader(info: TerminalSessionInfo): string {
    const record = this.sessions.get(info.id);
    return [
      "",
      `\n===== Exo terminal transcript started ${new Date().toISOString()} =====`,
      `id: ${info.id}`,
      `kind: ${info.kind}`,
      `cwd: ${info.cwd}`,
      `command: ${info.command}`,
      record?.tmuxSessionName ? `tmux_session: ${record.tmuxSessionName}` : null,
      "============================================================",
      "",
    ].filter((line): line is string => line !== null).join("\n");
  }

  private appendTranscript(id: string, data: string): void {
    const record = this.sessions.get(id);
    if (!record || data.length === 0) {
      return;
    }
    this.transcripts.append(id, record.transcriptPath, data);
  }

  private flushTranscript(id: string): void {
    const record = this.sessions.get(id);
    if (!record) {
      return;
    }
    this.transcripts.flush(id, record.transcriptPath);
  }

  private flushAllTranscripts(): void {
    for (const id of this.sessions.keys()) {
      this.flushTranscript(id);
    }
  }

  private createTranscriptStore(): TerminalTranscriptStore {
    return new TerminalTranscriptStore(path.join(this.runtimeConfig.runtimeRoot, "terminal-transcripts"), {
      retentionDays: this.transcriptRetentionDays,
    });
  }

  private createSessionRegistry(): TerminalSessionRegistry {
    return new TerminalSessionRegistry(path.join(this.runtimeConfig.runtimeRoot, "terminal-sessions.json"));
  }

  private createGeometryService(): TerminalGeometryService {
    return new TerminalGeometryService(this.terminalRuntimeOptions.initialColumns, this.terminalRuntimeOptions.initialRows);
  }

  private allocateTerminalId(): string {
    const id = `term-${this.nextId}`;
    this.nextId += 1;
    this.persistSessions();
    return id;
  }

  private allocateAttachGeneration(): number {
    const generation = this.nextAttachGeneration;
    this.nextAttachGeneration += 1;
    return generation;
  }

  private updateAgentReadiness(record: TerminalRecord): void {
    const transition = observeHarnessReadiness(record.info, record.tailCache.text());
    if (!transition) {
      return;
    }
    if (transition.clearTimer) {
      this.clearReadinessTimer(record);
    }
    record.info.readiness = transition.readiness;
    record.info.readinessDetail = transition.readinessDetail;
    if (transition.flushQueued) {
      this.flushPendingWrites(record);
    }
  }

  private markReady(record: TerminalRecord, detail: string): void {
    this.clearReadinessTimer(record);
    record.info.readiness = "ready";
    record.info.readinessDetail = detail;
    this.flushPendingWrites(record);
  }

  private flushPendingWrites(record: TerminalRecord): void {
    if (record.pendingWrites.length === 0) {
      return;
    }
    if (this.dropQueuedInputIfUndeliverable(record)) {
      return;
    }

    const pendingWrites = record.pendingWrites.splice(0);
    let lastDelayedSubmitIndex = -1;
    for (let index = pendingWrites.length - 1; index >= 0; index -= 1) {
      if (pendingWrites[index]?.delayedSubmit) {
        lastDelayedSubmitIndex = index;
        break;
      }
    }

    pendingWrites.forEach((pendingWrite, index) => {
      this.writePendingData(record, pendingWrite, index === lastDelayedSubmitIndex);
    });
    this.updateQueuedInputCount(record);
  }

  private writePendingData(
    record: TerminalRecord,
    pendingWrite: PendingTerminalWrite,
    scheduleDelayedSubmit = pendingWrite.delayedSubmit,
  ): void {
    record.process.write(pendingWrite.data);
    if (scheduleDelayedSubmit) {
      // Semantic agent sends paste the exact prompt first, then submit after
      // the configured delay. This avoids racing Claude/Codex multiline input
      // handling while keeping raw keystrokes on the immediate write path.
      setTimeout(() => {
        if (canDeliverInput(record)) {
          record.process.write("\r");
        }
      }, this.terminalRuntimeOptions.agentSubmitDelayMs);
      return;
    }
  }

  private updateQueuedInputCount(record: TerminalRecord): void {
    record.info.queuedInputCount = record.pendingWrites.length;
  }

  private clearReadinessTimer(record: TerminalRecord): void {
    if (record.readinessTimer) {
      clearTimeout(record.readinessTimer);
      record.readinessTimer = undefined;
    }
  }

  reconcileTmuxState(): void {
    if (this.sessions.size === 0) {
      return;
    }
    const availability = this.terminalRuntime.availability();
    if (!availability.available) {
      for (const record of this.sessions.values()) {
        if (record.info.status === "exited") {
          record.info.health = "exited";
          record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
          continue;
        }
        record.paneStatus = "unknown";
        record.tmuxPaneGeometry = undefined;
        record.tmuxClientGeometry = undefined;
        record.geometryDivergentSince = undefined;
        record.info.health = "unhealthy";
        record.info.healthDetail = availability.reason;
      }
      return;
    }
    const panes = new Map(this.listRuntimePanes().map((pane) => [pane.sessionName, pane]));
    for (const record of this.sessions.values()) {
      if (record.info.status === "exited") {
        record.info.health = "exited";
        record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
        continue;
      }
      const pane = panes.get(record.tmuxSessionName);
      if (!pane) {
        record.paneStatus = "missing";
        record.tmuxPaneGeometry = undefined;
        record.tmuxClientGeometry = undefined;
        record.geometryDivergentSince = undefined;
        record.info.health = "unhealthy";
        record.info.healthDetail = "Tmux session is missing; transcript remains available.";
        continue;
      }
      if (pane.dead) {
        record.paneStatus = "dead";
        record.tmuxPaneGeometry = paneGeometry(pane);
        record.tmuxClientGeometry = clientGeometry(pane);
        this.updateGeometryDivergence(record);
        record.info.health = "unhealthy";
        record.info.healthDetail = "Tmux pane is dead; restart or open transcript.";
        continue;
      }
      record.paneStatus = "alive";
      record.tmuxPaneGeometry = paneGeometry(pane);
      record.tmuxClientGeometry = clientGeometry(pane);
      this.updateGeometryDivergence(record);
    }
  }

  private updateGeometryDivergence(record: TerminalRecord): void {
    const divergent = terminalGeometryDiverges(record);
    if (divergent && record.geometryDivergentSince === undefined) {
      record.geometryDivergentSince = Date.now();
    } else if (!divergent) {
      record.geometryDivergentSince = undefined;
    }
  }

  private restorePersistedSessions(): void {
    const registry = this.sessionRegistry.load();
    this.nextId = Math.max(this.nextId, registry.nextId);
    if (registry.sessions.length === 0) {
      return;
    }

    const availability = this.terminalRuntime.availability();
    if (!availability.available && registry.sessions.some((session) => session.status === "running")) {
      console.warn("[exo] unable to restore running terminal sessions because tmux is unavailable", {
        reason: availability.reason,
        attempted: availability.attempted,
      });
    }

    const runtimeAvailable = availability.available;
    const livePanes = runtimeAvailable
      ? new Map(this.listRuntimePanes().filter((pane) => !pane.dead).map((pane) => [pane.sessionName, pane]))
      : new Map<string, TerminalRuntimePaneInfo>();
    let restored = 0;
    for (const session of registry.sessions) {
      if (session.status === "exited" && !this.sessions.has(session.id)) {
        this.sessions.set(session.id, this.persistedTranscriptRecord(session, {
          status: "exited",
          health: "exited",
          healthDetail: session.healthDetail ?? (session.exitCode === undefined ? "Process exited." : `Process exited with code ${session.exitCode}.`),
          paneStatus: "dead",
        }));
        restored += 1;
        continue;
      }

      const livePane = livePanes.get(session.tmuxSessionName);
      if (this.sessions.has(session.id) || session.status !== "running") {
        continue;
      }
      if (!runtimeAvailable || !livePane) {
        this.sessions.set(session.id, this.persistedTranscriptRecord(session, {
          status: "running",
          health: "unhealthy",
          healthDetail: runtimeAvailable
            ? "Tmux session is missing; transcript remains available."
            : availability.reason,
          paneStatus: runtimeAvailable ? "missing" : "unknown",
        }));
        restored += 1;
        continue;
      }

      try {
        const tmuxPaneId = session.tmuxPaneId ?? livePane.paneId;
        const geometry = this.geometryService.fromPersisted(session.geometry);
        const attachSize = this.geometryService.attachSize(geometry);
        const processHandle = this.terminalRuntime.attachSession({
          sessionName: session.tmuxSessionName,
          paneId: tmuxPaneId,
          cwd: session.cwd,
          cols: attachSize.cols,
          rows: attachSize.rows,
        });
        const record: TerminalRecord = {
          info: {
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            ...terminalSessionIdentity(session.kind),
            kind: session.kind,
            command: session.command,
            instructionOverlayPath: session.instructionOverlayPath ?? null,
            transcriptPath: session.transcriptPath,
            status: "running",
            readiness: "ready",
            queuedInputCount: 0,
            geometry,
            attachGeneration: this.allocateAttachGeneration(),
          },
          process: processHandle,
          tmuxSessionName: session.tmuxSessionName,
          tmuxPaneId,
          createdAt: session.createdAt,
          paneStatus: "alive",
          tailCache: new TerminalTailCache(this.bufferLineLimit),
          transcriptPath: session.transcriptPath,
          pendingWrites: [],
          rawInputBuffer: "",
          lastWriteId: 0,
        };
        this.sessions.set(session.id, record);
        this.applyRuntimeSessionOptions(record);
        this.wireProcess(session.id, processHandle, record.info.attachGeneration);
        restored += 1;
      } catch (error) {
        console.warn("[exo] failed to restore tmux terminal session", {
          id: session.id,
          tmuxSessionName: session.tmuxSessionName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (restored > 0) {
      this.persistSessions();
    }
  }

  private persistedTranscriptRecord(
    session: PersistedTerminalSession,
    state: {
      status: TerminalSessionInfo["status"];
      health: TerminalHealthState;
      healthDetail: string;
      paneStatus: TerminalRecord["paneStatus"];
    },
  ): TerminalRecord {
    // This record is intentionally transcript-backed only. It preserves the
    // user's evidence after restart without pretending Exo still has a live
    // bridge or pane to write to.
    return {
      info: {
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        ...terminalSessionIdentity(session.kind),
        kind: session.kind,
        command: session.command,
        instructionOverlayPath: session.instructionOverlayPath ?? null,
        transcriptPath: session.transcriptPath,
        status: state.status,
        readiness: session.readiness ?? "ready",
        readinessDetail: session.readinessDetail,
        queuedInputCount: 0,
        health: state.health,
        healthDetail: state.healthDetail,
        exitCode: session.exitCode,
        geometry: this.geometryService.fromPersisted(session.geometry),
        attachGeneration: 0,
      },
      process: noopTerminalProcess(),
      tmuxSessionName: session.tmuxSessionName,
      tmuxPaneId: session.tmuxPaneId ?? "",
      createdAt: session.createdAt,
      paneStatus: state.paneStatus,
      tailCache: new TerminalTailCache(this.bufferLineLimit),
      transcriptPath: session.transcriptPath,
      pendingWrites: [],
      rawInputBuffer: "",
      lastWriteId: 0,
      bridgeDetached: true,
    };
  }

  private listRuntimePanes(): TerminalRuntimePaneInfo[] {
    try {
      return this.terminalRuntime.listPanes();
    } catch (error) {
      console.warn("[exo] failed to list tmux panes during terminal restore", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Startup reconciliation should degrade to "unknown/missing" health
      // instead of preventing Exo from opening. Creation/reconnect paths still
      // fail explicitly when tmux cannot satisfy their contract.
      return [];
    }
  }

  private applyRuntimeSessionOptions(record: TerminalRecord): void {
    try {
      this.terminalRuntime.applySessionOptions({
        sessionName: record.tmuxSessionName,
        historyLimit: this.tmuxHistoryLimit(),
      });
    } catch (error) {
      record.info.health = "unhealthy";
      record.info.healthDetail = error instanceof Error ? `Failed to set tmux session options: ${error.message}` : "Failed to set tmux session options.";
      console.warn("[exo] failed to set tmux session options", {
        tmuxSessionName: record.tmuxSessionName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private tmuxHistoryLimit(): number {
    return this.bufferLineLimit ?? DEFAULT_LIVE_SCROLLBACK_LINES;
  }

  private captureTmuxHistory(record: TerminalRecord, lineLimit?: number): string | null {
    try {
      const options = {
        sessionName: record.tmuxSessionName,
        paneId: record.tmuxPaneId,
        historyLimit: this.tmuxHistoryLimit(),
      };
      return this.terminalRuntime.captureTailForDisplay(lineLimit ? { ...options, lineLimit } : options);
    } catch (error) {
      console.warn("[exo] failed to capture tmux terminal history", {
        id: record.info.id,
        tmuxSessionName: record.tmuxSessionName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Read callers fall back to the bounded append cache so CLI/MCP/UI reads
      // do not show a blank terminal during a transient tmux capture failure.
      // Durable history remains the transcript; this cache is not a live render
      // source for mounted xterm instances.
      return null;
    }
  }

  private cacheCapturedTail(record: TerminalRecord, captured: string): void {
    record.tailCache.replace(captured);
    this.updateAgentReadiness(record);
  }

  private captureRestoreSnapshot(record: TerminalRecord): string | null {
    let snapshot: TerminalRuntimeRestoreSnapshot;
    try {
      // Capture after tmux has been sized for this attach generation. Ink-style
      // cursor-relative redraws need the grid and final CUP to come from the
      // same post-geometry snapshot string.
      snapshot = this.terminalRuntime.captureRestoreSnapshot({
        sessionName: record.tmuxSessionName,
        paneId: record.tmuxPaneId,
        historyLimit: this.tmuxHistoryLimit(),
        liveScrollbackLines: this.tmuxHistoryLimit(),
      });
    } catch (error) {
      console.warn("[exo] failed to capture tmux terminal restore snapshot", {
        id: record.info.id,
        tmuxSessionName: record.tmuxSessionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!this.restoreSnapshotGeometryMatches(record, snapshot)) {
      return "";
    }
    if (snapshot.altScreen) {
      console.info("[exo] skipping terminal restore snapshot for alternate-screen pane", {
        id: record.info.id,
        tmuxSessionName: record.tmuxSessionName,
        cols: snapshot.cols,
        rows: snapshot.rows,
      });
    }
    return snapshot.content;
  }

  private restoreSnapshotGeometryMatches(record: TerminalRecord, snapshot: TerminalRuntimeRestoreSnapshot): boolean {
    const geometry = record.info.geometry;
    if (!geometry || snapshot.cols <= 0 || snapshot.rows <= 0) {
      return true;
    }
    if (snapshot.cols === geometry.cols && snapshot.rows === geometry.rows) {
      return true;
    }
    record.info.health = "unhealthy";
    record.info.healthDetail = `Skipped terminal restore snapshot because tmux geometry ${snapshot.cols}x${snapshot.rows} did not match renderer geometry ${geometry.cols}x${geometry.rows}.`;
    console.warn("[exo] terminal restore snapshot geometry mismatch", {
      id: record.info.id,
      tmuxSessionName: record.tmuxSessionName,
      tmuxCols: snapshot.cols,
      tmuxRows: snapshot.rows,
      rendererCols: geometry.cols,
      rendererRows: geometry.rows,
      geometrySource: geometry.source,
    });
    return false;
  }

  private persistSessions(): void {
    this.sessionRegistry.save(this.nextId, Array.from(this.sessions.values()));
  }
}

function noopTerminalProcess(): TerminalRuntimeProcess {
  return {
    onData: () => {},
    onExit: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
}

function killAndWaitForBridgeExit(processHandle: TerminalRuntimeProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve();
    };
    timer = setTimeout(done, 250);
    processHandle.onExit(done);
    try {
      processHandle.kill();
    } catch {
      // Reconnect replaces only Exo's control-mode bridge. The durable process
      // lives in tmux, so a missing old bridge is expected after sleep, crash,
      // or manual detach and should not block reattach.
      done();
    }
  });
}

function isAgentTerminal(record: TerminalRecord): boolean {
  return isAgentHarnessKind(record.info.kind);
}

function shouldCoalesceRawInput(data: string): boolean {
  return data.length > 0 && !/[\u0000-\u001f\u007f]/.test(data);
}

function stripMouseTrackingModes(data: string): string {
  return data.replace(/\x1b\[\?(?:9|100[0-7]|1015)(?:;(?:9|100[0-7]|1015))*[hl]/g, "");
}

function terminalHealthInput(record: TerminalRecord) {
  return {
    status: record.info.status,
    exitCode: record.info.exitCode,
    paneStatus: record.paneStatus,
    bridgeDetached: record.bridgeDetached,
    lastInputAt: record.lastInputAt,
    lastOutputAt: record.lastOutputAt,
  };
}

function paneGeometry(pane: TerminalRuntimePaneInfo): { width: number; height: number } | undefined {
  if (pane.width === undefined || pane.height === undefined) {
    return undefined;
  }
  return { width: pane.width, height: pane.height };
}

function clientGeometry(pane: TerminalRuntimePaneInfo): { width: number; height: number } | undefined {
  if (pane.clientWidth === undefined || pane.clientHeight === undefined) {
    return undefined;
  }
  return { width: pane.clientWidth, height: pane.clientHeight };
}

function terminalGeometryDiverges(record: TerminalRecord): boolean {
  const renderer = record.info.geometry;
  if (!renderer) {
    return false;
  }
  const paneDiverges =
    record.tmuxPaneGeometry !== undefined &&
    (renderer.cols !== record.tmuxPaneGeometry.width || renderer.rows !== record.tmuxPaneGeometry.height);
  const clientDiverges =
    record.tmuxClientGeometry !== undefined &&
    (renderer.cols !== record.tmuxClientGeometry.width || renderer.rows !== record.tmuxClientGeometry.height);
  return paneDiverges || clientDiverges;
}

function canDeliverInput(record: TerminalRecord): boolean {
  return record.info.status === "running" && !record.bridgeDetached;
}

function terminalSessionIdentity(kind: TerminalKind): Pick<TerminalSessionInfo, "terminalKind" | "harnessId"> {
  return {
    terminalKind: terminalSubstrateKindForManagedAgentKind(kind),
    harnessId: kind === "shell" ? null : kind,
  };
}

function normalizeBufferLineLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value <= 0) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  return Math.max(MIN_LIVE_SCROLLBACK_LINES, Math.floor(value));
}

function normalizeTranscriptRetentionDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(3650, Math.floor(value)));
}

function normalizeTerminalRuntimeOptions(options: TerminalRuntimeOptions): Required<TerminalRuntimeOptions> {
  return {
    inputCoalesceMs: integerAtLeast(options.inputCoalesceMs, DEFAULT_TERMINAL_RUNTIME_OPTIONS.inputCoalesceMs, 0),
    agentStartupGraceMs: integerAtLeast(options.agentStartupGraceMs, DEFAULT_TERMINAL_RUNTIME_OPTIONS.agentStartupGraceMs, 0),
    agentSubmitDelayMs: integerAtLeast(options.agentSubmitDelayMs, DEFAULT_TERMINAL_RUNTIME_OPTIONS.agentSubmitDelayMs, 0),
    initialColumns: integerAtLeast(options.initialColumns, DEFAULT_TERMINAL_RUNTIME_OPTIONS.initialColumns, 20),
    initialRows: integerAtLeast(options.initialRows, DEFAULT_TERMINAL_RUNTIME_OPTIONS.initialRows, 8),
    minimumColumns: integerAtLeast(options.minimumColumns, DEFAULT_TERMINAL_RUNTIME_OPTIONS.minimumColumns, 1),
    minimumRows: integerAtLeast(options.minimumRows, DEFAULT_TERMINAL_RUNTIME_OPTIONS.minimumRows, 1),
    unresponsiveThresholdMs: integerAtLeast(options.unresponsiveThresholdMs, DEFAULT_TERMINAL_RUNTIME_OPTIONS.unresponsiveThresholdMs, 1_000),
    idleThresholdMs: integerAtLeast(options.idleThresholdMs, DEFAULT_TERMINAL_RUNTIME_OPTIONS.idleThresholdMs, 1_000),
  };
}

function integerAtLeast(value: number | undefined, fallback: number, min: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value as number));
}
