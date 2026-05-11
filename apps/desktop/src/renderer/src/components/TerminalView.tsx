import { useEffect, useRef, type MutableRefObject } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ResolvedAppearance } from "../App";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

const TERMINAL_WRITE_CHUNK_SIZE = 16_384;
const TERMINAL_WRITE_QUEUE_MAX_CHARS = 64_000;

interface TerminalViewProps {
  appearance: ResolvedAppearance;
  session: TerminalSessionInfo;
  buffer: string;
  fontSize: number;
  onFocus: () => void;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
}

export function TerminalView(props: TerminalViewProps) {
  const { appearance, session, buffer, fontSize, onFocus, onInput, onResize } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const bufferRef = useRef("");
  const writeQueueRef = useRef<string[]>([]);
  const writingRef = useRef(false);
  const disposedRef = useRef(false);
  const inputHandlerRef = useRef(onInput);
  const resizeHandlerRef = useRef(onResize);
  const wheelInputGuardUntilRef = useRef(0);
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
      fontSize,
      cursorBlink: false,
      scrollback: 1_000,
      theme: xtermTheme(appearance),
    });
    const fitAddon = new FitAddon();
    disposedRef.current = false;
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current!);
    terminal.write("\x1b[?1049l\x1b[?1047l\x1b[?47l");
    requestAnimationFrame(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
      terminal.focus();
    });

    const disposeData = terminal.onData((data) => {
      if (Date.now() < wheelInputGuardUntilRef.current && isWheelGeneratedInput(data)) {
        return;
      }
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
    observer.observe(hostRef.current!);

    function focusTerminal() {
      onFocus();
      terminal.focus();
    }

    function scrollTerminal(event: WheelEvent) {
      event.stopPropagation();
      wheelInputGuardUntilRef.current = Date.now() + 200;
    }

    function handleDragOver(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    }

    function handleDrop(event: DragEvent) {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const paths = window.exo.terminals.resolveDroppedFilePaths(Array.from(event.dataTransfer.files));
      if (paths.length === 0) {
        return;
      }

      inputHandlerRef.current(session.id, `${paths.map(shellEscape).join(" ")} `);
      terminal.focus();
    }

    hostRef.current!.addEventListener("mousedown", focusTerminal);
    hostRef.current!.addEventListener("wheel", scrollTerminal, { capture: true, passive: false });
    hostRef.current!.addEventListener("dragover", handleDragOver, { capture: true });
    hostRef.current!.addEventListener("drop", handleDrop, { capture: true });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    bufferRef.current = "";
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0 };
    registerTerminal(session.id, terminal);

    return () => {
      unregisterTerminal(session.id);
      disposedRef.current = true;
      writeQueueRef.current = [];
      writingRef.current = false;
      disposeData.dispose();
      observer.disconnect();
      hostRef.current?.removeEventListener("mousedown", focusTerminal);
      hostRef.current?.removeEventListener("wheel", scrollTerminal, { capture: true });
      hostRef.current?.removeEventListener("dragover", handleDragOver, { capture: true });
      hostRef.current?.removeEventListener("drop", handleDrop, { capture: true });
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
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.options.fontSize = fontSize;
    requestAnimationFrame(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
  }, [fontSize, session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (bufferRef.current === buffer) {
      return;
    }

    const shouldFollowOutput = isScrolledToBottom(terminal);

    const appendOffset = findAppendOffset(bufferRef.current, buffer);
    if (appendOffset !== null) {
      enqueueTerminalWrite(terminal, buffer.slice(appendOffset), writeQueueRef, writingRef, disposedRef);
    } else {
      terminal.reset();
      writeQueueRef.current = [];
      writingRef.current = false;
      enqueueTerminalWrite(terminal, buffer, writeQueueRef, writingRef, disposedRef);
    }
    bufferRef.current = buffer;
    if (shouldFollowOutput) {
      terminal.scrollToBottom();
    }
  }, [buffer, session.id]);

  return (
    <div
      ref={hostRef}
      className="terminal-surface"
      data-testid="terminal-surface"
      tabIndex={0}
    />
  );
}

function enqueueTerminalWrite(
  terminal: Terminal,
  data: string,
  queueRef: MutableRefObject<string[]>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (data.length === 0 || disposedRef.current) {
    return;
  }

  for (let offset = 0; offset < data.length; offset += TERMINAL_WRITE_CHUNK_SIZE) {
    queueRef.current.push(data.slice(offset, offset + TERMINAL_WRITE_CHUNK_SIZE));
  }
  trimTerminalWriteQueue(queueRef, TERMINAL_WRITE_QUEUE_MAX_CHARS);

  drainTerminalWriteQueue(terminal, queueRef, writingRef, disposedRef);
}

function trimTerminalWriteQueue(queueRef: MutableRefObject<string[]>, maxChars: number) {
  let total = 0;
  for (let index = queueRef.current.length - 1; index >= 0; index -= 1) {
    total += queueRef.current[index].length;
    if (total > maxChars) {
      queueRef.current = queueRef.current.slice(index + 1);
      return;
    }
  }
}

function drainTerminalWriteQueue(
  terminal: Terminal,
  queueRef: MutableRefObject<string[]>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (writingRef.current || disposedRef.current) {
    return;
  }

  const next = queueRef.current.shift();
  if (next === undefined) {
    return;
  }

  writingRef.current = true;
  try {
    terminal.write(next, () => {
      writingRef.current = false;
      if (!disposedRef.current) {
        window.requestAnimationFrame(() => {
          drainTerminalWriteQueue(terminal, queueRef, writingRef, disposedRef);
        });
      }
    });
  } catch (error) {
    writingRef.current = false;
    console.error("[terminal] xterm write failed", error);
  }
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

function shellEscape(path: string): string {
  // Single-quote the path, escaping any embedded single quotes
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

function isWheelGeneratedInput(data: string): boolean {
  return /^(?:\x1b\[[AB]|\x1bO[AB]|\x1b\[[56]~|\x1b\[M[\s\S]{3}|\x1b\[<\d+;\d+;\d+[mM])+$/.test(data);
}

function isScrolledToBottom(terminal: Terminal): boolean {
  return terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
}

function findAppendOffset(previous: string, next: string): number | null {
  if (previous === next) {
    return next.length;
  }

  if (next.startsWith(previous)) {
    return previous.length;
  }

  const overlap = longestSuffixPrefixOverlap(previous, next);
  return overlap > 0 ? overlap : null;
}

function longestSuffixPrefixOverlap(previous: string, next: string): number {
  const maxOverlap = Math.min(previous.length, next.length);
  if (maxOverlap === 0) {
    return 0;
  }

  const candidate = next.slice(0, maxOverlap);
  const pattern = `${candidate}\0${previous.slice(-maxOverlap)}`;
  const table = new Array<number>(pattern.length).fill(0);

  for (let i = 1; i < pattern.length; i += 1) {
    let length = table[i - 1];
    while (length > 0 && pattern[i] !== pattern[length]) {
      length = table[length - 1];
    }
    if (pattern[i] === pattern[length]) {
      length += 1;
    }
    table[i] = length;
  }

  return table[table.length - 1] ?? 0;
}

function xtermTheme(appearance: ResolvedAppearance) {
  if (appearance === "light") {
    return {
      background: "#fdf6e3",
      foreground: "#586e75",
      cursor: "#586e75",
      selectionBackground: "rgba(38, 139, 210, 0.18)",
    };
  }

  return {
    background: "#1f1f1f",
    foreground: "#d4d4d4",
    cursor: "#c8c8c8",
    selectionBackground: "#3a3d41",
  };
}
