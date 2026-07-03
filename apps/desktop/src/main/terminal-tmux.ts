import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

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

// Discovery candidates are install-location fallbacks, not runtime fallbacks. If
// none work, terminal creation fails clearly instead of switching to another
// transport and hiding the missing tmux dependency.
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
      return execFileSync(this.tmuxPath, tmuxUtf8Args(args), {
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
  private readonly outputDecoder = new TmuxControlOutputDecoder();
  private stdoutBuffer = "";
  private exited = false;

  constructor(private readonly options: TmuxControlModeProcessOptions) {
    this.pasteBufferName = `exo-${options.paneId.replace(/[^A-Za-z0-9_-]/g, "")}`;
    this.child = spawn(options.tmuxPath, tmuxUtf8Args(["-C", "attach-session", "-t", options.sessionName]), {
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
    if (this.exited) {
      return;
    }

    try {
      const paste = unwrapBracketedPaste(data);
      if (paste !== null) {
        this.pasteLiteral(paste);
        return;
      }

      for (const action of splitTmuxInput(data)) {
        if (action.kind === "key") {
          this.sendKeys([action.key]);
        } else if (action.kind === "paste") {
          this.pasteLiteral(action.value);
        } else if (action.value.length > 0) {
          this.sendLiteral(action.value);
        }
      }
    } catch {
      this.detachAfterWriteFailure();
    }
  }

  resize(cols: number, rows: number): void {
    const width = tmuxCellCount(cols);
    const height = tmuxCellCount(rows);
    this.writeControlCommand(`resize-window -t ${this.options.sessionName} -x ${width} -y ${height}`);
    this.writeControlCommand(`refresh-client -C ${width}x${height}`);
  }

  kill(): void {
    this.child.kill();
  }

  private sendKeys(args: string[]): void {
    execFileSync(this.options.tmuxPath, tmuxUtf8Args(["send-keys", "-t", this.options.paneId, ...args]), {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  private sendLiteral(value: string): void {
    if (value.length === 0) {
      return;
    }

    // Ordinary interactive typing must stay on tmux's key path. Routing every
    // space through paste-buffer makes basic shell editing depend on paste mode
    // and can break expected terminal behavior. Real multiline/semantic pastes
    // still arrive through the bracketed-paste branch above.
    this.sendKeys(["-l", value]);
  }

  private pasteLiteral(value: string): void {
    execFileSync(this.options.tmuxPath, tmuxUtf8Args(["load-buffer", "-b", this.pasteBufferName, "-"]), {
      cwd: this.options.cwd,
      env: this.options.env,
      input: value,
      stdio: ["pipe", "ignore", "pipe"],
    });
    execFileSync(this.options.tmuxPath, tmuxUtf8Args(["paste-buffer", "-b", this.pasteBufferName, "-t", this.options.paneId, "-d"]), {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  private writeControlCommand(command: string): void {
    if (!this.exited && !this.child.killed && this.child.stdin.writable) {
      this.child.stdin.write(`${command}\n`);
    }
  }

  private detachAfterWriteFailure(): void {
    this.emitExit();
    if (!this.child.killed) {
      this.child.kill();
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
    const output = parseControlOutput(line, this.outputDecoder);
    if (output && output.paneId === this.options.paneId) {
      if (output.data.length > 0) {
        this.events.emit("data", output.data);
      }
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
  const decoder = new StringDecoder("utf8");
  return decoder.write(tmuxControlValueBytes(value)) + decoder.end();
}

class TmuxControlOutputDecoder {
  private readonly decoders = new Map<string, StringDecoder>();

  decode(paneId: string, value: string): string {
    let decoder = this.decoders.get(paneId);
    if (!decoder) {
      decoder = new StringDecoder("utf8");
      this.decoders.set(paneId, decoder);
    }
    return decoder.write(tmuxControlValueBytes(value));
  }
}

function tmuxControlValueBytes(value: string): Buffer {
  const bytes: number[] = [];
  for (let index = 0; index < value.length;) {
    if (value[index] !== "\\") {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) {
        index += 1;
        continue;
      }
      bytes.push(...Buffer.from(String.fromCodePoint(codePoint), "utf8"));
      index += codePoint > 0xffff ? 2 : 1;
      continue;
    }

    if (value[index + 1] === "\\") {
      bytes.push("\\".charCodeAt(0));
      index += 2;
      continue;
    }

    const octal = /^[0-7]{3}/.exec(value.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 4;
      continue;
    }

    bytes.push("\\".charCodeAt(0));
    index += 1;
  }

  return Buffer.from(bytes);
}

function parseControlOutput(line: string, decoder = new TmuxControlOutputDecoder()): { paneId: string; data: string } | null {
  const output = /^%output\s+(\S+)\s+([\s\S]*)$/.exec(line);
  if (output) {
    return { paneId: output[1], data: decoder.decode(output[1], output[2]) };
  }

  const extended = /^%extended-output\s+(\S+)\s+[\s\S]*\s:\s([\s\S]*)$/.exec(line);
  return extended ? { paneId: extended[1], data: decoder.decode(extended[1], extended[2]) } : null;
}

function tmuxUtf8Args(args: string[]): string[] {
  return ["-u", ...args];
}

type TmuxInputAction = { kind: "literal"; value: string } | { kind: "key"; key: string } | { kind: "paste"; value: string };

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
    if (data.startsWith("\u001b[200~", index)) {
      const pasteStart = index + "\u001b[200~".length;
      const pasteEnd = data.indexOf("\u001b[201~", pasteStart);
      if (pasteEnd >= 0) {
        pushLiteral();
        chunks.push({ kind: "paste", value: data.slice(pasteStart, pasteEnd) });
        index = pasteEnd + "\u001b[201~".length;
        continue;
      }
    }

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
      const escapeSequenceEnd = unknownEscapeSequenceEnd(data, index);
      if (escapeSequenceEnd > index + 1) {
        literal += data.slice(index, escapeSequenceEnd);
        index = escapeSequenceEnd;
        continue;
      }
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

function unknownEscapeSequenceEnd(data: string, start: number): number {
  const next = data[start + 1];
  if (next === undefined) {
    return start + 1;
  }

  if (next === "[") {
    for (let index = start + 2; index < data.length; index += 1) {
      const code = data.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        return index + 1;
      }
    }
    return data.length;
  }

  if (next === "]") {
    for (let index = start + 2; index < data.length; index += 1) {
      if (data[index] === "\u0007") {
        return index + 1;
      }
      if (data[index] === "\u001b" && data[index + 1] === "\\") {
        return index + 2;
      }
    }
    return data.length;
  }

  const codePoint = data.codePointAt(start + 1);
  if (codePoint === undefined) {
    return start + 1;
  }
  return start + 1 + (codePoint > 0xffff ? 2 : 1);
}

function sanitizeTmuxName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
}

function tmuxCellCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
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
