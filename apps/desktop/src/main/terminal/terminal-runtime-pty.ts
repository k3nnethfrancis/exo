import os from "node:os";

import { spawn, type IPty } from "node-pty";

import type { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from "./terminal-runtime";

export class DirectPtyProcessFactory implements TerminalProcessFactory {
  create(options: TerminalProcessOptions): TerminalProcess {
    const ptyProcess = spawn(options.command, options.args, {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: processEnvForPty(options.env),
    });
    return new DirectPtyProcess(ptyProcess);
  }
}

class DirectPtyProcess implements TerminalProcess {
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
