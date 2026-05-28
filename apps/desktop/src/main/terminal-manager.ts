import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import pty, { type IPty } from "node-pty";
import {
  buildExoMcpServerSpec,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  syncRuntimeContextFiles,
  type RuntimeConfig,
} from "@exo/core";

import type { TerminalCreateOptions, TerminalDiagnostics, TerminalHealthState, TerminalSessionInfo, TerminalKind, TerminalWriteResult } from "../shared/api";
import { agentInstructionOverlayEnv, writeAgentInstructionOverlaysSync } from "./agent-instruction-overlays";
import { sanitizeTranscriptName, TerminalTranscriptStore } from "./terminal-transcripts";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
  buffer: TerminalLineBuffer;
  transcriptPath: string;
  pendingWrites: PendingTerminalWrite[];
  readinessTimer?: NodeJS.Timeout;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
}

interface PendingTerminalWrite {
  data: string;
  delayedSubmit: boolean;
}

const DEFAULT_LIVE_SCROLLBACK_LINES = 1_000_000;
const DEFAULT_BUFFER_LINE_LIMIT = DEFAULT_LIVE_SCROLLBACK_LINES;
const MIN_LIVE_SCROLLBACK_LINES = 500;
const MAX_LIVE_SCROLLBACK_LINES = 1_000_000;
const CODEX_STARTUP_GRACE_MS = 1_500;
const CODEX_QUEUED_SUBMIT_DELAY_MS = 120;

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private bufferLineLimit: number | null;
  private transcriptRetentionDays: number;
  private nextId = 1;
  private runtimeConfig = resolveRuntimeConfig();
  private transcripts: TerminalTranscriptStore;
  private nextWriteId = 1;

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_BUFFER_LINE_LIMIT,
    transcriptRetentionDays = 0,
  ) {
    super();
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(transcriptRetentionDays);
    this.transcripts = this.createTranscriptStore();
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
        bufferedLines: record.buffer.lineCount,
        bufferedChars: record.buffer.length,
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
    if (runtimeConfig.runtimeRoot === previousRuntimeRoot) {
      return;
    }

    this.flushAllTranscripts();
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

  setTranscriptRetentionDays(retentionDays: number) {
    this.flushAllTranscripts();
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(retentionDays);
    this.transcripts = this.createTranscriptStore();
  }

  async syncRuntimeContext() {
    return syncRuntimeContextFiles(this.runtimeConfig);
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

    const spawnArgs = options.kind === "codex" ? withCodexMcpOverrides(launch.args, this.runtimeConfig, launch.cwd) : launch.args;
    const processHandle = pty.spawn(launch.command, spawnArgs, {
      cols: 120,
      rows: 32,
      cwd: launch.cwd,
      env,
      name: "xterm-256color",
    });

    const id = `term-${this.nextId++}`;
    const transcriptPath = this.makeTranscriptPath(id, options.kind);
    const info: TerminalSessionInfo = {
      id,
      title: launch.title,
      cwd: launch.cwd,
      kind: options.kind,
      command: launch.command,
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

    this.appendTranscript(id, this.transcriptHeader(info));
    this.wireProcess(id, processHandle);

    this.emit("created", info);
    return info;
  }

  async write(id: string, data: string): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return { ok: true, delivery: "not-found" };
    }

    return this.writeToRecord(record, { data, delayedSubmit: false }, shouldQueueWrite(record, data));
  }

  async sendMessage(id: string, message: string, submit = true): Promise<TerminalWriteResult> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return { ok: true, delivery: "not-found" };
    }

    const pendingWrite = {
      data: record.info.kind === "shell" ? message : bracketedPaste(message),
      delayedSubmit: submit,
    };
    return this.writeToRecord(record, pendingWrite, submit && shouldQueueSubmittedAgentMessage(record));
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

  async kill(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) {
      return;
    }

    this.flushTranscript(id);
    this.clearReadinessTimer(record);
    record.process.kill();
    this.sessions.delete(id);
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

  private wireProcess(id: string, processHandle: IPty) {
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
    });
  }

  private makeTranscriptPath(id: string, kind: TerminalKind): string {
    const name = sanitizeTranscriptName(`${id}-${kind}`);
    return path.join(this.transcripts.directory, `${name}.ansi.log`);
  }

  private transcriptHeader(info: TerminalSessionInfo): string {
    return [
      "",
      `\n===== Exo terminal transcript started ${new Date().toISOString()} =====`,
      `id: ${info.id}`,
      `kind: ${info.kind}`,
      `cwd: ${info.cwd}`,
      `command: ${info.command}`,
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
      }, CODEX_QUEUED_SUBMIT_DELAY_MS);
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

function shouldQueueSubmittedAgentMessage(record: TerminalRecord): boolean {
  return (
    record.info.kind === "codex" &&
    record.info.status === "running" &&
    record.info.readiness !== "ready"
  );
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

function normalizeBufferLineLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value <= 0) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_BUFFER_LINE_LIMIT;
  }
  return Math.max(MIN_LIVE_SCROLLBACK_LINES, Math.min(MAX_LIVE_SCROLLBACK_LINES, Math.floor(value)));
}

function normalizeTranscriptRetentionDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(3650, Math.floor(value)));
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
