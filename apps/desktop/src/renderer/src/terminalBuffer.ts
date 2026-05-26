export function trimRendererTerminalBuffer(buffer: string, lineLimit: number): string {
  if (!Number.isFinite(lineLimit) || lineLimit <= 0) {
    return buffer;
  }

  const lines = buffer.split("\n");
  if (lines.length <= lineLimit) {
    return buffer;
  }

  return lines.slice(-lineLimit).join("\n");
}
