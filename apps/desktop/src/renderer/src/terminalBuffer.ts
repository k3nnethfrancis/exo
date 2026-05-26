const MAX_RENDERER_TERMINAL_BUFFER_CHARS = 250_000;

export function trimRendererTerminalBuffer(buffer: string): string {
  if (buffer.length <= MAX_RENDERER_TERMINAL_BUFFER_CHARS) {
    return buffer;
  }

  return buffer.slice(-MAX_RENDERER_TERMINAL_BUFFER_CHARS);
}
