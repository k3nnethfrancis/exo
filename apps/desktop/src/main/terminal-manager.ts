import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  detectTmux,
  exoTmuxSessionName,
  parseTmuxPaneList,
  shellCommand,
  TmuxCommandRunner,
  tmuxEnvironmentArgs,
  type TmuxAvailable,
  type TmuxPaneInfo,
} from "./terminal-tmux";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
  tmuxSessionName: string;
  createdAt: string;
  buffer: TerminalLineBuffer;
  transcriptPath: string;
  pendingWrites: PendingTerminalWrite[];
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

interface PersistedTerminalSession {
  id: string;
  title: string;
  cwd: string;
  kind: TerminalKind;
  command: string;
  instructionOverlayPath?: string | null;
  tmuxSessionName: string;
  transcriptPath: string;
  createdAt: string;
  lastAttachedAt: string | null;
  status: "running" | "exited" | "missing" | "unhealthy";
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
  private sessionRegistryPath = this.makeSessionRegistryPath();

  constructor(
    private defaultCwd: string,
    bufferLineLimit: number | null = DEFAULT_BUFFER_LINE_LIMIT,
    transcriptRetentionDays = 0,
  ) {
    super();
    this.bufferLineLimit = normalizeBufferLineLimit(bufferLineLimit);
    this.transcriptRetentionDays = normalizeTranscriptRetentionDays(transcriptRetentionDays);
    this.transcripts = this.createTranscriptStore();
    this.restorePersistedSessions();
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
    this.reconcileTmuxState();
    return Array.from(this.sessions.values())
      .map((record): TerminalDiagnostics => ({
        id: record.info.id,
        kind: record.info.kind,
        status: record.info.status,
        health: terminalHealth(record, now),
        healthDetail: terminalHealthDetail(record, now),
        runtime: "tmux",
        tmuxSessionName: record.tmuxSessionName,
        bridgeStatus: record.bridgeDetached ? "detached" : "attached",
        paneStatus: record.paneStatus ?? "unknown",
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
    this.sessionRegistryPath = this.makeSessionRegistryPath();
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
    const id = `term-${this.nextId++}`;
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
    const createdAt = new Date().toISOString();
    const launchToken = `${id}-${createdAt}-${randomUUID().slice(0, 8)}`;
    const tmux = this.requireTmuxRuntime();
    const tmuxSessionName = exoTmuxSessionName(launchToken, this.runtimeConfig.workspace.workspaceRoot);
    tmux.runner.run(
      [
        "new-session",
        "-d",
        "-s",
        tmuxSessionName,
        "-c",
        launch.cwd,
        ...tmuxEnvironmentArgs(env),
        shellCommand(launch.command, spawnArgs),
      ],
      {
        cwd: launch.cwd,
        env,
      },
    );

    const processHandle = pty.spawn(tmux.availability.path, ["attach-session", "-t", tmuxSessionName], {
      cols: 120,
      rows: 32,
      cwd: launch.cwd,
      env,
      name: "xterm-256color",
    });

    const transcriptPath = this.makeTranscriptPath(id, options.kind, createdAt, launchToken);
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
      tmuxSessionName,
      createdAt,
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
    this.persistSessions();

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

  async reconnect(id: string): Promise<TerminalSessionInfo | null> {
    const record = this.sessions.get(id);
    if (!record || record.info.status === "exited") {
      return null;
    }

    this.reconcileTmuxState();
    if (record.paneStatus !== "alive") {
      record.info.health = "unhealthy";
      record.info.healthDetail = terminalHealthDetail(record, Date.now());
      return record.info;
    }

    const tmux = this.requireTmuxRuntime();
    record.reconnecting = true;
    try {
      record.process.kill();
    } catch {
      // The old bridge may already be gone after app sleep, crash, or detach.
    }
    let processHandle: IPty;
    try {
      processHandle = this.attachTmuxSession(tmux.availability, record.tmuxSessionName, record.info.cwd);
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
    record.info.health = terminalHealth(record, Date.now());
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

    try {
      record.process.resize(Math.max(20, cols), Math.max(8, rows));
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
      const tmux = this.requireTmuxRuntime();
      tmux.runner.run(["kill-session", "-t", record.tmuxSessionName]);
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

  private wireProcess(id: string, processHandle: IPty) {
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

      if (record.tmuxSessionName && !record.terminating) {
        if (record.reconnecting) {
          return;
        }
        this.reconcileTmuxState();
        if (isAgentTerminal(record) && (record.paneStatus === "missing" || record.paneStatus === "dead")) {
          this.retireExitedTerminal(record, exitCode);
          return;
        }
        record.info.health = "unhealthy";
        record.info.healthDetail = `Tmux attach bridge exited with code ${exitCode ?? "unknown"}; session may still be running.`;
        record.bridgeDetached = true;
        return;
      }

      this.markExited(record, exitCode);
      this.emit("exit", { id, exitCode });
    });
  }

  private retireExitedTerminal(record: TerminalRecord, exitCode?: number): void {
    this.flushTranscript(record.info.id);
    this.markExited(record, exitCode);
    this.sessions.delete(record.info.id);
    this.persistSessions();
    this.emit("exit", { id: record.info.id, exitCode });
  }

  private markExited(record: TerminalRecord, exitCode?: number): void {
    record.info.status = "exited";
    record.info.health = "exited";
    record.info.healthDetail = `Process exited with code ${exitCode}.`;
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

  private makeSessionRegistryPath(): string {
    return path.join(this.runtimeConfig.runtimeRoot, "terminal-sessions.json");
  }

  private updateAgentReadiness(record: TerminalRecord): void {
    if (record.info.kind !== "codex" || record.info.readiness === "ready") {
      return;
    }

    const startupState = getCodexStartupState(record.buffer.toString());
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

  private requireTmuxRuntime(): { availability: TmuxAvailable; runner: TmuxCommandRunner } {
    const availability = detectTmux();
    if (!availability.available) {
      throw new Error(availability.reason);
    }
    return {
      availability,
      runner: new TmuxCommandRunner(availability.path),
    };
  }

  private attachTmuxSession(availability: TmuxAvailable, tmuxSessionName: string, cwd: string): IPty {
    return pty.spawn(availability.path, ["attach-session", "-t", tmuxSessionName], {
      cols: 120,
      rows: 32,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        SHELL_SESSIONS_DISABLE: "1",
      },
      name: "xterm-256color",
    });
  }

  reconcileTmuxState(): void {
    if (this.sessions.size === 0) {
      return;
    }
    const availability = detectTmux();
    if (!availability.available) {
      for (const record of this.sessions.values()) {
        record.paneStatus = "unknown";
        record.info.health = "unhealthy";
        record.info.healthDetail = availability.reason;
      }
      return;
    }
    const runner = new TmuxCommandRunner(availability.path);
    const panes = new Map(this.listTmuxPanes(runner).map((pane) => [pane.sessionName, pane]));
    for (const record of this.sessions.values()) {
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
    const persisted = this.readPersistedSessions();
    if (persisted.length === 0) {
      return;
    }

    const availability = detectTmux();
    if (!availability.available) {
      console.warn("[exo] unable to restore terminal sessions because tmux is unavailable", {
        reason: availability.reason,
        attempted: availability.attempted,
      });
      return;
    }

    const runner = new TmuxCommandRunner(availability.path);
    const liveSessions = new Set(this.listTmuxPanes(runner).filter((pane) => !pane.dead).map((pane) => pane.sessionName));
    let restored = 0;
    for (const session of persisted) {
      if (session.status !== "running" || !liveSessions.has(session.tmuxSessionName) || this.sessions.has(session.id)) {
        continue;
      }

      try {
        const processHandle = this.attachTmuxSession(availability, session.tmuxSessionName, session.cwd);
        const record: TerminalRecord = {
          info: {
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            kind: session.kind,
            command: session.command,
            instructionOverlayPath: session.instructionOverlayPath ?? null,
            status: "running",
            readiness: "ready",
            queuedInputCount: 0,
          },
          process: processHandle,
          tmuxSessionName: session.tmuxSessionName,
          createdAt: session.createdAt,
          paneStatus: "alive",
          buffer: new TerminalLineBuffer(this.bufferLineLimit),
          transcriptPath: session.transcriptPath,
          pendingWrites: [],
          lastWriteId: 0,
        };
        this.sessions.set(session.id, record);
        this.wireProcess(session.id, processHandle);
        this.nextId = Math.max(this.nextId, terminalNumericId(session.id) + 1);
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

  private listTmuxPanes(runner: TmuxCommandRunner): TmuxPaneInfo[] {
    try {
      const raw = runner.run([
        "list-panes",
        "-a",
        "-F",
        "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_current_path}",
      ]);
      return parseTmuxPaneList(raw);
    } catch (error) {
      console.warn("[exo] failed to list tmux panes during terminal restore", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private readPersistedSessions(): PersistedTerminalSession[] {
    if (!existsSync(this.sessionRegistryPath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(this.sessionRegistryPath, "utf8")) as { sessions?: unknown };
      if (!Array.isArray(parsed.sessions)) {
        return [];
      }
      return parsed.sessions.filter(isPersistedTerminalSession);
    } catch (error) {
      console.warn("[exo] failed to read terminal session registry", {
        path: this.sessionRegistryPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private persistSessions(): void {
    const sessions: PersistedTerminalSession[] = Array.from(this.sessions.values()).map((record) => ({
      id: record.info.id,
      title: record.info.title,
      cwd: record.info.cwd,
      kind: record.info.kind,
      command: record.info.command,
      instructionOverlayPath: record.info.instructionOverlayPath ?? null,
      tmuxSessionName: record.tmuxSessionName,
      transcriptPath: record.transcriptPath,
      createdAt: record.createdAt,
      lastAttachedAt: new Date().toISOString(),
      status: record.info.status === "running" ? "running" : "exited",
    }));
    mkdirSync(path.dirname(this.sessionRegistryPath), { recursive: true });
    writeFileSync(this.sessionRegistryPath, JSON.stringify({ version: 1, sessions }, null, 2));
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

function isAgentTerminal(record: TerminalRecord): boolean {
  return record.info.kind === "claude" || record.info.kind === "codex";
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
  if (record.paneStatus === "missing" || record.paneStatus === "dead" || record.bridgeDetached) {
    return "unhealthy";
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
  if (record.paneStatus === "missing") {
    return "Tmux session is missing; transcript remains available.";
  }
  if (record.paneStatus === "dead") {
    return "Tmux pane is dead; restart or open transcript.";
  }
  if (record.bridgeDetached) {
    return "Tmux session is alive but Exo's attach bridge is detached; reconnect the terminal.";
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

function terminalNumericId(id: string): number {
  const match = /^term-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function isPersistedTerminalSession(value: unknown): value is PersistedTerminalSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Partial<PersistedTerminalSession>;
  return (
    typeof session.id === "string" &&
    typeof session.title === "string" &&
    typeof session.cwd === "string" &&
    (session.kind === "shell" || session.kind === "claude" || session.kind === "codex") &&
    typeof session.command === "string" &&
    typeof session.tmuxSessionName === "string" &&
    typeof session.transcriptPath === "string" &&
    (session.status === "running" || session.status === "exited" || session.status === "missing" || session.status === "unhealthy")
  );
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
