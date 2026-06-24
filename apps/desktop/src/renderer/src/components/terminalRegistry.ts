import { Terminal } from "xterm";

const terminalRegistry = new Map<string, { terminal: Terminal; write: (data: string) => void; refresh: () => void }>();

export function registerTerminal(sessionId: string, terminal: Terminal, write: (data: string) => void, refresh: () => void = () => {}) {
  terminalRegistry.set(sessionId, { terminal, write, refresh });
}

export function unregisterTerminal(sessionId: string) {
  terminalRegistry.delete(sessionId);
}

export function writeTerminalData(sessionId: string, data: string): boolean {
  const entry = terminalRegistry.get(sessionId);
  if (!entry) return false;
  entry.write(data);
  return true;
}

export function hasRegisteredTerminal(sessionId: string): boolean {
  return terminalRegistry.has(sessionId);
}

export function focusTerminal(sessionId: string): boolean {
  const entry = terminalRegistry.get(sessionId);
  if (!entry) return false;
  entry.refresh();
  entry.terminal.focus();
  return true;
}

export function getRenderedTerminalContent(sessionId: string): string {
  const entry = terminalRegistry.get(sessionId);
  if (!entry) return "";
  const buffer = entry.terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  return lines.join("\n");
}
