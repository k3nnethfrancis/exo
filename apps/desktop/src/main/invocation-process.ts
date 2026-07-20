import { spawn, type ChildProcess } from "node:child_process";

import { commandEnvironment } from "./command-environment";

export interface InvocationProcess {
  send(prompt: string): Promise<void>;
  onExit(handler: (event: InvocationProcessExit) => void): void;
  onOutput?(handler: (event: InvocationProcessOutput) => void): void;
  stop(): Promise<void>;
}

export interface InvocationProcessOutput {
  channel: "stdout" | "stderr";
  chunk: string;
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

export interface DirectInvocationProcessFactoryOptions {
  stopGraceMs?: number;
}

/**
 * Runs an invocation without allocating an xterm/PTY session. Commands receive
 * precisely one complete prompt through standard input, then EOF. Interactive
 * commands must therefore be configured with their own non-interactive flag.
 */
export class DirectInvocationProcessFactory implements InvocationProcessFactory {
  constructor(private readonly options: DirectInvocationProcessFactoryOptions = {}) {}

  launch(input: { command: string; cwd: string; env: NodeJS.ProcessEnv }): InvocationProcess {
    const child = spawn("/bin/sh", ["-lc", input.command], {
      cwd: input.cwd,
      env: commandEnvironment(input.env),
      stdio: ["pipe", "pipe", "pipe"],
      // A dedicated process group lets Stop terminate the shell and every
      // descendant it launched, rather than only the immediate shell.
      detached: process.platform !== "win32",
    });
    return new DirectInvocationProcess(child, this.options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
  }
}

class DirectInvocationProcess implements InvocationProcess {
  private stdout = "";
  private stderr = "";
  private spawnError: string | undefined;
  private exitEvent: InvocationProcessExit | null = null;
  private readonly exitHandlers = new Set<(event: InvocationProcessExit) => void>();
  private outputHandlers = new Set<(event: InvocationProcessOutput) => void>();
  private readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private stopPromise: Promise<void> | null = null;
  private finalizationError: Error | null = null;

  constructor(
    private readonly child: ChildProcess,
    private readonly stopGraceMs: number,
  ) {
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    // Output is retained only long enough to obtain structured provenance on
    // exit. It is deliberately not a chat/transcript surface.
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (this.exitEvent) return;
      const text = String(chunk);
      this.stdout = appendBounded(this.stdout, text);
      this.emitOutput({ channel: "stdout", chunk: text });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (this.exitEvent) return;
      const text = String(chunk);
      this.stderr = appendBounded(this.stderr, text);
      this.emitOutput({ channel: "stderr", chunk: text });
    });
    child.once("error", (error) => {
      this.spawnError = error.message;
    });
    // `close` fires only after stdio is drained; `exit` can race the final JSON
    // chunk and lose session/failure provenance.
    child.once("close", (exitCode) => {
      const event: InvocationProcessExit = {
        exitCode,
        stdout: this.stdout,
        stderr: this.stderr,
        ...(this.spawnError ? { spawnError: this.spawnError } : {}),
      };
      void this.finishAfterProcessGroupExit(event).catch((error) => {
        this.finalizationError = asError(error);
        console.error("[exo] invocation process-group finalization failed", this.finalizationError);
      });
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
    if (this.exitEvent) {
      queueMicrotask(() => handler(this.exitEvent!));
      return;
    }
    this.exitHandlers.add(handler);
  }

  onOutput(handler: (event: InvocationProcessOutput) => void): void {
    if (!this.exitEvent) this.outputHandlers.add(handler);
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.stopProcessGroup();
    return this.stopPromise;
  }

  private emitOutput(event: InvocationProcessOutput): void {
    for (const handler of this.outputHandlers) handler(event);
  }

  private async stopProcessGroup(): Promise<void> {
    if (this.exitEvent) return;
    if (this.finalizationError) throw this.finalizationError;
    signalProcessGroup(this.child, "SIGTERM");
    if (await closesWithin(this.closed, this.stopGraceMs)) return;
    if (this.finalizationError) throw this.finalizationError;
    signalProcessGroup(this.child, "SIGKILL");
    if (!await closesWithin(this.closed, this.stopGraceMs)) {
      if (this.finalizationError) throw this.finalizationError;
      throw new Error("Invocation process group did not exit after forced termination.");
    }
  }

  private async finishAfterProcessGroupExit(event: InvocationProcessExit): Promise<void> {
    await terminateResidualProcessGroup(this.child, this.stopGraceMs);
    this.exitEvent = event;
    this.resolveClosed();
    for (const handler of this.exitHandlers) handler(event);
    this.exitHandlers.clear();
    this.outputHandlers.clear();
  }
}

const MAX_INVOCATION_STDOUT_CHARS = 256_000;
const DEFAULT_STOP_GRACE_MS = 1_000;

function appendBounded(existing: string, next: string): string {
  const combined = existing + next;
  return combined.length > MAX_INVOCATION_STDOUT_CHARS ? combined.slice(-MAX_INVOCATION_STDOUT_CHARS) : combined;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

async function terminateResidualProcessGroup(child: ChildProcess, graceMs: number): Promise<void> {
  if (!processGroupExists(child)) return;
  signalProcessGroup(child, "SIGTERM");
  if (await processGroupExitsWithin(child, graceMs)) return;
  signalProcessGroup(child, "SIGKILL");
  if (!await processGroupExitsWithin(child, graceMs)) {
    throw new Error("Invocation descendants remained after forced process-group termination.");
  }
}

function processGroupExists(child: ChildProcess): boolean {
  if (process.platform === "win32" || !child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

async function processGroupExitsWithin(child: ChildProcess, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, graceMs);
  do {
    if (!processGroupExists(child)) return true;
    await delay(Math.min(10, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  return !processGroupExists(child);
}

async function closesWithin(closed: Promise<void>, graceMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, graceMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isMissingProcess(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
