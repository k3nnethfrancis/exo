import { spawn, type ChildProcess } from "node:child_process";

import { commandEnvironment } from "./command-environment";

export interface InvocationProcess {
  send(prompt: string): Promise<void>;
  onExit(handler: (event: InvocationProcessExit) => void): void;
  kill(): void;
}

export interface InvocationProcessExit {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
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
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new DirectInvocationProcess(child);
  }
}

class DirectInvocationProcess implements InvocationProcess {
  private stdout = "";
  private stderr = "";
  private spawnError: string | undefined;

  constructor(private readonly child: ChildProcess) {
    // Output is retained only long enough to obtain structured provenance on
    // exit. It is deliberately not a chat/transcript surface.
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.stdout = appendBounded(this.stdout, String(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderr = appendBounded(this.stderr, String(chunk));
    });
    child.once("error", (error) => {
      this.spawnError = error.message;
    });
  }

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

  onExit(handler: (event: InvocationProcessExit) => void): void {
    // `close` fires only after stdio is drained; `exit` can race the final JSON
    // chunk and lose session/failure provenance.
    this.child.once("close", (exitCode) => handler({
      exitCode,
      stdout: this.stdout,
      stderr: this.stderr,
      ...(this.spawnError ? { spawnError: this.spawnError } : {}),
    }));
  }

  kill(): void {
    this.child.kill();
  }
}

const MAX_INVOCATION_STDOUT_CHARS = 256_000;

function appendBounded(existing: string, next: string): string {
  const combined = existing + next;
  return combined.length > MAX_INVOCATION_STDOUT_CHARS ? combined.slice(-MAX_INVOCATION_STDOUT_CHARS) : combined;
}
