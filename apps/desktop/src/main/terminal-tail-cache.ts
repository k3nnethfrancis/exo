/**
 * Bounded terminal text cache for main-process API reads.
 *
 * This is deliberately not a live screen model. tmux owns durable history,
 * xterm owns mounted rendering, and transcripts own full append-only history.
 * The cache only supports readiness heuristics and bounded CLI/MCP/UI tail
 * reads when tmux capture is temporarily unavailable.
 */
export class TerminalTailCache {
  private output = "";

  constructor(private lineLimit: number | null) {}

  append(data: string): void {
    this.output = appendBoundedLines(this.output, data, this.lineLimit);
  }

  replace(data: string): void {
    this.output = appendBoundedLines("", data, this.lineLimit);
  }

  resize(lineLimit: number | null): void {
    this.lineLimit = lineLimit;
    this.output = appendBoundedLines("", this.output, this.lineLimit);
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

function appendBoundedLines(current: string, data: string, lineLimit: number | null): string {
  const next = `${current}${data}`;
  if (lineLimit === null) {
    return next;
  }
  const lines = next.split("\n");
  return lines.length <= lineLimit ? next : lines.slice(-lineLimit).join("\n");
}

function terminalOutputLineCount(output: string): number {
  return output.length === 0 ? 0 : output.split("\n").length;
}
