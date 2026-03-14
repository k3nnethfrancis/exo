import path from "node:path";
import { EventEmitter } from "node:events";

import pty, { type IPty } from "node-pty";

import type { TerminalCreateOptions, TerminalSessionInfo, TerminalKind } from "../shared/api";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
}

function splitEnvArgs(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function defaultShellCommand(): { command: string; args: string[] } {
  const command = process.env.EXO_SHELL ?? process.env.SHELL ?? "/bin/zsh";
  const args = splitEnvArgs(process.env.EXO_SHELL_ARGS);
  if (args.length > 0) {
    return { command, args };
  }

  return { command, args: path.basename(command).includes("zsh") ? ["-l"] : [] };
}

function toolCommand(kind: Exclude<TerminalKind, "shell">): { command: string; args: string[] } {
  if (kind === "claude") {
    return {
      command: process.env.EXO_CLAUDE_COMMAND ?? "claude",
      args: splitEnvArgs(process.env.EXO_CLAUDE_ARGS),
    };
  }

  return {
    command: process.env.EXO_CODEX_COMMAND ?? "codex",
    args: splitEnvArgs(process.env.EXO_CODEX_ARGS),
  };
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private nextId = 1;

  constructor(private readonly defaultCwd: string) {
    super();
  }

  list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values())
      .map((record) => record.info)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async ensureDefault(): Promise<TerminalSessionInfo> {
    const existing = this.list().find((session) => session.kind === "shell");
    if (existing) {
      return existing;
    }

    return this.create({ kind: "shell" });
  }

  async create(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
    const cwd = options.cwd ?? this.defaultCwd;
    const title = options.kind === "shell" ? "Terminal" : capitalize(options.kind);
    const launch = options.kind === "shell" ? defaultShellCommand() : toolCommand(options.kind);
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      SHELL_SESSIONS_DISABLE: "1",
      EXO_WORKSPACE_ROOT: this.defaultCwd,
    };

    const processHandle = pty.spawn(launch.command, launch.args, {
      cols: 120,
      rows: 32,
      cwd,
      env,
      name: "xterm-256color",
    });

    const id = `term-${this.nextId++}`;
    const info: TerminalSessionInfo = {
      id,
      title,
      cwd,
      kind: options.kind,
      command: launch.command,
      status: "running",
    };

    processHandle.onData((data) => {
      this.emit("data", { id, data });
    });

    processHandle.onExit(({ exitCode }) => {
      const record = this.sessions.get(id);
      if (!record) {
        return;
      }

      record.info.status = "exited";
      record.info.exitCode = exitCode;
      this.emit("exit", { id, exitCode });
    });

    this.sessions.set(id, {
      info,
      process: processHandle,
    });

    return info;
  }

  async write(id: string, data: string): Promise<void> {
    const record = this.sessions.get(id);
    record?.process.write(data);
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

    record.process.kill();
    this.sessions.delete(id);
  }
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
