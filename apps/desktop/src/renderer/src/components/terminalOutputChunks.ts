export const TERMINAL_WRITE_CHUNK_SIZE = 16_384;

export class TerminalOutputChunker {
  private pendingHighSurrogate = "";

  chunks(data: string, chunkSize = TERMINAL_WRITE_CHUNK_SIZE): string[] {
    if (chunkSize <= 0) {
      throw new Error("Terminal chunk size must be positive.");
    }

    let output = data;
    if (this.pendingHighSurrogate.length > 0) {
      output = this.pendingHighSurrogate + output;
      this.pendingHighSurrogate = "";
    }

    if (output.length > 0 && isHighSurrogate(output.charCodeAt(output.length - 1))) {
      this.pendingHighSurrogate = output.charAt(output.length - 1);
      output = output.slice(0, -1);
    }

    if (output.length === 0) {
      return [];
    }

    return chunkTerminalData(output, chunkSize);
  }

  reset() {
    this.pendingHighSurrogate = "";
  }
}

export function chunkTerminalData(data: string, chunkSize = TERMINAL_WRITE_CHUNK_SIZE): string[] {
  if (chunkSize <= 0) {
    throw new Error("Terminal chunk size must be positive.");
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(offset + chunkSize, data.length);
    if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1)) && isLowSurrogate(data.charCodeAt(end))) {
      end -= 1;
    }
    if (end < data.length) {
      const incompleteEscapeStart = incompleteTerminalEscapeStart(data, offset, end);
      if (incompleteEscapeStart !== -1) {
        if (incompleteEscapeStart === offset) {
          end = terminalEscapeEnd(data, offset);
        } else {
          end = incompleteEscapeStart;
        }
      }
    }
    if (end === offset) {
      end = Math.min(offset + chunkSize + 1, data.length);
    }
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function incompleteTerminalEscapeStart(data: string, offset: number, end: number): number {
  for (let index = offset; index < end; index += 1) {
    if (data.charCodeAt(index) !== 0x1b) {
      continue;
    }
    const sequenceEnd = terminalEscapeEnd(data, index);
    if (sequenceEnd > end) {
      return index;
    }
    index = sequenceEnd - 1;
  }
  return -1;
}

function terminalEscapeEnd(data: string, offset: number): number {
  if (offset + 1 >= data.length) {
    return data.length;
  }
  const introducer = data.charAt(offset + 1);
  if (introducer === "[") {
    for (let index = offset + 2; index < data.length; index += 1) {
      const code = data.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        return index + 1;
      }
    }
    return data.length;
  }
  if (introducer === "]") {
    for (let index = offset + 2; index < data.length; index += 1) {
      if (data.charCodeAt(index) === 0x07) {
        return index + 1;
      }
      if (data.charCodeAt(index) === 0x1b && data.charAt(index + 1) === "\\") {
        return index + 2;
      }
    }
    return data.length;
  }
  return Math.min(offset + 2, data.length);
}
