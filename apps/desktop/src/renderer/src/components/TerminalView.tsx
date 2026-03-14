import { useEffect, useRef } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ResolvedAppearance } from "../App";

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
    fitAddon.fit();
    terminal.focus();
    resizeHandlerRef.current(session.id, terminal.cols, terminal.rows);

    const disposeData = terminal.onData((data) => {
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      resizeHandlerRef.current(session.id, terminal.cols, terminal.rows);
    });
    observer.observe(hostRef.current!);

    function focusTerminal() {
      terminal.focus();
    }

    hostRef.current!.addEventListener("mousedown", focusTerminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    bufferRef.current = "";

    return () => {
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
    resizeHandlerRef.current(session.id, terminal.cols, terminal.rows);
  }, [buffer, session.id]);

  return <div ref={hostRef} className="terminal-surface" data-testid="terminal-surface" tabIndex={0} />;
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
