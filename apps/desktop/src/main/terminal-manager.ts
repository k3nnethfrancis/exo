import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  buildExoMcpServerSpec,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  syncRuntimeContextFiles,
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

import type { TerminalCreateOptions, TerminalDiagnostics, TerminalHealthState, TerminalSessionInfo, TerminalKind, TerminalWriteResult } from "../shared/api";
import { agentInstructionOverlayEnv, writeAgentInstructionOverlaysSync } from "./agent-instruction-overlays";
import { terminalHealth, terminalHealthDetail } from "./terminal-health";
import type { TerminalRuntime, TerminalRuntimePaneInfo, TerminalRuntimeProcess } from "./terminal-runtime";
import { TmuxTerminalRuntime } from "./terminal-runtime-tmux";
import { TerminalSessionRegistry } from "./terminal-session-registry";
import { sanitizeTranscriptName, TerminalTranscriptStore } from "./terminal-transcripts";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: TerminalRuntimeProcess;
  tmuxSessionName: string;
  tmuxPaneId: string;
  createdAt: string;
  recentOutput: string;
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
  reconnecting?: boolean;
  terminating?: boolean;
}

interface PendingTerminalWrite {
  data: string;
  delayedSubmit: boolean;
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
  private sessionRegistry = this.createSessionRegistry();
  private terminalRuntimeOptions: Required<TerminalRuntimeOptions>;

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
      .map((record): TerminalDiagnostics => ({
        id: record.info.id,
        kind: record.info.kind,
        status: record.info.status,
        exitCode: record.info.exitCode,
        health: this.terminalHealth(record, now),
        healthDetail: this.terminalHealthDetail(record, now),
        runtime: "tmux",
        tmuxSessionName: record.tmuxSessionName,
        bridgeStatus: record.bridgeDetached ? "detached" : "attached",
        paneStatus: record.paneStatus ?? "unknown",
        cwd: record.info.cwd,
        title: record.info.title,
        command: record.info.command,
        bufferedLines: terminalOutputLineCount(record.recentOutput),
        bufferedChars: record.recentOutput.length,
        transcriptPath: record.transcriptPath,
        lastInputAt: record.lastInputAt ? new Date(record.lastInputAt).toISOString() : null,
        lastOutputAt: record.lastOutputAt ? new Date(record.lastOutputAt).toISOString() : null,
        lastWriteId: record.lastWriteId,
        lastWriteLatencyMs: record.lastWriteLatencyMs ?? null,
      }))
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
      record.recentOutput = appendBoundedLines("", record.recentOutput, this.bufferLineLimit);
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
    await this.syncRuntimeContext();
    const id = this.allocateTerminalId();
    const launch = resolveAgentLaunchPlan(this.runtimeConfig, options.kind, cwd);
    const isAgent = isAgentHarnessKind(options.kind);
    const overlayEnv = isAgent ? agentInstructionOverlayEnv(this.runtimeConfig.workspace, launch.cwd) : {};
    if (isAgent) {
      writeAgentInstructionOverlaysSync(this.runtimeConfig.workspace);
    }
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      SHELL_SESSIONS_DISABLE: "1",
      ...launch.env,
      ...overlayEnv,
    };

    const spawnArgs = options.kind === "codex" ? withCodexMcpOverrides(launch.args, this.runtimeConfig, launch.cwd) : launch.args;
    const createdAt = new Date().toISOString();
    const launchToken = `${id}-${createdAt}-${randomUUID().slice(0, 8)}`;
    const runtimeSession = this.terminalRuntime.createSession({
      sessionToken: launchToken,
      workspaceRoot: this.runtimeConfig.workspace.workspaceRoot,
      command: launch.command,
      args: spawnArgs,
      cwd: launch.cwd,
      env,
      cols: this.terminalRuntimeOptions.initialColumns,
      rows: this.terminalRuntimeOptions.initialRows,
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
      kind: options.kind,
      command: launch.command,
      instructionOverlayPath: overlayEnv.EXO_INSTRUCTIONS ?? null,
      transcriptPath,
      status: "running",
      readiness: initialReadiness(options.kind),
      readinessDetail: initialReadinessDetail(options.kind),
      queuedInputCount: 0,
    };

    const record: TerminalRecord = {
      info,
      process: processHandle,
      tmuxSessionName,
      tmuxPaneId,
      createdAt,
      recentOutput: "",
      transcriptPath,
      pendingWrites: [],
      rawInputBuffer: "",
      lastWriteId: 0,
    };

    if (shouldGateStartupInput(info)) {
      record.readinessTimer = setTimeout(() => {
        const current = this.sessions.get(id);
        if (!current || current.info.readiness !== "starting") {
          return;
        }
        this.markReady(current, "Codex startup grace elapsed.");
      }, this.terminalRuntimeOptions.agentStartupGraceMs);
    }

    this.sessions.set(id, record);

    this.appendTranscript(id, this.transcriptHeader(info));
    this.wireProcess(id, processHandle);
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
    return this.writeToRecord(record, { data, delayedSubmit: false }, shouldQueueWrite(record, data));
  }

  async sendMessage(id: string, message: string, submit = true): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited" || record.bridgeDetached) {
      return { ok: false, delivery: "not-found" };
    }

    this.flushRawInput(record);
    const pendingWrite = {
      data: record.info.kind === "shell" ? message : bracketedPaste(message),
      delayedSubmit: submit,
    };
    return this.writeToRecord(record, pendingWrite, submit && shouldQueueSubmittedAgentMessage(record));
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
    try {
      record.process.kill();
    } catch {
      // The old bridge may already be gone after app sleep, crash, or detach.
    }
    let processHandle: TerminalRuntimeProcess;
    try {
      processHandle = this.terminalRuntime.attachSession({
        sessionName: record.tmuxSessionName,
        paneId: record.tmuxPaneId,
        cwd: record.info.cwd,
        cols: this.terminalRuntimeOptions.initialColumns,
        rows: this.terminalRuntimeOptions.initialRows,
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
    this.wireProcess(id, processHandle);
    this.persistSessions();
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

  readTail(id: string): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    const buffered = record.recentOutput;
    const captured = this.captureTmuxHistory(record);
    if (captured.length > buffered.length) {
      this.cacheCapturedTail(record, captured);
      return record.recentOutput;
    }
    return buffered;
  }

  readTranscript(id: string, tailChars = 0): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    this.flushTranscript(id);
    return this.transcripts.read(record.transcriptPath, tailChars);
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return;
    }

    try {
      record.process.resize(
        Math.max(this.terminalRuntimeOptions.minimumColumns, cols),
        Math.max(this.terminalRuntimeOptions.minimumRows, rows),
      );
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
    if (record.rawInputBuffer.length === 0 || record.info.status !== "running") {
      record.rawInputBuffer = "";
      return;
    }
    const data = record.rawInputBuffer;
    record.rawInputBuffer = "";
    record.process.write(data);
  }

  private wireProcess(id: string, processHandle: TerminalRuntimeProcess) {
    processHandle.onData((data) => {
      const record = this.sessions.get(id);
      const sanitizedData = stripMouseTrackingModes(data);
      if (record) {
        record.bridgeDetached = false;
        this.appendTranscript(id, sanitizedData);
        record.lastOutputAt = Date.now();
        if (record.lastInputAt) {
          record.lastWriteLatencyMs = record.lastOutputAt - record.lastInputAt;
        }
        record.recentOutput = appendBoundedLines(record.recentOutput, sanitizedData, this.bufferLineLimit);
        this.updateAgentReadiness(record);
        record.info.health = this.terminalHealth(record, Date.now());
        record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
        this.emit("data", { id, data: sanitizedData });
      }
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record) {
        return;
      }

      if (record.tmuxSessionName && !record.terminating) {
        if (record.reconnecting) {
          return;
        }
        this.reconcileTmuxState();
        if (record.paneStatus === "missing" || record.paneStatus === "dead") {
          if (isAgentTerminal(record)) {
            this.retireExitedTerminal(record, exitCode);
            return;
          }
          this.markExited(record, exitCode);
          this.persistSessions();
          this.emit("exit", { id, exitCode });
          return;
        }
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

  private allocateTerminalId(): string {
    const id = `term-${this.nextId}`;
    this.nextId += 1;
    this.persistSessions();
    return id;
  }

  private updateAgentReadiness(record: TerminalRecord): void {
    if (record.info.kind !== "codex" || record.info.readiness === "ready") {
      return;
    }

    const startupState = getCodexStartupState(record.recentOutput);
    if (startupState === "ready") {
      this.markReady(record, "Codex chat input is ready.");
      return;
    }

    if (startupState === "trust-blocked") {
      this.clearReadinessTimer(record);
      record.info.readiness = "blocked";
      record.info.readinessDetail = "Codex startup trust prompt is waiting for interactive confirmation.";
      return;
    }

    if (startupState === "update-blocked") {
      this.clearReadinessTimer(record);
      record.info.readiness = "blocked";
      record.info.readinessDetail = "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.";
    }
  }

  private markReady(record: TerminalRecord, detail: string): void {
    this.clearReadinessTimer(record);
    record.info.readiness = "ready";
    record.info.readinessDetail = detail;
    this.flushPendingWrites(record);
  }

  private flushPendingWrites(record: TerminalRecord): void {
    while (record.pendingWrites.length > 0 && record.info.status !== "exited") {
      const pendingWrite = record.pendingWrites.shift();
      if (pendingWrite !== undefined) {
        this.writePendingData(record, pendingWrite);
      }
    }
    this.updateQueuedInputCount(record);
  }

  private writePendingData(record: TerminalRecord, pendingWrite: PendingTerminalWrite): void {
    record.process.write(pendingWrite.data);
    if (pendingWrite.delayedSubmit) {
      setTimeout(() => {
        if (record.info.status === "running") {
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
    if (record.rawInputTimer) {
      clearTimeout(record.rawInputTimer);
      record.rawInputTimer = undefined;
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
        record.info.health = "unhealthy";
        record.info.healthDetail = "Tmux session is missing; transcript remains available.";
        continue;
      }
      if (pane.dead) {
        record.paneStatus = "dead";
        record.info.health = "unhealthy";
        record.info.healthDetail = "Tmux pane is dead; restart or open transcript.";
        continue;
      }
      record.paneStatus = "alive";
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
        const record: TerminalRecord = {
          info: {
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            kind: session.kind,
            command: session.command,
            instructionOverlayPath: session.instructionOverlayPath ?? null,
            transcriptPath: session.transcriptPath,
            status: "exited",
            readiness: session.readiness ?? "ready",
            readinessDetail: session.readinessDetail,
            queuedInputCount: 0,
            health: "exited",
            healthDetail: session.healthDetail ?? (session.exitCode === undefined ? "Process exited." : `Process exited with code ${session.exitCode}.`),
            exitCode: session.exitCode,
          },
          process: noopTerminalProcess(),
          tmuxSessionName: session.tmuxSessionName,
          tmuxPaneId: session.tmuxPaneId ?? "",
          createdAt: session.createdAt,
          paneStatus: "dead",
          recentOutput: "",
          transcriptPath: session.transcriptPath,
          pendingWrites: [],
          rawInputBuffer: "",
          lastWriteId: 0,
          bridgeDetached: true,
        };
        this.sessions.set(session.id, record);
        restored += 1;
        continue;
      }

      const livePane = livePanes.get(session.tmuxSessionName);
      if (!runtimeAvailable || session.status !== "running" || !livePane || this.sessions.has(session.id)) {
        continue;
      }

      try {
        const tmuxPaneId = session.tmuxPaneId ?? livePane.paneId;
        const processHandle = this.terminalRuntime.attachSession({
          sessionName: session.tmuxSessionName,
          paneId: tmuxPaneId,
          cwd: session.cwd,
          cols: this.terminalRuntimeOptions.initialColumns,
          rows: this.terminalRuntimeOptions.initialRows,
        });
        const record: TerminalRecord = {
          info: {
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            kind: session.kind,
            command: session.command,
            instructionOverlayPath: session.instructionOverlayPath ?? null,
            transcriptPath: session.transcriptPath,
            status: "running",
            readiness: "ready",
            queuedInputCount: 0,
          },
          process: processHandle,
          tmuxSessionName: session.tmuxSessionName,
          tmuxPaneId,
          createdAt: session.createdAt,
          paneStatus: "alive",
          recentOutput: "",
          transcriptPath: session.transcriptPath,
          pendingWrites: [],
          rawInputBuffer: "",
          lastWriteId: 0,
        };
        this.sessions.set(session.id, record);
        this.applyRuntimeSessionOptions(record);
        this.wireProcess(session.id, processHandle);
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

  private listRuntimePanes(): TerminalRuntimePaneInfo[] {
    try {
      return this.terminalRuntime.listPanes();
    } catch (error) {
      console.warn("[exo] failed to list tmux panes during terminal restore", {
        error: error instanceof Error ? error.message : String(error),
      });
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

  private captureTmuxHistory(record: TerminalRecord): string {
    try {
      return this.terminalRuntime.captureTail({
        sessionName: record.tmuxSessionName,
        paneId: record.tmuxPaneId,
        historyLimit: this.tmuxHistoryLimit(),
      });
    } catch (error) {
      console.warn("[exo] failed to capture tmux terminal history", {
        id: record.info.id,
        tmuxSessionName: record.tmuxSessionName,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }

  private cacheCapturedTail(record: TerminalRecord, captured: string): void {
    record.recentOutput = appendBoundedLines("", captured, this.bufferLineLimit);
    this.updateAgentReadiness(record);
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

function initialReadiness(kind: TerminalKind): TerminalSessionInfo["readiness"] {
  return kind === "codex" ? "starting" : "ready";
}

function initialReadinessDetail(kind: TerminalKind): string | undefined {
  return kind === "codex" ? "Waiting briefly for Codex startup interstitials." : undefined;
}

function shouldGateStartupInput(info: TerminalSessionInfo): boolean {
  return info.kind === "codex" && info.status === "running" && info.readiness === "starting";
}

function isAgentTerminal(record: TerminalRecord): boolean {
  return isAgentHarnessKind(record.info.kind);
}

function isAgentHarnessKind(kind: TerminalKind): boolean {
  return kind === "claude" || kind === "codex" || kind === "pi" || kind === "hermes";
}

function shouldQueueWrite(record: TerminalRecord, data: string): boolean {
  return (
    record.info.kind === "codex" &&
    record.info.status === "running" &&
    record.info.readiness !== "ready" &&
    looksLikeSubmittedChatMessage(data)
  );
}

function shouldQueueSubmittedAgentMessage(record: TerminalRecord): boolean {
  return (
    record.info.kind === "codex" &&
    record.info.status === "running" &&
    record.info.readiness !== "ready"
  );
}

function shouldCoalesceRawInput(data: string): boolean {
  return data.length > 0 && !/[\u0000-\u001f\u007f]/.test(data);
}

function looksLikeSubmittedChatMessage(data: string): boolean {
  if (!data.endsWith("\r")) {
    return false;
  }

  const body = data.slice(0, -1);
  return body.length > 0 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(body);
}

function bracketedPaste(data: string): string {
  return `\x1b[200~${data}\x1b[201~`;
}

type CodexStartupState = "ready" | "trust-blocked" | "update-blocked" | "unknown";

function getCodexStartupState(buffer: string): CodexStartupState {
  const text = normalizeTerminalText(buffer);
  const readyIndex = latestRegexIndex(text, [
    /\bask codex\b/g,
    /\bopenai codex\b/g,
    /\btype (?:a )?message\b/g,
    /\bwhat can i help\b/g,
    /\bcodex is ready\b/g,
  ]);
  const trustIndex = latestRegexIndex(text, [
    /\bdo you trust\b/g,
    /\btrust (?:the )?(?:files|folder|directory|workspace|repo|repository)\b/g,
    /\b(?:folder|directory|workspace|repo|repository).{0,80}\btrust\b/g,
  ]);
  const updateIndex =
    /\bskip until next version\b/.test(text) ? latestRegexIndex(text, [/\bupdate available\b/g]) : -1;

  if (trustIndex > readyIndex) {
    return "trust-blocked";
  }
  if (updateIndex > readyIndex) {
    return "update-blocked";
  }
  return readyIndex >= 0 ? "ready" : "unknown";
}

function normalizeTerminalText(buffer: string): string {
  return buffer
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function latestRegexIndex(text: string, patterns: RegExp[]): number {
  let latest = -1;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      latest = Math.max(latest, match.index);
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }
  return latest;
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

function appendBoundedLines(current: string, data: string, lineLimit: number | null): string {
  const next = `${current}${data}`;
  if (lineLimit === null) {
    return next;
  }
  const lines = next.split("\n");
  return lines.length <= lineLimit ? next : lines.slice(-lineLimit).join("\n");
}

function terminalOutputLineCount(output: string): number {
  return output.length === 0 ? 0 : output.split("\n").length;
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

function withCodexMcpOverrides(args: string[], config: RuntimeConfig, cwd: string): string[] {
  const exoRoot = findExoRepoRoot(config, cwd);
  if (!exoRoot) {
    return args;
  }

  const spec = buildExoMcpServerSpec({
    exoRoot,
    workspaceRoot: config.workspace.workspaceRoot,
  });

  return [
    ...args,
    "-c",
    `mcp_servers.${spec.serverName}.command=${tomlString(spec.command)}`,
    "-c",
    `mcp_servers.${spec.serverName}.args=${tomlStringArray(spec.args)}`,
    "-c",
    `mcp_servers.${spec.serverName}.env=${tomlInlineTable(spec.env)}`,
  ];
}

function findExoRepoRoot(config: RuntimeConfig, cwd: string): string | null {
  const candidates = [
    cwd,
    process.cwd(),
    config.workspace.workspaceRoot,
    config.workspace.defaultTerminalCwd,
    ...config.workspace.projectRoots.map((root) => root.path),
  ];

  for (const candidate of candidates) {
    const root = findExoRepoRootFrom(candidate);
    if (root) {
      return root;
    }
  }

  return null;
}

function findExoRepoRootFrom(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (isExoRepoRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isExoRepoRoot(candidate: string): boolean {
  const packageJsonPath = path.join(candidate, "package.json");
  const mcpLauncherPath = path.join(candidate, "packages", "mcp", "bin", "exo-mcp.mjs");
  if (!existsSync(packageJsonPath) || !existsSync(mcpLauncherPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    return packageJson.name === "exo";
  } catch {
    return false;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(", ")}}`;
}
