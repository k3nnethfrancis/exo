import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

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

export interface TmuxControlModeProcessOptions {
  tmuxPath: string;
  sessionName: string;
  paneId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export class TmuxControlModeProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly events = new EventEmitter();
  private readonly pasteBufferName: string;
  private stdoutBuffer = "";
  private exited = false;

  constructor(private readonly options: TmuxControlModeProcessOptions) {
    this.pasteBufferName = `exo-${options.paneId.replace(/[^A-Za-z0-9_-]/g, "")}`;
    this.child = spawn(options.tmuxPath, ["-C", "attach-session", "-t", options.sessionName], {
      cwd: options.cwd,
      env: options.env,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    this.child.on("exit", (exitCode) => this.emitExit(exitCode ?? undefined));
    this.child.on("error", () => this.emitExit(undefined));
    this.resize(options.cols, options.rows);
  }

  onData(handler: (data: string) => void): void {
    this.events.on("data", handler);
  }

  onExit(handler: (event: { exitCode?: number }) => void): void {
    this.events.on("exit", handler);
  }

  write(data: string): void {
    const paste = unwrapBracketedPaste(data);
    if (paste !== null) {
      this.sendLiteral(paste);
      return;
    }

    for (const action of splitTmuxInput(data)) {
      if (action.kind === "key") {
        this.sendKeys([action.key]);
      } else if (action.value.length > 0) {
        this.sendLiteral(action.value);
      }
    }
  }

  resize(cols: number, rows: number): void {
    this.writeControlCommand(`refresh-client -C ${Math.max(1, Math.floor(cols))}x${Math.max(1, Math.floor(rows))}`);
  }

  kill(): void {
    this.child.kill();
  }

  private sendKeys(args: string[]): void {
    execFileSync(this.options.tmuxPath, ["send-keys", "-t", this.options.paneId, ...args], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  private sendLiteral(value: string): void {
    if (value.length === 0) {
      return;
    }

    if (/[\s]/.test(value)) {
      this.pasteLiteral(value);
      return;
    }

    this.sendKeys(["-l", value]);
  }

  private pasteLiteral(value: string): void {
    execFileSync(this.options.tmuxPath, ["load-buffer", "-b", this.pasteBufferName, "-"], {
      cwd: this.options.cwd,
      env: this.options.env,
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    execFileSync(this.options.tmuxPath, ["paste-buffer", "-b", this.pasteBufferName, "-t", this.options.paneId, "-d"], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  private writeControlCommand(command: string): void {
    if (!this.child.killed && this.child.stdin.writable) {
      this.child.stdin.write(`${command}\n`);
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.handleControlLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleControlLine(line: string): void {
    const output = parseControlOutput(line);
    if (output && output.paneId === this.options.paneId) {
      this.events.emit("data", output.data);
      return;
    }
    if (line.startsWith("%exit")) {
      this.emitExit();
    }
  }

  private emitExit(exitCode?: number): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.events.emit("exit", { exitCode });
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

export function decodeTmuxControlValue(value: string): string {
  return value.replace(/\\([0-7]{3}|\\)/g, (_match, escape: string) => {
    if (escape === "\\") {
      return "\\";
    }
    return String.fromCharCode(Number.parseInt(escape, 8));
  });
}

function parseControlOutput(line: string): { paneId: string; data: string } | null {
  const output = /^%output\s+(\S+)\s+([\s\S]*)$/.exec(line);
  if (output) {
    return { paneId: output[1], data: decodeTmuxControlValue(output[2]) };
  }

  const extended = /^%extended-output\s+(\S+)\s+[\s\S]*\s:\s([\s\S]*)$/.exec(line);
  return extended ? { paneId: extended[1], data: decodeTmuxControlValue(extended[2]) } : null;
}

type TmuxInputAction = { kind: "literal"; value: string } | { kind: "key"; key: string };

const TMUX_KEY_SEQUENCES: Array<[string, string]> = [
  ["\u001b[A", "Up"],
  ["\u001b[B", "Down"],
  ["\u001b[C", "Right"],
  ["\u001b[D", "Left"],
  ["\u001b[1;2A", "S-Up"],
  ["\u001b[1;2B", "S-Down"],
  ["\u001b[1;2C", "S-Right"],
  ["\u001b[1;2D", "S-Left"],
  ["\u001b[1;5A", "C-Up"],
  ["\u001b[1;5B", "C-Down"],
  ["\u001b[1;5C", "C-Right"],
  ["\u001b[1;5D", "C-Left"],
  ["\u001b[3~", "Delete"],
  ["\u001b[H", "Home"],
  ["\u001bOH", "Home"],
  ["\u001b[F", "End"],
  ["\u001bOF", "End"],
];

function unwrapBracketedPaste(data: string): string | null {
  const match = /^\u001b\[200~([\s\S]*)\u001b\[201~$/.exec(data);
  return match ? match[1] : null;
}

function splitTmuxInput(data: string): TmuxInputAction[] {
  const chunks: TmuxInputAction[] = [];
  let literal = "";

  const pushLiteral = () => {
    if (literal.length > 0) {
      chunks.push({ kind: "literal", value: literal });
      literal = "";
    }
  };

  for (let index = 0; index < data.length;) {
    const sequence = TMUX_KEY_SEQUENCES.find(([candidate]) => data.startsWith(candidate, index));
    if (sequence) {
      pushLiteral();
      chunks.push({ kind: "key", key: sequence[1] });
      index += sequence[0].length;
      continue;
    }

    const char = data[index];
    if (char === "\r" || char === "\n") {
      pushLiteral();
      chunks.push({ kind: "key", key: "Enter" });
    } else if (char === "\u0003") {
      pushLiteral();
      chunks.push({ kind: "key", key: "C-c" });
    } else if (char === "\u001b") {
      pushLiteral();
      chunks.push({ kind: "key", key: "Escape" });
    } else if (char === "\u007f") {
      if (literal.length > 0) {
        pushLiteral();
      }
      chunks.push({ kind: "key", key: "BSpace" });
    } else {
      literal += char;
    }
    index += 1;
  }
  pushLiteral();
  return chunks;
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
