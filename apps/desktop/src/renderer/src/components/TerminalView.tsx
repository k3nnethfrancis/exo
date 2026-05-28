import { useEffect, useRef, type MutableRefObject } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ResolvedAppearance } from "../appearance";
import { isTerminalGeneratedResponse } from "./terminalInputFilters";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

const TERMINAL_WRITE_CHUNK_SIZE = 16_384;
const PROGRAMMATIC_INPUT_GUARD_MS = 250;

interface TerminalViewProps {
  appearance: ResolvedAppearance;
  session: TerminalSessionInfo;
  hydrationSnapshot: string;
  hydrationVersion: number;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
}

export function TerminalView(props: TerminalViewProps) {
  const { appearance, session, hydrationSnapshot, hydrationVersion, fontSize, scrollbackLines, onFocus, onInput, onResize } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hydrationVersionRef = useRef(-1);
  const writeQueueRef = useRef<string[]>([]);
  const writingRef = useRef(false);
  const disposedRef = useRef(false);
  const inputHandlerRef = useRef(onInput);
  const resizeHandlerRef = useRef(onResize);
  const wheelInputGuardUntilRef = useRef(0);
  const programmaticInputGuardUntilRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 });

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
      minimumContrastRatio: 4.5,
      scrollback: scrollbackLines,
      theme: xtermTheme(appearance),
    });
    const fitAddon = new FitAddon();
    disposedRef.current = false;
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current!);
    programmaticInputGuardUntilRef.current = Date.now() + PROGRAMMATIC_INPUT_GUARD_MS;
    terminal.write("\x1b[?1049l\x1b[?1047l\x1b[?47l");
    requestAnimationFrame(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
      terminal.focus();
    });

    const disposeData = terminal.onData((data) => {
      if (Date.now() < wheelInputGuardUntilRef.current && isWheelGeneratedInput(data)) {
        return;
      }
      if (Date.now() < programmaticInputGuardUntilRef.current && isTerminalGeneratedResponse(data)) {
        return;
      }
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      safeFit(hostRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
    observer.observe(hostRef.current!);

    function focusTerminal(event?: MouseEvent) {
      event?.preventDefault();
      onFocus();
      terminal.focus();
    }

    function guardWheelGeneratedInput() {
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
    hostRef.current!.addEventListener("wheel", guardWheelGeneratedInput, { capture: true, passive: false });
    hostRef.current!.addEventListener("dragover", handleDragOver, { capture: true });
    hostRef.current!.addEventListener("drop", handleDrop, { capture: true });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 };
    registerTerminal(session.id, terminal, (data) => {
      enqueueTerminalWrite(terminal, data, writeQueueRef, writingRef, disposedRef, programmaticInputGuardUntilRef);
    });

    return () => {
      unregisterTerminal(session.id);
      disposedRef.current = true;
      writeQueueRef.current = [];
      writingRef.current = false;
      disposeData.dispose();
      observer.disconnect();
      hostRef.current?.removeEventListener("mousedown", focusTerminal);
      hostRef.current?.removeEventListener("wheel", guardWheelGeneratedInput, { capture: true });
      hostRef.current?.removeEventListener("dragover", handleDragOver, { capture: true });
      hostRef.current?.removeEventListener("drop", handleDrop, { capture: true });
      terminal.dispose();
      if (sizeRef.current.resizeTimer) {
        window.clearTimeout(sizeRef.current.resizeTimer);
      }
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

    terminal.options.scrollback = scrollbackLines;
  }, [scrollbackLines]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const shouldFollowOutput = isScrolledToBottom(terminal);

    const forceReset = hydrationVersionRef.current !== hydrationVersion;
    if (!forceReset) {
      return;
    }
    hydrationVersionRef.current = hydrationVersion;

    terminal.reset();
    writeQueueRef.current = [];
    writingRef.current = false;
    enqueueTerminalWrite(terminal, hydrationSnapshot, writeQueueRef, writingRef, disposedRef, programmaticInputGuardUntilRef);
    if (shouldFollowOutput) {
      terminal.scrollToBottom();
    }
  }, [hydrationSnapshot, hydrationVersion, session.id]);

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
  programmaticInputGuardUntilRef: MutableRefObject<number>,
) {
  if (data.length === 0 || disposedRef.current) {
    return;
  }

  for (let offset = 0; offset < data.length; offset += TERMINAL_WRITE_CHUNK_SIZE) {
    queueRef.current.push(data.slice(offset, offset + TERMINAL_WRITE_CHUNK_SIZE));
  }

  drainTerminalWriteQueue(terminal, queueRef, writingRef, disposedRef, programmaticInputGuardUntilRef);
}

function drainTerminalWriteQueue(
  terminal: Terminal,
  queueRef: MutableRefObject<string[]>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
  programmaticInputGuardUntilRef: MutableRefObject<number>,
) {
  if (writingRef.current || disposedRef.current) {
    return;
  }

  const next = queueRef.current.shift();
  if (next === undefined) {
    return;
  }

  writingRef.current = true;
  programmaticInputGuardUntilRef.current = Date.now() + PROGRAMMATIC_INPUT_GUARD_MS;
  try {
    terminal.write(next, () => {
      programmaticInputGuardUntilRef.current = Date.now() + PROGRAMMATIC_INPUT_GUARD_MS;
      writingRef.current = false;
      if (!disposedRef.current) {
        window.requestAnimationFrame(() => {
          drainTerminalWriteQueue(terminal, queueRef, writingRef, disposedRef, programmaticInputGuardUntilRef);
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
  sizeRef: MutableRefObject<{ width: number; height: number; cols: number; rows: number; resizeTimer: number }>,
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
    resizeTimer: sizeRef.current.resizeTimer,
  };
  if (sizeRef.current.resizeTimer) {
    window.clearTimeout(sizeRef.current.resizeTimer);
  }
  sizeRef.current.resizeTimer = window.setTimeout(() => {
    sizeRef.current.resizeTimer = 0;
    onResize(sessionId, terminal.cols, terminal.rows);
  }, 75);
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

  if (next.length > previous.length && previous.length > 65_536) {
    return previous.length;
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
