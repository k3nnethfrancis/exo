import { EventEmitter } from "node:events";
import path from "node:path";

import {
  agentCommandExecutableFingerprint,
  resolveWorkspaceModel,
  type AgentCommand,
} from "@exo/core";
import {
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
} from "@exo/core/terminal-settings";

import type { TerminalCreateOptions, TerminalHealthState, TerminalSessionInfo, TerminalKind, TerminalWriteResult } from "../shared/api";
import type { TerminalProcess, TerminalProcessFactory } from "./terminal-runtime";
import { DirectPtyProcessFactory } from "./terminal-runtime-pty";
import { TerminalGeometryService } from "./terminal-geometry-service";
import { TerminalTailCache, normalizeTailLineLimit } from "./terminal-tail-cache";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: TerminalProcess;
  tailCache: TerminalTailCache;
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

const DEFAULT_LIVE_TAIL_CHARS = 1_000_000;
const MIN_LIVE_TAIL_CHARS = 1_024;

export interface TerminalManagerOptions {
  agentSubmitDelayMs?: number;
  initialColumns?: number;
  initialRows?: number;
  idleThresholdMs?: number;
}

const DEFAULT_TERMINAL_MANAGER_OPTIONS: Required<TerminalManagerOptions> = {
  agentSubmitDelayMs: DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  initialColumns: DEFAULT_TERMINAL_INITIAL_COLUMNS,
  initialRows: DEFAULT_TERMINAL_INITIAL_ROWS,
  idleThresholdMs: DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
};

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private bufferLineLimit: number;
  private nextId = 1;
  private nextWriteId = 1;
  private nextAttachGeneration = 1;
  private terminalOptions: Required<TerminalManagerOptions>;
  private geometryService: TerminalGeometryService;

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_LIVE_TAIL_CHARS,
    _legacyTranscriptRetentionDays = 0,
    terminalOptions: TerminalManagerOptions = {},
    private readonly processFactory: TerminalProcessFactory = new DirectPtyProcessFactory(),
    _legacyHarnessDependencyStarter?: unknown,
  ) {
    super();
    this.bufferLineLimit = normalizeTailCharLimit(bufferLineLimit);
    this.terminalOptions = normalizeTerminalManagerOptions(terminalOptions);
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

  setDefaultCwd(cwd: string) {
    this.defaultCwd = cwd;
  }

  setBufferLineLimit(bufferLineLimit: number | null) {
    this.bufferLineLimit = normalizeTailCharLimit(bufferLineLimit);
    for (const record of this.sessions.values()) {
      record.tailCache.resize(this.bufferLineLimit);
    }
  }

  setTerminalRuntimeOptions(options: TerminalManagerOptions) {
    this.terminalOptions = normalizeTerminalManagerOptions(options);
    this.geometryService = this.createGeometryService();
  }

  async create(options: TerminalManagerCreateOptions): Promise<TerminalSessionInfo> {
    const cwd = options.cwd ?? this.defaultCwd;
    const requestedKind = options.kind ?? options.terminalKind ?? "shell";
    if (requestedKind !== "shell") {
      throw new Error("Terminal launch only supports shell. Configure agents as AgentCommands and invoke them from notes.");
    }
    const shell = shellLauncher();
    return this.createProcessTerminal({
      title: "Shell",
      cwd,
      kind: "shell",
      command: shell.command,
      args: shell.args,
      env: {
        ...process.env,
      },
    });
  }

  async createAgentCommand(command: AgentCommand, cwd: string): Promise<TerminalSessionInfo> {
    const shell = process.env.SHELL || "/bin/zsh";
    const workspace = resolveWorkspaceModel();
    const runtimeRoot = process.env.EXO_RUNTIME_ROOT ?? path.join(workspace.workspaceRoot, ".exo");
    return this.createProcessTerminal({
      title: command.label,
      cwd,
      kind: "shell",
      command: shell,
      args: ["-lc", command.command],
      displayCommand: command.command,
      env: {
        ...process.env,
        EXO_WORKSPACE_ROOT: workspace.workspaceRoot,
        EXO_NOTE_ROOTS: workspace.noteRoots.map((root) => root.path).join(path.delimiter),
        EXO_DEFAULT_TERMINAL_CWD: workspace.defaultTerminalCwd,
        EXO_RUNTIME_ROOT: runtimeRoot,
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
    return this.writeToRecord(record, data);
  }

  async sendMessage(id: string, message: string, submit = true): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!canDeliverInput(record)) {
      return { ok: false, delivery: "not-found" };
    }
    const result = this.writeToRecord(record, message);
    if (submit && canDeliverInput(record)) {
      setTimeout(() => {
        if (canDeliverInput(record)) {
          record.process.write("\r");
        }
      }, this.terminalOptions.agentSubmitDelayMs);
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
    record.process.kill();
    this.sessions.delete(id);
  }

  private async createProcessTerminal(input: {
    title: string;
    cwd: string;
    kind: TerminalKind;
    command: string;
    displayCommand?: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }): Promise<TerminalSessionInfo> {
    const id = this.allocateTerminalId();
    const geometry = this.geometryService.initialDefault();
    const attachSize = this.geometryService.attachSize(geometry);
    const process = this.processFactory.create({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: baseTerminalEnv(input.env),
      cols: attachSize.cols,
      rows: attachSize.rows,
    });
    const info: TerminalSessionInfo = {
      id,
      title: input.title,
      cwd: input.cwd,
      kind: input.kind,
      command: input.displayCommand ?? input.command,
      status: "running",
      geometry,
      attachGeneration: this.allocateAttachGeneration(),
    };
    const record: TerminalRecord = {
      info,
      process,
      tailCache: new TerminalTailCache(this.bufferLineLimit),
      lastWriteId: 0,
    };
    this.sessions.set(id, record);
    this.wireProcess(id, process, info.attachGeneration);
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
    };
  }

  private wireProcess(id: string, processHandle: TerminalProcess, attachGeneration: number) {
    processHandle.onData((data) => {
      const record = this.sessions.get(id);
      if (!record || record.info.attachGeneration !== attachGeneration) {
        return;
      }
      record.bridgeDetached = false;
      record.lastOutputAt = Date.now();
      if (record.lastInputAt) {
        record.lastWriteLatencyMs = record.lastOutputAt - record.lastInputAt;
      }
      record.tailCache.append(data);
      record.info.health = this.terminalHealth(record, Date.now());
      record.info.healthDetail = this.terminalHealthDetail(record, Date.now());
      this.emit("data", { id, generation: attachGeneration, data });
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record || record.info.attachGeneration !== attachGeneration) {
        return;
      }
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
    if (record.lastOutputAt && now - record.lastOutputAt > this.terminalOptions.idleThresholdMs) {
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
    if (record.lastOutputAt && now - record.lastOutputAt > this.terminalOptions.idleThresholdMs) {
      return "No recent terminal output.";
    }
    return "Terminal pty is running.";
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
    return new TerminalGeometryService(this.terminalOptions.initialColumns, this.terminalOptions.initialRows);
  }
}

function canDeliverInput(record: TerminalRecord | undefined): record is TerminalRecord {
  return Boolean(record && record.info.status === "running" && !record.bridgeDetached);
}

function shellLauncher(): { command: string; args: string[] } {
  const command = process.env.EXO_SHELL || process.env.SHELL || "/bin/zsh";
  const args = process.env.EXO_SHELL_ARGS?.split(",").filter(Boolean) ?? (process.env.EXO_SHELL ? [] : ["-l"]);
  return { command, args };
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

function normalizeTailCharLimit(value: number | null | undefined): number {
  if (value === null || value === undefined || value <= 0) {
    return DEFAULT_LIVE_TAIL_CHARS;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_LIVE_TAIL_CHARS;
  }
  return Math.max(MIN_LIVE_TAIL_CHARS, Math.floor(value));
}

function normalizeTerminalManagerOptions(options: TerminalManagerOptions): Required<TerminalManagerOptions> {
  return {
    agentSubmitDelayMs: integerAtLeast(options.agentSubmitDelayMs, DEFAULT_TERMINAL_MANAGER_OPTIONS.agentSubmitDelayMs, 0),
    initialColumns: integerAtLeast(options.initialColumns, DEFAULT_TERMINAL_MANAGER_OPTIONS.initialColumns, 20),
    initialRows: integerAtLeast(options.initialRows, DEFAULT_TERMINAL_MANAGER_OPTIONS.initialRows, 8),
    idleThresholdMs: integerAtLeast(options.idleThresholdMs, DEFAULT_TERMINAL_MANAGER_OPTIONS.idleThresholdMs, 1_000),
  };
}

function integerAtLeast(value: number | undefined, fallback: number, min: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value as number));
}
