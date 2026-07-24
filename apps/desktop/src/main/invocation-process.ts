import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { InvocationProcessOwnership } from "@exo/core";

import { commandEnvironment } from "./command-environment";

export interface InvocationProcess {
  readonly ownership: InvocationProcessOwnership;
  release(): Promise<void>;
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
    if (process.platform === "win32") {
      throw new Error("Durable headless invocation ownership is unavailable on Windows.");
    }
    const ownerToken = randomUUID();
    const child = spawn("/bin/sh", [
      "-c",
      'IFS= read -r _ <&3 || exit 125; /bin/sh -lc "$1" <&0 & child=$!; wait "$child"; exit $?',
      "exo-invocation-gate",
      input.command,
      ownerToken,
    ], {
      cwd: input.cwd,
      env: commandEnvironment({ ...input.env, [INVOCATION_OWNER_ENV]: ownerToken }),
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      // A dedicated process group lets Stop terminate the shell and every
      // descendant it launched, rather than only the immediate shell.
      detached: true,
    });
    if (!child.pid) {
      child.kill("SIGKILL");
      throw new Error("Invocation process did not expose a durable process id.");
    }
    return new DirectInvocationProcess(child, {
      version: 1,
      kind: "posix-process-group",
      pid: child.pid,
      processGroupId: child.pid,
      ownerToken,
      launchedAt: new Date().toISOString(),
    }, this.options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
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
  private released = false;

  constructor(
    private readonly child: ChildProcess,
    readonly ownership: InvocationProcessOwnership,
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

  async release(): Promise<void> {
    if (this.released) return;
    const gate = this.child.stdio[3];
    if (!gate || typeof gate === "number" || !("end" in gate)) {
      throw new Error("Invocation process did not expose its launch gate.");
    }
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      gate.once("error", fail);
      gate.end("go\n", () => {
        gate.off("error", fail);
        resolve();
      });
    });
    this.released = true;
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
const INVOCATION_OWNER_ENV = "EXO_INVOCATION_OWNER_TOKEN";
const execFileAsync = promisify(execFile);

/**
 * Terminates a process group left by a crashed Electron main process. Signals
 * are sent only after the durable random token is observed on the group leader,
 * preventing a reused pid from being killed.
 */
export async function terminateOwnedInvocationProcessGroup(
  ownership: InvocationProcessOwnership,
  graceMs = DEFAULT_STOP_GRACE_MS,
): Promise<void> {
  if (!processGroupIdExists(ownership.processGroupId)) return;
  if (!processIdExists(ownership.pid)) {
    throw new Error("Invocation process group still exists but its recorded leader is gone; ownership cannot be verified safely.");
  }
  const identity = await readProcessIdentity(ownership.pid);
  if (!identity.includes(ownership.ownerToken)) {
    throw new Error("Invocation process identity no longer matches its durable ownership token; refusing to signal a possibly reused pid.");
  }
  signalProcessGroupId(ownership.processGroupId, "SIGTERM");
  if (await processGroupIdExitsWithin(ownership.processGroupId, graceMs)) return;
  signalProcessGroupId(ownership.processGroupId, "SIGKILL");
  if (!await processGroupIdExitsWithin(ownership.processGroupId, graceMs)) {
    throw new Error("Recovered invocation process group remained alive after forced termination.");
  }
}

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
    // macOS may transiently report EPERM while a just-signalled group is
    // being reaped. That is not proof of death, so keep waiting.
    if (isNodeErrorCode(error, "EPERM")) return true;
    throw error;
  }
}

function processIdExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

function processGroupIdExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    if (isNodeErrorCode(error, "EPERM")) return true;
    throw error;
  }
}

function signalProcessGroupId(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

async function processGroupIdExitsWithin(processGroupId: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, graceMs);
  do {
    if (!processGroupIdExists(processGroupId)) return true;
    await delay(Math.min(10, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  return !processGroupIdExists(processGroupId);
}

async function readProcessIdentity(pid: number): Promise<string> {
  if (process.platform === "linux") {
    return (await readFile(`/proc/${pid}/cmdline`)).toString("utf8").replaceAll("\0", " ");
  }
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(pid), "-ww", "-o", "command="]);
    return stdout;
  }
  throw new Error(`Durable invocation process recovery is unsupported on ${process.platform}.`);
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
