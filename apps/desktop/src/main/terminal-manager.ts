import { EventEmitter } from "node:events";

import pty, { type IPty } from "node-pty";
import { resolveAgentLaunchPlan, resolveRuntimeConfig, syncRuntimeContextFiles } from "@exo/core";

import type { TerminalCreateOptions, TerminalSessionInfo, TerminalKind } from "../shared/api";

interface TerminalRecord {
  info: TerminalSessionInfo;
  process: IPty;
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalRecord>();
  private nextId = 1;
  private readonly runtimeConfig = resolveRuntimeConfig();

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

  getRuntimeConfig() {
    return this.runtimeConfig;
  }

  async syncRuntimeContext() {
    return syncRuntimeContextFiles(this.runtimeConfig);
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

    const processHandle = pty.spawn(launch.command, launch.args, {
      cols: 120,
      rows: 32,
      cwd: launch.cwd,
      env,
      name: "xterm-256color",
    });

    const id = `term-${this.nextId++}`;
    const info: TerminalSessionInfo = {
      id,
      title: launch.title,
      cwd: launch.cwd,
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
