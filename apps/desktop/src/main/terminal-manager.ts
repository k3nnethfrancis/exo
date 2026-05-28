import { EventEmitter } from "node:events";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import pty, { type IPty } from "node-pty";
import { resolveAgentLaunchPlan, resolveRuntimeConfig, syncRuntimeContextFiles, type RuntimeConfig } from "@exo/core";

import type { TerminalCreateOptions, TerminalDiagnostics, TerminalHealthState, TerminalSessionInfo, TerminalKind, TerminalTransport, TerminalWriteResult } from "../shared/api";
import { agentInstructionOverlayEnv, writeAgentInstructionOverlaysSync } from "./agent-instruction-overlays";
import { sanitizeTranscriptName, TerminalTranscriptStore } from "./terminal-transcripts";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
  buffer: TerminalLineBuffer;
  transcriptPath: string;
  transport: TerminalTransport;
  tmuxSession?: string;
  pendingWrites: string[];
  readinessTimer?: NodeJS.Timeout;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
}

interface PersistedAgentSession {
  id: string;
  kind: Exclude<TerminalKind, "shell">;
  cwd: string;
  tmuxSession: string;
  title: string;
  command: string;
  transport?: TerminalTransport;
}

interface PersistedState {
  agents: PersistedAgentSession[];
}

const TMUX_PREFIX = "exo-agent";
const DEFAULT_TMUX_HISTORY_LINES = 1_000_000;
const DEFAULT_BUFFER_LINE_LIMIT = DEFAULT_TMUX_HISTORY_LINES;
const MIN_TMUX_HISTORY_LINES = 500;
const MAX_TMUX_HISTORY_LINES = 1_000_000;
const TMUX_BOOTSTRAP_WINDOW = "exo-bootstrap";
const CODEX_STARTUP_GRACE_MS = 1_500;
const CODEX_QUEUED_SUBMIT_DELAY_MS = 120;

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private bufferLineLimit: number | null;
  private tmuxHistoryLines: number;
  private transcriptRetentionDays: number;
  private nextId = 1;
  private runtimeConfig = resolveRuntimeConfig();
  private stateFilePath: string;
  private transcripts: TerminalTranscriptStore;
  private readonly tmuxAvailable: boolean;
  private agentTransport: TerminalTransport = "direct";
  private nextWriteId = 1;

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_BUFFER_LINE_LIMIT,
    tmuxHistoryLines = DEFAULT_TMUX_HISTORY_LINES,
    transcriptRetentionDays = 0,
  ) {
    super();
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    this.tmuxHistoryLines = normalizeTmuxHistoryLines(tmuxHistoryLines);
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(transcriptRetentionDays);
    this.stateFilePath = path.join(this.runtimeConfig.runtimeRoot, "terminal-state.json");
    this.transcripts = this.createTranscriptStore();
    this.tmuxAvailable = detectTmux();
    if (!this.tmuxAvailable) {
      console.warn(
        "[terminal-manager] tmux not found on PATH — agent terminals will not survive Exo restarts.",
      );
    }
  }

  list(): TerminalSessionInfo[] {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .map((record) => {
        record.info.health = terminalHealth(record, now);
        record.info.healthDetail = terminalHealthDetail(record, now);
        return record.info;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  diagnostics() {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .map((record): TerminalDiagnostics => ({
        id: record.info.id,
        kind: record.info.kind,
        status: record.info.status,
        health: terminalHealth(record, now),
        healthDetail: terminalHealthDetail(record, now),
        cwd: record.info.cwd,
        title: record.info.title,
        command: record.info.command,
        transport: record.transport,
        bufferedLines: record.buffer.lineCount,
        bufferedChars: record.buffer.length,
        transcriptPath: record.transcriptPath,
        tmuxSession: record.tmuxSession ?? null,
        lastInputAt: record.lastInputAt ? new Date(record.lastInputAt).toISOString() : null,
        lastOutputAt: record.lastOutputAt ? new Date(record.lastOutputAt).toISOString() : null,
        lastWriteId: record.lastWriteId,
        lastWriteLatencyMs: record.lastWriteLatencyMs ?? null,
        tmux: record.tmuxSession ? readTmuxDiagnostics(record.tmuxSession) : null,
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
    if (runtimeConfig.runtimeRoot === previousRuntimeRoot) {
      return;
    }

    this.flushAllTranscripts();
    this.stateFilePath = path.join(runtimeConfig.runtimeRoot, "terminal-state.json");
    this.transcripts = this.createTranscriptStore();
  }

  setDefaultCwd(cwd: string) {
    this.defaultCwd = cwd;
  }

  setBufferLineLimit(bufferLineLimit: number | null) {
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    for (const record of this.sessions.values()) {
      record.buffer.setLineLimit(this.bufferLineLimit);
    }
  }

  setTmuxHistoryLines(tmuxHistoryLines: number) {
    this.tmuxHistoryLines = normalizeTmuxHistoryLines(tmuxHistoryLines);
    for (const record of this.sessions.values()) {
      if (record.tmuxSession) {
        setTmuxHistoryLimit(record.tmuxSession, this.tmuxHistoryLines);
      }
    }
  }

  setTranscriptRetentionDays(retentionDays: number) {
    this.flushAllTranscripts();
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(retentionDays);
    this.transcripts = this.createTranscriptStore();
  }

  setAgentTransport(transport: TerminalTransport) {
    this.agentTransport = transport === "tmux" ? "tmux" : "direct";
  }

  async syncRuntimeContext() {
    return syncRuntimeContextFiles(this.runtimeConfig);
  }

  async restoreAgentSessions(): Promise<TerminalSessionInfo[]> {
    if (!this.tmuxAvailable) return [];

    const persisted = this.loadState();
    if (persisted.agents.length === 0) return [];

    const liveTmuxSessions = new Set(listTmuxSessions());
    const restored: TerminalSessionInfo[] = [];
    const survivors: PersistedAgentSession[] = [];

    for (const entry of persisted.agents) {
      if (!liveTmuxSessions.has(entry.tmuxSession)) {
        continue;
      }

      try {
        const info = this.attachExistingAgent(entry);
        restored.push(info);
        survivors.push({ ...entry, id: info.id });
      } catch (err) {
        console.warn(`[terminal-manager] failed to reattach ${entry.tmuxSession}:`, err);
      }
    }

    this.saveState({ agents: survivors });
    return restored;
  }

  async create(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
    const cwd = options.cwd ?? this.defaultCwd;
    await this.syncRuntimeContext();
    const launch = resolveAgentLaunchPlan(this.runtimeConfig, options.kind, cwd);
    const isAgent = options.kind === "claude" || options.kind === "codex";
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

    const requestedTransport = options.transport ?? (isAgent ? this.agentTransport : "direct");
    const useTmux = isAgent && requestedTransport === "tmux" && this.tmuxAvailable;
    const transport: TerminalTransport = useTmux ? "tmux" : "direct";

    let spawnCommand = launch.command;
    let spawnArgs = launch.args;
    let tmuxSession: string | undefined;

    if (useTmux) {
      tmuxSession = `${TMUX_PREFIX}-${options.kind}-${randomBytes(4).toString("hex")}`;
      createTmuxAgentSession(tmuxSession, launch.cwd, launch.command, launch.args, this.tmuxHistoryLines, env);
      spawnCommand = "tmux";
      spawnArgs = ["attach-session", "-t", tmuxSession];
    }

    const processHandle = pty.spawn(spawnCommand, spawnArgs, {
      cols: 120,
      rows: 32,
      cwd: launch.cwd,
      env,
      name: "xterm-256color",
    });

    const id = `term-${this.nextId++}`;
    const transcriptPath = this.makeTranscriptPath(id, options.kind, tmuxSession);
    const info: TerminalSessionInfo = {
      id,
      title: launch.title,
      cwd: launch.cwd,
      kind: options.kind,
      command: launch.command,
      transport,
      instructionOverlayPath: overlayEnv.EXO_INSTRUCTIONS ?? null,
      status: "running",
      readiness: initialReadiness(options.kind),
      readinessDetail: initialReadinessDetail(options.kind),
      queuedInputCount: 0,
    };

    const record: TerminalRecord = {
      info,
      process: processHandle,
      buffer: new TerminalLineBuffer(this.bufferLineLimit),
      transcriptPath,
      transport,
      tmuxSession,
      pendingWrites: [],
      lastWriteId: 0,
    };

    if (shouldGateStartupInput(info)) {
      record.readinessTimer = setTimeout(() => {
        const current = this.sessions.get(id);
        if (!current || current.info.readiness !== "starting") {
          return;
        }
        this.markReady(current, "Codex startup grace elapsed.");
      }, CODEX_STARTUP_GRACE_MS);
    }

    this.sessions.set(id, record);

    this.appendTranscript(id, this.transcriptHeader(info, tmuxSession));
    this.wireProcess(id, processHandle, tmuxSession);

    if (tmuxSession && options.kind !== "shell") {
      this.persistAgent({
        id,
        kind: options.kind,
        cwd: launch.cwd,
        tmuxSession,
        title: launch.title,
        command: launch.command,
        transport,
      });
    }

    this.emit("created", info);
    return info;
  }

  async write(id: string, data: string): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return { ok: true, delivery: "not-found" };
    }

    if (shouldQueueWrite(record, data)) {
      record.pendingWrites.push(data);
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
    record.process.write(data);
    return {
      ok: true,
      delivery: "sent",
      writeId,
      queuedInputCount: record.pendingWrites.length,
      readiness: record.info.readiness,
      readinessDetail: record.info.readinessDetail,
    };
  }

  readBuffer(id: string): string | null {
    const record = this.sessions.get(id);
    if (!record) {
      return null;
    }
    return record.buffer.toString();
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

    record.process.resize(Math.max(20, cols), Math.max(8, rows));
  }

  async kill(id: string, options: { terminate?: boolean } = {}): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) {
      return;
    }

    if (record.tmuxSession && options.terminate) {
      try {
        execFileSync("tmux", ["kill-session", "-t", record.tmuxSession], { stdio: "ignore" });
      } catch (err) {
        console.warn(
          `[terminal-manager] tmux kill-session failed for ${record.tmuxSession}:`,
          err,
        );
      }
      this.removePersistedAgent(id);
    }

    this.flushTranscript(id);
    this.clearReadinessTimer(record);
    record.process.kill();
    this.sessions.delete(id);
  }

  // --- internals ---

  private attachExistingAgent(entry: PersistedAgentSession): TerminalSessionInfo {
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      SHELL_SESSIONS_DISABLE: "1",
    };

    const processHandle = pty.spawn(
      "tmux",
      ["attach-session", "-t", entry.tmuxSession],
      {
        cols: 120,
        rows: 32,
        cwd: entry.cwd,
        env,
        name: "xterm-256color",
      },
    );

    const id = `term-${this.nextId++}`;
    const transcriptPath = this.makeTranscriptPath(id, entry.kind, entry.tmuxSession);
    setTmuxHistoryLimit(entry.tmuxSession, this.tmuxHistoryLines);
    const historySeed = trimTerminalBuffer(captureTmuxHistory(entry.tmuxSession), this.bufferLineLimit);
    const info: TerminalSessionInfo = {
      id,
      title: entry.title,
      cwd: entry.cwd,
      kind: entry.kind,
      command: entry.command,
      transport: "tmux",
      instructionOverlayPath: agentInstructionOverlayEnv(this.runtimeConfig.workspace, entry.cwd).EXO_INSTRUCTIONS,
      status: "running",
      readiness: "ready",
      queuedInputCount: 0,
    };

    this.sessions.set(id, {
      info,
      process: processHandle,
      buffer: new TerminalLineBuffer(this.bufferLineLimit, historySeed),
      transcriptPath,
      transport: "tmux",
      tmuxSession: entry.tmuxSession,
      pendingWrites: [],
      lastWriteId: 0,
    });

    if (!existsSync(transcriptPath)) {
      this.appendTranscript(id, this.transcriptHeader(info, entry.tmuxSession));
      if (historySeed.length > 0) {
        this.appendTranscript(id, historySeed.endsWith("\n") ? historySeed : `${historySeed}\n`);
      }
    }
    this.wireProcess(id, processHandle, entry.tmuxSession);
    return info;
  }

  private wireProcess(id: string, processHandle: IPty, tmuxSession: string | undefined) {
    processHandle.onData((data) => {
      const record = this.sessions.get(id);
      const sanitizedData = stripMouseTrackingModes(data);
      if (record) {
        this.appendTranscript(id, sanitizedData);
        record.lastOutputAt = Date.now();
        if (record.lastInputAt) {
          record.lastWriteLatencyMs = record.lastOutputAt - record.lastInputAt;
        }
        record.buffer.append(sanitizedData);
        this.updateAgentReadiness(record);
        record.info.health = terminalHealth(record, Date.now());
        record.info.healthDetail = terminalHealthDetail(record, Date.now());
        this.emit("data", { id, data: sanitizedData });
      }
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record) {
        return;
      }

      record.info.status = "exited";
      record.info.health = "exited";
      record.info.healthDetail = `Process exited with code ${exitCode}.`;
      record.info.exitCode = exitCode;
      this.clearReadinessTimer(record);
      this.emit("exit", { id, exitCode });

      if (tmuxSession && !tmuxSessionExists(tmuxSession)) {
        this.removePersistedAgent(id);
      }
    });
  }

  private loadState(): PersistedState {
    try {
      if (!existsSync(this.stateFilePath)) return { agents: [] };
      const raw = readFileSync(this.stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      return { agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
    } catch (err) {
      console.warn("[terminal-manager] failed to load terminal state:", err);
      return { agents: [] };
    }
  }

  private saveState(state: PersistedState): void {
    try {
      mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
      writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
      console.warn("[terminal-manager] failed to save terminal state:", err);
    }
  }

  private persistAgent(entry: PersistedAgentSession): void {
    const state = this.loadState();
    const filtered = state.agents.filter(
      (a) => a.tmuxSession !== entry.tmuxSession && a.id !== entry.id,
    );
    filtered.push(entry);
    this.saveState({ agents: filtered });
  }

  private removePersistedAgent(id: string): void {
    const state = this.loadState();
    const filtered = state.agents.filter((a) => a.id !== id);
    if (filtered.length !== state.agents.length) {
      this.saveState({ agents: filtered });
    }
  }

  private makeTranscriptPath(id: string, kind: TerminalKind, tmuxSession?: string): string {
    const name = sanitizeTranscriptName(tmuxSession ?? `${id}-${kind}`);
    return path.join(this.transcripts.directory, `${name}.ansi.log`);
  }

  private transcriptHeader(info: TerminalSessionInfo, tmuxSession: string | undefined): string {
    return [
      "",
      `\n===== Exo terminal transcript started ${new Date().toISOString()} =====`,
      `id: ${info.id}`,
      `kind: ${info.kind}`,
      `cwd: ${info.cwd}`,
      `command: ${info.command}`,
      tmuxSession ? `tmux: ${tmuxSession}` : null,
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

  private updateAgentReadiness(record: TerminalRecord): void {
    if (record.info.kind !== "codex" || record.info.readiness === "ready") {
      return;
    }

    const buffer = record.buffer.toString();
    if (isCodexChatReady(buffer)) {
      this.markReady(record, "Codex chat input is ready.");
      return;
    }

    if (isCodexStartupTrustPrompt(buffer)) {
      this.clearReadinessTimer(record);
      record.info.readiness = "blocked";
      record.info.readinessDetail = "Codex startup trust prompt is waiting for interactive confirmation.";
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
      const data = record.pendingWrites.shift();
      if (data !== undefined) {
        this.writePendingData(record, data);
      }
    }
    this.updateQueuedInputCount(record);
  }

  private writePendingData(record: TerminalRecord, data: string): void {
    if (record.info.kind === "codex" && looksLikeSubmittedChatMessage(data)) {
      const body = data.slice(0, -1);
      record.process.write(body);
      setTimeout(() => {
        if (record.info.status === "running") {
          record.process.write("\r");
        }
      }, CODEX_QUEUED_SUBMIT_DELAY_MS);
      return;
    }

    record.process.write(data);
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

function shouldQueueWrite(record: TerminalRecord, data: string): boolean {
  return (
    record.info.kind === "codex" &&
    record.info.status === "running" &&
    record.info.readiness !== "ready" &&
    looksLikeSubmittedChatMessage(data)
  );
}

function looksLikeSubmittedChatMessage(data: string): boolean {
  if (!data.endsWith("\r")) {
    return false;
  }

  const body = data.slice(0, -1);
  return body.length > 0 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(body);
}

function isCodexStartupTrustPrompt(buffer: string): boolean {
  const text = normalizeTerminalText(buffer);
  return (
    /\bdo you trust\b/.test(text) ||
    /\btrust (?:the )?(?:files|folder|directory|workspace|repo|repository)\b/.test(text) ||
    /\b(?:folder|directory|workspace|repo|repository).{0,80}\btrust\b/.test(text)
  );
}

function isCodexChatReady(buffer: string): boolean {
  const text = normalizeTerminalText(buffer);
  return (
    /\bask codex\b/.test(text) ||
    /\btype (?:a )?message\b/.test(text) ||
    /\bwhat can i help\b/.test(text) ||
    /\bcodex is ready\b/.test(text)
  );
}

function normalizeTerminalText(buffer: string): string {
  return buffer
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripMouseTrackingModes(data: string): string {
  return data
    .replace(/\x1b\[\?(?:9|100[0-7]|1015)(?:;(?:9|100[0-7]|1015))*[hl]/g, "")
    .replace(/\x1b\[\?(?:47|1047|1048|1049)(?:;(?:47|1047|1048|1049))*[hl]/g, "");
}

class TerminalLineBuffer {
  private lines: string[] = [""];

  constructor(private lineLimit: number | null, initial = "") {
    if (initial.length > 0) {
      this.append(initial);
    }
  }

  get length(): number {
    return this.lines.reduce((total, line, index) => total + line.length + (index === 0 ? 0 : 1), 0);
  }

  get lineCount(): number {
    return this.lines.length;
  }

  append(data: string): void {
    if (data.length === 0) {
      return;
    }
    const parts = data.split("\n");
    this.lines[this.lines.length - 1] += parts[0] ?? "";
    for (const part of parts.slice(1)) {
      this.lines.push(part);
    }
    this.trim();
  }

  setLineLimit(lineLimit: number | null): void {
    this.lineLimit = lineLimit;
    this.trim();
  }

  toString(): string {
    return this.lines.join("\n");
  }

  private trim(): void {
    if (this.lineLimit === null || this.lines.length <= this.lineLimit) {
      return;
    }
    this.lines = this.lines.slice(-this.lineLimit);
  }
}

function terminalHealth(record: TerminalRecord, now = Date.now()): TerminalHealthState {
  if (record.info.status === "exited") {
    return "exited";
  }
  if (record.lastInputAt && (!record.lastOutputAt || record.lastOutputAt < record.lastInputAt) && now - record.lastInputAt > 10_000) {
    return "unhealthy";
  }
  if (!record.lastOutputAt || now - record.lastOutputAt > 120_000) {
    return "idle";
  }
  return "healthy";
}

function terminalHealthDetail(record: TerminalRecord, now = Date.now()): string {
  const health = terminalHealth(record, now);
  if (health === "exited") {
    return record.info.exitCode === undefined ? "Process exited." : `Process exited with code ${record.info.exitCode}.`;
  }
  if (health === "unhealthy") {
    return "Input was sent but no terminal output has been observed for more than 10 seconds.";
  }
  if (health === "idle") {
    return "No recent terminal output; terminal may simply be waiting for input.";
  }
  return "Recent terminal input/output observed.";
}

function detectTmux(): boolean {
  try {
    const result = spawnSync("tmux", ["-V"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function listTmuxSessions(): string[] {
  try {
    const out = execFileSync("tmux", ["ls", "-F", "#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function tmuxSessionExists(name: string): boolean {
  try {
    const result = spawnSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function readTmuxDiagnostics(name: string): NonNullable<TerminalDiagnostics["tmux"]> {
  const sessionExists = tmuxSessionExists(name);
  const pane = sessionExists ? readTmuxPane(name) : null;
  const clients = sessionExists ? readTmuxClients(name) : { attachedClients: 0, readonlyClients: 0 };
  return {
    sessionExists,
    paneDead: pane?.paneDead ?? null,
    paneActive: pane?.paneActive ?? null,
    currentCommand: pane?.currentCommand ?? null,
    currentPath: pane?.currentPath ?? null,
    attachedClients: clients.attachedClients,
    readonlyClients: clients.readonlyClients,
  };
}

function readTmuxPane(name: string): { paneDead: boolean; paneActive: boolean; currentCommand: string; currentPath: string } | null {
  try {
    const out = execFileSync("tmux", [
      "list-panes",
      "-t",
      name,
      "-F",
      "#{pane_dead}\t#{pane_active}\t#{pane_current_command}\t#{pane_current_path}",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n").find(Boolean);
    if (!out) {
      return null;
    }
    const [paneDead, paneActive, currentCommand, currentPath] = out.split("\t");
    return {
      paneDead: paneDead === "1",
      paneActive: paneActive === "1",
      currentCommand: currentCommand ?? "",
      currentPath: currentPath ?? "",
    };
  } catch {
    return null;
  }
}

function readTmuxClients(name: string): { attachedClients: number; readonlyClients: number } {
  try {
    const out = execFileSync("tmux", ["list-clients", "-t", name, "-F", "#{client_readonly}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const clients = out.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      attachedClients: clients.length,
      readonlyClients: clients.filter((client) => client === "1").length,
    };
  } catch {
    return { attachedClients: 0, readonlyClients: 0 };
  }
}

function normalizeBufferLineLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value <= 0) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  return Math.max(MIN_TMUX_HISTORY_LINES, Math.min(MAX_TMUX_HISTORY_LINES, Math.floor(value)));
}

function normalizeTmuxHistoryLines(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TMUX_HISTORY_LINES;
  }
  return Math.max(MIN_TMUX_HISTORY_LINES, Math.min(MAX_TMUX_HISTORY_LINES, Math.floor(value)));
}

function normalizeTranscriptRetentionDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(3650, Math.floor(value)));
}

function trimBufferLines(buffer: string, lineLimit: number | null): string {
  if (lineLimit === null) {
    return buffer;
  }

  const lines = buffer.split("\n");
  if (lines.length <= lineLimit) {
    return buffer;
  }
  return lines.slice(-lineLimit).join("\n");
}

function trimTerminalBuffer(buffer: string, lineLimit: number | null): string {
  return trimBufferLines(buffer, lineLimit);
}

function createTmuxAgentSession(name: string, cwd: string, command: string, args: string[], historyLines: number, env: Record<string, string | undefined>): void {
  try {
    execFileSync("tmux", ["new-session", "-d", "-s", name, "-c", cwd, "-n", TMUX_BOOTSTRAP_WINDOW, "sleep", "31536000"], {
      stdio: "ignore",
    });
    setTmuxHistoryLimit(name, historyLines);
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("EXO_") && value !== undefined) {
        execFileSync("tmux", ["set-environment", "-t", name, key, value], { stdio: "ignore" });
      }
    }
    execFileSync("tmux", ["new-window", "-d", "-t", name, "-c", cwd, command, ...args], { stdio: "ignore" });
    execFileSync("tmux", ["kill-window", "-t", `${name}:${TMUX_BOOTSTRAP_WINDOW}`], { stdio: "ignore" });
  } catch (err) {
    try {
      execFileSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
    } catch {
      // best effort cleanup
    }
    throw err;
  }
}

function setTmuxHistoryLimit(name: string, historyLines: number): void {
  try {
    execFileSync("tmux", ["set-option", "-t", name, "history-limit", String(normalizeTmuxHistoryLines(historyLines))], {
      stdio: "ignore",
    });
  } catch (err) {
    console.warn(`[terminal-manager] failed to set tmux history limit for ${name}:`, err);
  }
}

function captureTmuxHistory(name: string): string {
  try {
    return execFileSync("tmux", ["capture-pane", "-p", "-J", "-S", "-", "-E", "-1", "-t", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}
