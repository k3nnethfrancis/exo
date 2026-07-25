/**
 * Bounded in-memory terminal output for renderer reload and explicit operator
 * reads. It is neither a durable transcript nor a second terminal screen:
 * xterm owns the mounted terminal and its scrollback.
 */
export class TerminalTailCache {
  private output = "";

  constructor(private charLimit: number) {}

  append(data: string): void {
    this.output = appendBoundedChars(this.output, data, this.charLimit);
  }

  text(): string {
    return this.output;
  }

  charCount(): number {
    return this.output.length;
  }

  lineCount(): number {
    return terminalOutputLineCount(this.output);
  }
}

export function tailLines(output: string, lineLimit?: number): string {
  const normalizedLimit = normalizeTailLineLimit(lineLimit);
  if (!normalizedLimit) {
    return output;
  }
  const hasTrailingNewline = output.endsWith("\n");
  const lines = output.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  if (lines.length <= normalizedLimit) {
    return output;
  }
  const tail = lines.slice(-normalizedLimit).join("\n");
  return hasTrailingNewline ? `${tail}\n` : tail;
}

export function normalizeTailLineLimit(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function appendBoundedChars(current: string, data: string, charLimit: number): string {
  const next = `${current}${data}`;
  return next.length <= charLimit ? next : next.slice(-charLimit);
}

function terminalOutputLineCount(output: string): number {
  return output.length === 0 ? 0 : output.split("\n").length;
}
