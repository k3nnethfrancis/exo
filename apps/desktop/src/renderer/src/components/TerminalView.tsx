import { useEffect, useRef } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";

interface TerminalViewProps {
  session: TerminalSessionInfo;
  buffer: string;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
}

export function TerminalView(props: TerminalViewProps) {
  const { session, buffer, onInput, onResize } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bufferRef = useRef("");

  useEffect(() => {
    const terminal = new Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: false,
      theme: {
        background: "#15161b",
        foreground: "#e4e7ee",
        selectionBackground: "#3f4f73",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current!);
    fitAddon.fit();
    onResize(session.id, terminal.cols, terminal.rows);

    const disposeData = terminal.onData((data) => {
      onInput(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      onResize(session.id, terminal.cols, terminal.rows);
    });
    observer.observe(hostRef.current!);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    bufferRef.current = "";

    return () => {
      disposeData.dispose();
      observer.disconnect();
      terminal.dispose();
    };
  }, [session.id, onInput, onResize]);

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
    fitAddonRef.current?.fit();
    onResize(session.id, terminal.cols, terminal.rows);
  }, [buffer, onResize, session.id]);

  return <div ref={hostRef} className="terminal-surface" data-testid="terminal-surface" />;
}
