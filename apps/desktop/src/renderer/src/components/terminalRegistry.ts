import { Terminal } from "xterm";

const terminalRegistry = new Map<string, Terminal>();

export function registerTerminal(sessionId: string, terminal: Terminal) {
  terminalRegistry.set(sessionId, terminal);
}

export function unregisterTerminal(sessionId: string) {
  terminalRegistry.delete(sessionId);
}

export function getRenderedTerminalContent(sessionId: string): string {
  const terminal = terminalRegistry.get(sessionId);
  if (!terminal) return "";
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n");
}
