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
import { resolveAgentLaunchPlan, resolveRuntimeConfig, syncRuntimeContextFiles } from "@exo/core";

import type { TerminalCreateOptions, TerminalSessionInfo, TerminalKind } from "../shared/api";
import { sanitizeTranscriptName, TerminalTranscriptStore } from "./terminal-transcripts";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
  buffer: string;
  transcriptPath: string;
  tmuxSession?: string;
}

interface PersistedAgentSession {
  id: string;
  kind: Exclude<TerminalKind, "shell">;
  cwd: string;
  tmuxSession: string;
  title: string;
  command: string;
}

interface PersistedState {
  agents: PersistedAgentSession[];
}

const TMUX_PREFIX = "exo-agent";

export class TerminalManager extends EventEmitter {
  private static readonly maxBufferLength = 12_000;
  private readonly sessions = new Map<string, TerminalRecord>();
  private nextId = 1;
  private readonly runtimeConfig = resolveRuntimeConfig();
  private readonly stateFilePath: string;
  private readonly transcripts: TerminalTranscriptStore;
  private readonly tmuxAvailable: boolean;

  constructor(private readonly defaultCwd: string) {
    super();
    this.stateFilePath = path.join(this.runtimeConfig.runtimeRoot, "terminal-state.json");
    this.transcripts = new TerminalTranscriptStore(path.join(this.runtimeConfig.runtimeRoot, "terminal-transcripts"));
    this.tmuxAvailable = detectTmux();
    if (!this.tmuxAvailable) {
      console.warn(
        "[terminal-manager] tmux not found on PATH — agent terminals will not survive Exo restarts.",
      );
    }
  }

  list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values())
      .map((record) => record.info)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  diagnostics() {
    return Array.from(this.sessions.values())
      .map((record) => ({
        id: record.info.id,
        kind: record.info.kind,
        status: record.info.status,
        cwd: record.info.cwd,
        title: record.info.title,
        bufferLength: record.buffer.length,
        transcriptPath: record.transcriptPath,
        tmuxSession: record.tmuxSession ?? null,
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
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      SHELL_SESSIONS_DISABLE: "1",
      ...launch.env,
    };

    const isAgent = options.kind === "claude" || options.kind === "codex";
    const useTmux = isAgent && this.tmuxAvailable;

    let spawnCommand = launch.command;
    let spawnArgs = launch.args;
    let tmuxSession: string | undefined;

    if (useTmux) {
      tmuxSession = `${TMUX_PREFIX}-${options.kind}-${randomBytes(4).toString("hex")}`;
      spawnCommand = "tmux";
      spawnArgs = [
        "new-session",
        "-A",
        "-s",
        tmuxSession,
        "-c",
        launch.cwd,
        launch.command,
        ...launch.args,
      ];
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
      status: "running",
    };

    this.sessions.set(id, {
      info,
      process: processHandle,
      buffer: "",
      transcriptPath,
      tmuxSession,
    });

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
      });
    }

    this.emit("created", info);
    return info;
  }

  async write(id: string, data: string): Promise<void> {
    const record = this.sessions.get(id);
    record?.process.write(data);
  }

  readBuffer(id: string): string | null {
    return this.sessions.get(id)?.buffer ?? null;
  }

  readTranscript(id: string, tailChars = 200_000): string | null {
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
    const initialBuffer = captureTmuxPane(entry.tmuxSession).slice(-TerminalManager.maxBufferLength);
    const info: TerminalSessionInfo = {
      id,
      title: entry.title,
      cwd: entry.cwd,
      kind: entry.kind,
      command: entry.command,
      status: "running",
    };

    this.sessions.set(id, {
      info,
      process: processHandle,
      buffer: initialBuffer,
      transcriptPath,
      tmuxSession: entry.tmuxSession,
    });

    if (!existsSync(transcriptPath)) {
      this.appendTranscript(id, this.transcriptHeader(info, entry.tmuxSession));
      if (initialBuffer.length > 0) {
        this.appendTranscript(id, initialBuffer.endsWith("\n") ? initialBuffer : `${initialBuffer}\n`);
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
        record.buffer = `${record.buffer}${sanitizedData}`.slice(-TerminalManager.maxBufferLength);
        this.appendTranscript(id, sanitizedData);
      }
      this.emit("data", { id, data: sanitizedData });
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record) {
        return;
      }

      record.info.status = "exited";
      record.info.exitCode = exitCode;
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
}

function stripMouseTrackingModes(data: string): string {
  return data
    .replace(/\x1b\[\?(?:9|100[0-7]|1015)(?:;(?:9|100[0-7]|1015))*[hl]/g, "")
    .replace(/\x1b\[\?(?:47|1047|1048|1049)(?:;(?:47|1047|1048|1049))*[hl]/g, "");
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

function captureTmuxPane(name: string): string {
  try {
    return execFileSync("tmux", ["capture-pane", "-p", "-S", "-100000", "-t", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}
