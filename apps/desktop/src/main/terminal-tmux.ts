import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

export interface TmuxAvailable {
  available: true;
  path: string;
  version: string;
}

export interface TmuxUnavailable {
  available: false;
  attempted: string[];
  reason: string;
}

export type TmuxAvailability = TmuxAvailable | TmuxUnavailable;

export interface TmuxPaneInfo {
  sessionName: string;
  windowId: string;
  paneId: string;
  dead: boolean;
  currentCommand: string;
  currentPath: string;
}

export class TmuxCommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = "TmuxCommandError";
  }
}

const DEFAULT_TMUX_CANDIDATES = ["tmux", "/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"];

export function detectTmux(env: NodeJS.ProcessEnv = process.env): TmuxAvailability {
  const candidates = unique([env.EXO_TMUX_PATH, ...DEFAULT_TMUX_CANDIDATES].filter((candidate): candidate is string => Boolean(candidate)));
  const attempted: string[] = [];

  for (const candidate of candidates) {
    attempted.push(candidate);
    const result = spawnSync(candidate, ["-V"], { encoding: "utf8" });
    if (result.status === 0) {
      return {
        available: true,
        path: candidate,
        version: (result.stdout || result.stderr).trim(),
      };
    }
  }

  return {
    available: false,
    attempted,
    reason: "tmux was not found. Install tmux, or set EXO_TMUX_PATH to the tmux binary.",
  };
}

export function exoTmuxSessionName(exoTerminalId: string, workspaceRoot: string): string {
  const workspaceHash = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 10);
  return sanitizeTmuxName(`exo-${workspaceHash}-${exoTerminalId}`);
}

export function parseTmuxPaneList(raw: string): TmuxPaneInfo[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sessionName = "", windowId = "", paneId = "", paneDead = "0", currentCommand = "", currentPath = ""] = line.split("\t");
      return {
        sessionName,
        windowId,
        paneId,
        dead: paneDead === "1",
        currentCommand,
        currentPath,
      };
    });
}

export class TmuxCommandRunner {
  constructor(readonly tmuxPath: string) {}

  run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
    try {
      return execFileSync(this.tmuxPath, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const stderr = commandStderr(error);
      throw new TmuxCommandError(`tmux command failed: ${this.tmuxPath} ${args.join(" ")}`, this.tmuxPath, args, stderr);
    }
  }
}

export function tmuxEnvironmentArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

export function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeTmuxName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function commandStderr(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (Buffer.isBuffer(stderr)) {
      return stderr.toString("utf8");
    }
    if (typeof stderr === "string") {
      return stderr;
    }
  }
  return "";
}
