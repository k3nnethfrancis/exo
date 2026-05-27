export function trimRendererTerminalBuffer(buffer: string, lineLimit: number): string {
  if (!Number.isFinite(lineLimit) || lineLimit <= 0) {
    return buffer;
  }

  const trimStart = trimStartForLastLines(buffer, lineLimit);
  return trimStart === 0 ? buffer : buffer.slice(trimStart);
}

export function appendRendererTerminalBuffer(buffer: string, chunk: string, lineLimit: number): string {
  if (chunk.length === 0) {
    return buffer;
  }

  const next = `${buffer}${chunk}`;
  if (!Number.isFinite(lineLimit) || lineLimit <= 0 || !chunk.includes("\n")) {
    return next;
  }

  const trimStart = trimStartForLastLines(next, lineLimit);
  return trimStart === 0 ? next : next.slice(trimStart);
}

function trimStartForLastLines(buffer: string, lineLimit: number): number {
  let linesSeen = 1;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (buffer[index] !== "\n") {
      continue;
    }
    linesSeen += 1;
    if (linesSeen > lineLimit) {
      return index + 1;
    }
  }
  return 0;
}
