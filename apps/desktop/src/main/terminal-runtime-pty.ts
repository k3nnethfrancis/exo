import os from "node:os";

import { spawn, type IPty } from "node-pty";

import type {
  TerminalRuntime,
  TerminalRuntimeAttachOptions,
  TerminalRuntimeAvailability,
  TerminalRuntimeCaptureRestoreSnapshotOptions,
  TerminalRuntimeCaptureTailOptions,
  TerminalRuntimeCreateSessionOptions,
  TerminalRuntimePaneInfo,
  TerminalRuntimeProcess,
  TerminalRuntimeRestoreSnapshot,
  TerminalRuntimeSession,
  TerminalRuntimeSessionOptions,
} from "./terminal-runtime";

interface DirectPtyRecord {
  sessionName: string;
  paneId: string;
  process: DirectPtyProcess;
  command: string;
  cwd: string;
  dead: boolean;
}

export class DirectPtyTerminalRuntime implements TerminalRuntime {
  readonly kind = "pty" as const;
  private readonly sessions = new Map<string, DirectPtyRecord>();

  availability(): TerminalRuntimeAvailability {
    return { available: true };
  }

  createSession(options: TerminalRuntimeCreateSessionOptions): TerminalRuntimeSession {
    const sessionName = `pty-${options.sessionToken}`;
    const paneId = sessionName;
    const ptyProcess = spawn(options.command, options.args, {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: processEnvForPty(options.env),
    });
    const processHandle = new DirectPtyProcess(ptyProcess);
    const record: DirectPtyRecord = {
      sessionName,
      paneId,
      process: processHandle,
      command: options.command,
      cwd: options.cwd,
      dead: false,
    };
    processHandle.onExit(() => {
      record.dead = true;
    });
    this.sessions.set(sessionName, record);
    return {
      sessionName,
      paneId,
      process: processHandle,
    };
  }

  attachSession(_options: TerminalRuntimeAttachOptions): TerminalRuntimeProcess {
    throw new Error("Direct pty terminals cannot be resumed after the Exo process exits.");
  }

  listPanes(): TerminalRuntimePaneInfo[] {
    return [...this.sessions.values()].map((record) => ({
      sessionName: record.sessionName,
      paneId: record.paneId,
      dead: record.dead,
      currentCommand: record.command,
      currentPath: record.cwd,
    }));
  }

  applySessionOptions(_options: TerminalRuntimeSessionOptions): void {
    // Direct pty has no backend history owner. xterm owns live scrollback.
  }

  captureTailForDisplay(_options: TerminalRuntimeCaptureTailOptions): string {
    return "";
  }

  captureRestoreSnapshot(_options: TerminalRuntimeCaptureRestoreSnapshotOptions): TerminalRuntimeRestoreSnapshot {
    return {
      content: "",
      cols: 0,
      rows: 0,
      altScreen: false,
    };
  }

  terminate(sessionName: string): void {
    const record = this.sessions.get(sessionName);
    record?.process.kill();
    this.sessions.delete(sessionName);
  }
}

class DirectPtyProcess implements TerminalRuntimeProcess {
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(event: { exitCode?: number }) => void>();

  constructor(private readonly ptyProcess: IPty) {
    this.ptyProcess.onData((data) => {
      for (const handler of this.dataHandlers) {
        handler(data);
      }
    });
    this.ptyProcess.onExit((event) => {
      for (const handler of this.exitHandlers) {
        handler({ exitCode: event.exitCode });
      }
    });
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.add(handler);
  }

  onExit(handler: (event: { exitCode?: number }) => void): void {
    this.exitHandlers.add(handler);
  }

  write(data: string): void {
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
  }

  kill(): void {
    this.ptyProcess.kill();
  }
}

function processEnvForPty(env: NodeJS.ProcessEnv): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }
  next.TERM = next.TERM || "xterm-256color";
  next.SHELL = next.SHELL || process.env.SHELL || os.userInfo().shell || "/bin/sh";
  return next;
}
