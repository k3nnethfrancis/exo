export const TERMINAL_WRITE_CHUNK_SIZE = 16_384;

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
