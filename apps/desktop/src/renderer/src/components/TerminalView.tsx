import { useEffect, useRef, type MutableRefObject } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ResolvedAppearance } from "../App";

// Registry of xterm Terminal instances for reading rendered content
const terminalRegistry = new Map<string, Terminal>();

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

interface TerminalViewProps {
  appearance: ResolvedAppearance;
  session: TerminalSessionInfo;
  buffer: string;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
}

export function TerminalView(props: TerminalViewProps) {
  const { appearance, session, buffer, onInput, onResize } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bufferRef = useRef("");
  const inputHandlerRef = useRef(onInput);
  const resizeHandlerRef = useRef(onResize);
  const sizeRef = useRef({ width: 0, height: 0, cols: 0, rows: 0 });

  useEffect(() => {
    inputHandlerRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    resizeHandlerRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const terminal = new Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: false,
      theme: xtermTheme(appearance),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current!);
    requestAnimationFrame(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
      terminal.focus();
    });

    const disposeData = terminal.onData((data) => {
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
    observer.observe(hostRef.current!);

    function focusTerminal() {
      terminal.focus();
    }

    hostRef.current!.addEventListener("mousedown", focusTerminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    bufferRef.current = "";
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0 };
    terminalRegistry.set(session.id, terminal);

    return () => {
      terminalRegistry.delete(session.id);
      disposeData.dispose();
      observer.disconnect();
      hostRef.current?.removeEventListener("mousedown", focusTerminal);
      terminal.dispose();
    };
  }, [appearance, session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = xtermTheme(appearance);
  }, [appearance]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (bufferRef.current === buffer) {
      return;
    }

    if (buffer.startsWith(bufferRef.current)) {
      terminal.write(buffer.slice(bufferRef.current.length));
    } else {
      terminal.reset();
      terminal.write(buffer);
    }
    bufferRef.current = buffer;
  }, [buffer, session.id]);

  return <div ref={hostRef} className="terminal-surface" data-testid="terminal-surface" tabIndex={0} />;
}

function safeFit(
  host: HTMLDivElement | null,
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: string,
  onResize: (id: string, cols: number, rows: number) => void,
  sizeRef: MutableRefObject<{ width: number; height: number; cols: number; rows: number }>,
) {
  const rect = host?.getBoundingClientRect();
  if (!rect || rect.width < 80 || rect.height < 60) {
    return;
  }

  fitAddon.fit();

  if (
    sizeRef.current.width === rect.width &&
    sizeRef.current.height === rect.height &&
    sizeRef.current.cols === terminal.cols &&
    sizeRef.current.rows === terminal.rows
  ) {
    return;
  }

  sizeRef.current = {
    width: rect.width,
    height: rect.height,
    cols: terminal.cols,
    rows: terminal.rows,
  };
  onResize(sessionId, terminal.cols, terminal.rows);
}

function xtermTheme(appearance: ResolvedAppearance) {
  if (appearance === "light") {
    return {
      background: "#fff8ec",
      foreground: "#3f3224",
      cursor: "#b47637",
      selectionBackground: "rgba(180, 118, 55, 0.2)",
    };
  }

  return {
    background: "#15161b",
    foreground: "#e4e7ee",
    cursor: "#9fb8ff",
    selectionBackground: "#3f4f73",
  };
}
