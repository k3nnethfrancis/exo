import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  agentCommandExecutableFingerprint,
  resolveRuntimeConfig,
  syncRuntimeContextFiles,
  type AgentCommand,
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
import { terminalDiagnosticsFromRecord } from "./terminal-diagnostics";
import type { TerminalRuntime, TerminalRuntimeProcess } from "./terminal-runtime";
import { DirectPtyTerminalRuntime } from "./terminal-runtime-pty";
import { TerminalGeometryService } from "./terminal-geometry-service";
import { TerminalTailCache, normalizeTailLineLimit } from "./terminal-tail-cache";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: TerminalRuntimeProcess;
  runtimeSessionName: string;
  runtimePaneId: string;
  createdAt: string;
  tailCache: TerminalTailCache;
  rawInputBuffer: string;
  rawInputTimer?: NodeJS.Timeout;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
  bridgeDetached?: boolean;
  terminating?: boolean;
}

type TerminalManagerCreateOptions = TerminalCreateOptions & {
  kind?: TerminalKind;
};

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
  private nextId = 1;
  private runtimeConfig = resolveRuntimeConfig();
  private nextWriteId = 1;
  private nextAttachGeneration = 1;
  private terminalRuntimeOptions: Required<TerminalRuntimeOptions>;
  private geometryService: TerminalGeometryService;

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_BUFFER_LINE_LIMIT,
    _transcriptRetentionDays = 0,
    terminalRuntimeOptions: TerminalRuntimeOptions = {},
    private readonly terminalRuntime: TerminalRuntime = new DirectPtyTerminalRuntime(),
    _harnessDependencyStarter?: unknown,
  ) {
    super();
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    this.terminalRuntimeOptions = normalizeTerminalRuntimeOptions(terminalRuntimeOptions);
    this.geometryService = this.createGeometryService();
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
    return Array.from(this.sessions.values())
      .map((record) =>
        terminalDiagnosticsFromRecord({
          info: record.info,
          kind: record.info.kind,
          status: record.info.status,
          exitCode: record.info.exitCode,
          health: this.terminalHealth(record, now),
          healthDetail: this.terminalHealthDetail(record, now),
          runtime: this.terminalRuntime.kind,
          sessionName: record.runtimeSessionName,
          paneId: record.runtimePaneId,
          bridgeDetached: record.bridgeDetached,
          cwd: record.info.cwd,
          title: record.info.title,
          command: record.info.command,
          bufferedLines: record.tailCache.lineCount(),
          bufferedChars: record.tailCache.charCount(),
          transcriptPath: record.info.transcriptPath,
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
    if (runtimeConfig.runtimeRoot !== this.runtimeConfig.runtimeRoot) {
      this.killAllForRuntimeSwitch();
    }
    this.runtimeConfig = runtimeConfig;
  }

  setDefaultCwd(cwd: string) {
    this.defaultCwd = cwd;
  }

  setBufferLineLimit(bufferLineLimit: number | null) {
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    for (const record of this.sessions.values()) {
      record.tailCache.resize(this.bufferLineLimit);
    }
  }

  setTranscriptRetentionDays(_retentionDays: number) {
    // Direct-pty V1 does not persist terminal transcripts.
  }

  setTerminalRuntimeOptions(options: TerminalRuntimeOptions) {
    this.terminalRuntimeOptions = normalizeTerminalRuntimeOptions(options);
    this.geometryService = this.createGeometryService();
  }

  async syncRuntimeContext() {
    return syncRuntimeContextFiles(this.runtimeConfig);
  }

  async create(options: TerminalManagerCreateOptions): Promise<TerminalSessionInfo> {
    const cwd = options.cwd ?? this.defaultCwd;
    const requestedKind = options.kind ?? options.terminalKind ?? "shell";
    if (requestedKind !== "shell" || options.harnessId) {
      throw new Error("Terminal launch only supports shell. Configure agents as AgentCommands and invoke them from notes.");
    }
    const shell = process.env.SHELL || "/bin/zsh";
    return this.createProcessTerminal({
      title: "Shell",
      cwd,
      kind: "shell",
      harnessId: null,
      command: shell,
      args: ["-l"],
      env: {
        ...process.env,
      },
    });
  }

  async createAgentCommand(command: AgentCommand, cwd: string): Promise<TerminalSessionInfo> {
    const shell = process.env.SHELL || "/bin/zsh";
    return this.createProcessTerminal({
      title: command.label,
      cwd,
      kind: "shell",
      harnessId: null,
      command: shell,
      args: ["-lc", command.command],
      displayCommand: command.command,
      env: {
        ...process.env,
        EXO_WORKSPACE_ROOT: this.runtimeConfig.workspace.workspaceRoot,
        EXO_NOTE_ROOTS: this.runtimeConfig.workspace.noteRoots.map((root) => root.path).join(path.delimiter),
        EXO_PROJECT_ROOTS: this.runtimeConfig.workspace.projectRoots.map((root) => root.path).join(path.delimiter),
        EXO_DEFAULT_TERMINAL_CWD: this.runtimeConfig.workspace.defaultTerminalCwd,
        EXO_RUNTIME_ROOT: this.runtimeConfig.runtimeRoot,
        EXO_AGENT_COMMAND_ID: command.id,
        EXO_AGENT_COMMAND_HANDLE: command.handle,
        EXO_AGENT_COMMAND_FINGERPRINT: agentCommandExecutableFingerprint(command),
      },
    });
  }

  async write(id: string, data: string): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!canDeliverInput(record)) {
      return { ok: false, delivery: "not-found" };
    }
    if (shouldCoalesceRawInput(data)) {
      return this.queueRawInput(record, data);
    }
    this.flushRawInput(record);
    return this.writeToRecord(record, data);
  }

  async sendMessage(id: string, message: string, submit = true): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!canDeliverInput(record)) {
      return { ok: false, delivery: "not-found" };
    }
    this.flushRawInput(record);
    const result = this.writeToRecord(record, message);
    if (submit && canDeliverInput(record)) {
      setTimeout(() => {
        if (canDeliverInput(record)) {
          record.process.write("\r");
        }
      }, this.terminalRuntimeOptions.agentSubmitDelayMs);
    }
    return result;
  }

  readTail(id: string, options: { maxLines?: number } = {}): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    return tailLines(record.tailCache.text(), normalizeTailLineLimit(options.maxLines));
  }

  readTranscript(id: string, tailChars = 0): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    const text = record.tailCache.text();
    return tailChars > 0 ? text.slice(-tailChars) : text;
  }

  readRestoreSnapshot(id: string): string | null {
    return this.sessions.has(id) ? "" : null;
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return;
    }
    const geometry = this.geometryService.rendererFit(cols, rows);
    record.info.geometry = geometry;
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
    record.terminating = true;
    this.discardRawInput(record, "terminal was killed before buffered input could be delivered");
    try {
      this.terminalRuntime.terminate(record.runtimeSessionName);
    } catch {
      record.process.kill();
    }
    this.sessions.delete(id);
  }

  private async createProcessTerminal(input: {
    title: string;
    cwd: string;
    kind: TerminalKind;
    harnessId: string | null;
    command: string;
    displayCommand?: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }): Promise<TerminalSessionInfo> {
    await this.syncRuntimeContext();
    const id = this.allocateTerminalId();
    const createdAt = new Date().toISOString();
    const launchToken = `${id}-${createdAt}-${randomUUID().slice(0, 8)}`;
    const geometry = this.geometryService.initialDefault(createdAt);
    const attachSize = this.geometryService.attachSize(geometry);
    const runtimeSession = this.terminalRuntime.createSession({
      sessionToken: launchToken,
      workspaceRoot: this.runtimeConfig.workspace.workspaceRoot,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: baseTerminalEnv(input.env),
      cols: attachSize.cols,
      rows: attachSize.rows,
      historyLimit: this.bufferLineLimit ?? DEFAULT_LIVE_SCROLLBACK_LINES,
    });
    const info: TerminalSessionInfo = {
      id,
      title: input.title,
      cwd: input.cwd,
      ...terminalSessionIdentity(input.kind, input.harnessId ?? input.kind),
      kind: input.kind,
      command: input.displayCommand ?? input.command,
      instructionOverlayPath: null,
      status: "running",
      readiness: "ready",
      queuedInputCount: 0,
      geometry,
      attachGeneration: this.allocateAttachGeneration(),
    };
    const record: TerminalRecord = {
      info,
      process: runtimeSession.process,
      runtimeSessionName: runtimeSession.sessionName,
      runtimePaneId: runtimeSession.paneId,
      createdAt,
      tailCache: new TerminalTailCache(this.bufferLineLimit),
      rawInputBuffer: "",
      lastWriteId: 0,
    };
    this.sessions.set(id, record);
    this.wireProcess(id, runtimeSession.process, info.attachGeneration);
    this.emit("created", info);
    return info;
  }

  private writeToRecord(record: TerminalRecord, data: string): TerminalWriteResult {
    const writeId = this.nextWriteId++;
    record.lastWriteId = writeId;
    record.lastInputAt = Date.now();
    try {
      record.process.write(data);
    } catch (error) {
      record.bridgeDetached = true;
      record.info.health = "unhealthy";
      record.info.healthDetail = error instanceof Error ? `Terminal write failed: ${error.message}` : "Terminal write failed.";
      return { ok: false, delivery: "not-found" };
    }
    return {
      ok: true,
      delivery: "sent",
      writeId,
      queuedInputCount: 0,
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
      queuedInputCount: 0,
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

  private wireProcess(id: string, processHandle: TerminalRuntimeProcess, attachGeneration: number) {
    processHandle.onData((data) => {
      const record = this.sessions.get(id);
      if (!record || record.info.attachGeneration !== attachGeneration) {
        return;
      }
      const sanitizedData = stripMouseTrackingModes(data);
      record.bridgeDetached = false;
      record.lastOutputAt = Date.now();
      if (record.lastInputAt) {
        record.lastWriteLatencyMs = record.lastOutputAt - record.lastInputAt;
      }
      record.tailCache.append(sanitizedData);
      record.info.health = this.terminalHealth(record, Date.now());
      record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
      this.emit("data", { id, generation: attachGeneration, data: sanitizedData });
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record || record.info.attachGeneration !== attachGeneration) {
        return;
      }
      this.discardRawInput(record, "terminal exited before buffered input could be delivered");
      record.info.status = "exited";
      record.info.health = "exited";
      record.info.healthDetail = exitCode === undefined ? "Process exited." : `Process exited with code ${exitCode}.`;
      record.info.exitCode = exitCode;
      this.emit("exit", { id, exitCode });
    });
  }

  private terminalHealth(record: TerminalRecord, now = Date.now()): TerminalHealthState {
    if (record.info.status === "exited") {
      return "exited";
    }
    if (record.bridgeDetached) {
      return "unhealthy";
    }
    if (record.lastOutputAt && now - record.lastOutputAt > this.terminalRuntimeOptions.idleThresholdMs) {
      return "idle";
    }
    return "healthy";
  }

  private terminalHealthDetail(record: TerminalRecord, now = Date.now()): string {
    if (record.info.status === "exited") {
      return record.info.exitCode === undefined ? "Process exited." : `Process exited with code ${record.info.exitCode}.`;
    }
    if (record.bridgeDetached) {
      return "Terminal pty is detached or unavailable.";
    }
    if (record.lastOutputAt && now - record.lastOutputAt > this.terminalRuntimeOptions.idleThresholdMs) {
      return "No recent terminal output.";
    }
    return "Terminal pty is running.";
  }

  private killAllForRuntimeSwitch(): void {
    for (const record of this.sessions.values()) {
      this.discardRawInput(record, "terminal runtime root changed");
      try {
        record.process.kill();
      } catch {
        // Runtime switch cleanup should not block workspace activation.
      }
    }
    this.sessions.clear();
  }

  private allocateTerminalId(): string {
    const id = `term-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private allocateAttachGeneration(): number {
    const generation = this.nextAttachGeneration;
    this.nextAttachGeneration += 1;
    return generation;
  }

  private createGeometryService(): TerminalGeometryService {
    return new TerminalGeometryService(this.terminalRuntimeOptions.initialColumns, this.terminalRuntimeOptions.initialRows);
  }
}

function canDeliverInput(record: TerminalRecord | undefined): record is TerminalRecord {
  return Boolean(record && record.info.status === "running" && !record.bridgeDetached);
}

function shouldCoalesceRawInput(_data: string): boolean {
  return false;
}

function stripMouseTrackingModes(data: string): string {
  return data.replace(/\x1b\[\?(?:9|100[0-7]|1015)(?:;(?:9|100[0-7]|1015))*[hl]/g, "");
}

function terminalSessionIdentity(kind: TerminalKind, harnessId: string = kind): Pick<TerminalSessionInfo, "terminalKind" | "harnessId"> {
  return {
    terminalKind: kind === "shell" ? "shell" : "agent",
    harnessId: kind === "shell" && harnessId === "shell" ? null : harnessId,
  };
}

function baseTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_CTYPE: process.env.LC_CTYPE ?? process.env.LANG ?? "en_US.UTF-8",
    SHELL_SESSIONS_DISABLE: "1",
    ...env,
  };
}

function tailLines(text: string, maxLines: number | undefined): string {
  if (!maxLines || maxLines <= 0) {
    return text;
  }
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join("\n");
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
