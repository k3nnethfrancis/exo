import { spawn, type ChildProcess } from "node:child_process";

import { commandEnvironment } from "./command-environment";

export interface InvocationProcess {
  send(prompt: string): Promise<void>;
  onExit(handler: (event: { exitCode: number | null }) => void): void;
  kill(): void;
}

export interface InvocationProcessFactory {
  launch(input: { command: string; cwd: string; env: NodeJS.ProcessEnv }): InvocationProcess;
}

/**
 * Runs an invocation without allocating an xterm/PTY session. Commands receive
 * precisely one complete prompt through standard input, then EOF. Interactive
 * commands must therefore be configured with their own non-interactive flag.
 */
export class DirectInvocationProcessFactory implements InvocationProcessFactory {
  launch(input: { command: string; cwd: string; env: NodeJS.ProcessEnv }): InvocationProcess {
    const child = spawn("/bin/sh", ["-lc", input.command], {
      cwd: input.cwd,
      env: commandEnvironment(input.env),
      stdio: ["pipe", "ignore", "ignore"],
    });
    return new DirectInvocationProcess(child);
  }
}

class DirectInvocationProcess implements InvocationProcess {
  constructor(private readonly child: ChildProcess) {}

  async send(prompt: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const stdin = this.child.stdin;
      if (!stdin) {
        reject(new Error("Invocation process did not expose standard input."));
        return;
      }
      const fail = (error: Error) => reject(error);
      stdin.once("error", fail);
      stdin.end(prompt, () => {
        stdin.off("error", fail);
        resolve();
      });
    });
  }

  onExit(handler: (event: { exitCode: number | null }) => void): void {
    this.child.once("exit", (exitCode) => handler({ exitCode }));
  }

  kill(): void {
    this.child.kill();
  }
}
