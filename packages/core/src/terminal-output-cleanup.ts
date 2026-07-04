const DEC_SPECIAL_GRAPHICS: Record<string, string> = {
  "`": "◆",
  a: "▒",
  b: "␉",
  c: "␌",
  d: "␍",
  e: "␊",
  f: "°",
  g: "±",
  h: "␤",
  i: "␋",
  j: "┘",
  k: "┐",
  l: "┌",
  m: "└",
  n: "┼",
  o: "⎺",
  p: "⎻",
  q: "─",
  r: "⎼",
  s: "⎽",
  t: "├",
  u: "┤",
  v: "┴",
  w: "┬",
  x: "│",
  y: "≤",
  z: "≥",
  "{": "π",
  "|": "≠",
  "}": "£",
  "~": "·",
};

type Charset = "ascii" | "dec-special";

export function cleanTerminalOutput(input: string): string {
  const state = new TerminalTextState();
  input = stripLeadingPartialTerminalSequence(input);
  let charset: Charset = "ascii";
  let suppressCursorAddressedFragment = false;

  for (let index = 0; index < input.length;) {
    const char = input[index]!;

    if (char === "\u001b") {
      const escaped = readEscapeSequence(input, index);
      index = escaped.nextIndex;
      if (escaped.kind === "charset") {
        charset = escaped.charset;
      } else if (escaped.kind === "erase-line") {
        if (!suppressCursorAddressedFragment) {
          state.eraseLine(escaped.mode);
        }
      } else if (escaped.kind === "cursor-position") {
        suppressCursorAddressedFragment = true;
      }
      continue;
    }

    index += char.length;
    switch (char) {
      case "\r":
        suppressCursorAddressedFragment = false;
        state.carriageReturn();
        break;
      case "\n":
        suppressCursorAddressedFragment = false;
        state.lineFeed();
        break;
      case "\b":
        state.backspace();
        break;
      case "\t":
        state.tab();
        break;
      case "\u0000":
      case "\u0007":
      case "\u000b":
      case "\u000c":
        break;
      case "\ufffd":
        break;
      default:
        if (isControlCode(char)) {
          break;
        }
        if (suppressCursorAddressedFragment) {
          break;
        }
        state.write(charset === "dec-special" ? DEC_SPECIAL_GRAPHICS[char] ?? char : char);
        break;
    }
  }

  return state.text();
}

class TerminalTextState {
  private readonly lines: string[][] = [[]];
  private column = 0;

  write(value: string): void {
    const line = this.currentLine();
    for (const char of value) {
      line[this.column] = char;
      this.column += 1;
    }
  }

  carriageReturn(): void {
    this.column = 0;
  }

  lineFeed(): void {
    this.lines.push([]);
    this.column = 0;
  }

  backspace(): void {
    this.column = Math.max(0, this.column - 1);
  }

  tab(): void {
    const spaces = 8 - (this.column % 8);
    this.write(" ".repeat(spaces));
  }

  eraseLine(mode: number): void {
    const line = this.currentLine();
    if (mode === 1) {
      line.splice(0, this.column);
      this.column = 0;
      return;
    }
    if (mode === 2) {
      line.length = 0;
      this.column = 0;
      return;
    }
    line.length = Math.min(line.length, this.column);
  }

  text(): string {
    const text = this.lines.map((line) => line.join("").trimEnd()).join("\n");
    return text.trim().length === 0 ? "" : text;
  }

  private currentLine(): string[] {
    return this.lines[this.lines.length - 1]!;
  }
}

function readEscapeSequence(input: string, startIndex: number):
  | { kind: "charset"; charset: Charset; nextIndex: number }
  | { kind: "erase-line"; mode: number; nextIndex: number }
  | { kind: "cursor-position"; nextIndex: number }
  | { kind: "skip"; nextIndex: number } {
  const marker = input[startIndex + 1];
  if (marker === "]") {
    return { kind: "skip", nextIndex: readOscEnd(input, startIndex + 2) };
  }
  if (marker === "(") {
    const charset = input[startIndex + 2] === "0" ? "dec-special" : "ascii";
    return { kind: "charset", charset, nextIndex: Math.min(input.length, startIndex + 3) };
  }
  if (marker === "[") {
    return readCsiSequence(input, startIndex + 2);
  }
  return { kind: "skip", nextIndex: Math.min(input.length, startIndex + 2) };
}

function readOscEnd(input: string, index: number): number {
  for (; index < input.length; index += 1) {
    if (input[index] === "\u0007") {
      return index + 1;
    }
    if (input[index] === "\u001b" && input[index + 1] === "\\") {
      return index + 2;
    }
  }
  return input.length;
}

function readCsiSequence(input: string, index: number):
  | { kind: "erase-line"; mode: number; nextIndex: number }
  | { kind: "cursor-position"; nextIndex: number }
  | { kind: "skip"; nextIndex: number } {
  let params = "";
  for (; index < input.length; index += 1) {
    const char = input[index]!;
    const code = char.charCodeAt(0);
    if (code >= 0x30 && code <= 0x3f) {
      params += char;
      continue;
    }
    if (code >= 0x20 && code <= 0x2f) {
      continue;
    }
    const nextIndex = index + 1;
    if (char === "K") {
      return { kind: "erase-line", mode: parseEraseLineMode(params), nextIndex };
    }
    if (char === "H" || char === "f" || char === "G") {
      return { kind: "cursor-position", nextIndex };
    }
    return { kind: "skip", nextIndex };
  }
  return { kind: "skip", nextIndex: input.length };
}

function parseEraseLineMode(params: string): number {
  const [first] = params.split(";");
  const mode = Number.parseInt(first || "0", 10);
  return mode === 1 || mode === 2 ? mode : 0;
}

function isControlCode(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

function stripLeadingPartialTerminalSequence(input: string): string {
  let output = input;
  for (;;) {
    const partial = /^\[?[0-9?][0-9;?]{0,31}[ -/]{0,8}[@-~](?=\u001b|\r|\n|$)/.exec(output);
    if (!partial) {
      return output;
    }
    output = output.slice(partial[0].length);
  }
}
