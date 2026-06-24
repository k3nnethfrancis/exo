import { useEffect, useRef, type MutableRefObject } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { TerminalSessionInfo } from "../../../shared/api";
import type { ExoThemeVariant } from "../theme/types";
import { exoXtermTheme } from "../theme/xterm";
import { TERMINAL_CUSTOM_GLYPHS, TERMINAL_FONT_FAMILY } from "./terminalFonts";
import {
  initialTerminalHydrationViewState,
  markTerminalHydrationApplied,
  shouldApplyTerminalHydration,
  type TerminalHydrationReason,
} from "./terminalHydration";
import { isTerminalGeneratedResponse } from "./terminalInputFilters";
import { TerminalOutputChunker, TERMINAL_WRITE_CHUNK_SIZE } from "./terminalOutputChunks";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

const TERMINAL_RESIZE_DEBOUNCE_MS = 16;

interface TerminalViewProps {
  theme: ExoThemeVariant;
  session: TerminalSessionInfo;
  hydrationSnapshot: string;
  hydrationVersion: number;
  hydrationReason: TerminalHydrationReason;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onReady?: (id: string) => void;
  inputEnabled?: boolean;
}

export function TerminalView(props: TerminalViewProps) {
  const { theme, session, hydrationSnapshot, hydrationVersion, hydrationReason, fontSize, scrollbackLines, onFocus, onInput, onResize, onReady, inputEnabled = true } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hydrationStateRef = useRef(initialTerminalHydrationViewState());
  const writeQueueRef = useRef<string[]>([]);
  const outputChunkerRef = useRef(new TerminalOutputChunker());
  const writingRef = useRef(false);
  const disposedRef = useRef(false);
  const inputHandlerRef = useRef(onInput);
  const inputEnabledRef = useRef(inputEnabled);
  const resizeHandlerRef = useRef(onResize);
  const sizeRef = useRef({ width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 });

  useEffect(() => {
    inputHandlerRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
  }, [inputEnabled]);

  useEffect(() => {
    resizeHandlerRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    hydrationStateRef.current = initialTerminalHydrationViewState();
    const terminal = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize,
      customGlyphs: TERMINAL_CUSTOM_GLYPHS,
      cursorBlink: false,
      minimumContrastRatio: 4.5,
      scrollback: scrollbackLines,
      theme: exoXtermTheme(theme),
    });
    const fitAddon = new FitAddon();
    disposedRef.current = false;
    terminal.loadAddon(fitAddon);
    terminal.open(viewportRef.current!);
    requestAnimationFrame(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
      terminal.focus();
    });

    const disposeData = terminal.onData((data) => {
      if (!inputEnabledRef.current) {
        return;
      }
      if (isTerminalGeneratedResponse(data)) {
        return;
      }
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
    observer.observe(viewportRef.current!);

    function focusTerminal(event?: MouseEvent) {
      event?.preventDefault();
      onFocus();
      refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef, disposedRef);
      terminal.focus();
      window.setTimeout(() => {
        refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef, disposedRef);
        terminal.focus();
      }, 0);
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
      if (!inputEnabledRef.current) {
        return;
      }

      inputHandlerRef.current(session.id, `${paths.map(shellEscape).join(" ")} `);
      terminal.focus();
    }

    surfaceRef.current!.addEventListener("mousedown", focusTerminal);
    surfaceRef.current!.addEventListener("click", focusTerminal);
    surfaceRef.current!.addEventListener("dragover", handleDragOver, { capture: true });
    surfaceRef.current!.addEventListener("drop", handleDrop, { capture: true });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 };
    registerTerminal(session.id, terminal, (data) => {
      enqueueTerminalWrite(terminal, data, writeQueueRef, outputChunkerRef, writingRef, disposedRef);
    }, () => {
      refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef, disposedRef);
    });
    onReady?.(session.id);

    return () => {
      unregisterTerminal(session.id);
      disposedRef.current = true;
      writeQueueRef.current = [];
      outputChunkerRef.current.reset();
      writingRef.current = false;
      disposeData.dispose();
      observer.disconnect();
      surfaceRef.current?.removeEventListener("mousedown", focusTerminal);
      surfaceRef.current?.removeEventListener("click", focusTerminal);
      surfaceRef.current?.removeEventListener("dragover", handleDragOver, { capture: true });
      surfaceRef.current?.removeEventListener("drop", handleDrop, { capture: true });
      terminal.dispose();
      if (sizeRef.current.resizeTimer) {
        window.clearTimeout(sizeRef.current.resizeTimer);
      }
    };
  }, [session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = exoXtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.options.fontSize = fontSize;
    requestAnimationFrame(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
  }, [fontSize, session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    requestAnimationFrame(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    });
  }, [session.health, session.healthDetail, session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.scrollback = scrollbackLines;
  }, [scrollbackLines]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    const shouldFollowOutput = isScrolledToBottom(terminal);

    const hydrationFrame = {
      snapshot: hydrationSnapshot,
      version: hydrationVersion,
      reason: hydrationReason,
    };
    if (!shouldApplyTerminalHydration(hydrationStateRef.current, hydrationFrame)) {
      return;
    }
    hydrationStateRef.current = markTerminalHydrationApplied(hydrationStateRef.current, hydrationFrame);

    // Hydration is the only path that may reset xterm: first mount/reload
    // before this xterm exists, or explicit reconnect. Later bootstrap
    // versions are metadata/pending-data churn and must stay append-only.
    terminal.reset();
    writeQueueRef.current = [];
    outputChunkerRef.current.reset();
    writingRef.current = false;
    safeFit(viewportRef.current, terminal, fitAddon, session.id, resizeHandlerRef.current, sizeRef);
    enqueueTerminalWrite(terminal, hydrationSnapshot, writeQueueRef, outputChunkerRef, writingRef, disposedRef);
    if (shouldFollowOutput) {
      terminal.scrollToBottom();
    }
  }, [hydrationReason, hydrationSnapshot, hydrationVersion, session.id]);

  return (
    <div
      ref={surfaceRef}
      className={`terminal-surface ${inputEnabled ? "" : "terminal-surface--input-disabled"}`}
      data-testid="terminal-surface"
      tabIndex={0}
      aria-disabled={!inputEnabled}
    >
      <div ref={viewportRef} className="terminal-surface__viewport" />
    </div>
  );
}

function enqueueTerminalWrite(
  terminal: Terminal,
  data: string,
  queueRef: MutableRefObject<string[]>,
  outputChunkerRef: MutableRefObject<TerminalOutputChunker>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (data.length === 0 || disposedRef.current) {
    return;
  }

  for (const chunk of outputChunkerRef.current.chunks(data, TERMINAL_WRITE_CHUNK_SIZE)) {
    queueRef.current.push(chunk);
  }

  drainTerminalWriteQueue(terminal, queueRef, writingRef, disposedRef);
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

  const isInitialMeasurement = sizeRef.current.width === 0 || sizeRef.current.height === 0 || sizeRef.current.cols === 0 || sizeRef.current.rows === 0;
  sizeRef.current = {
    width: rect.width,
    height: rect.height,
    cols: terminal.cols,
    rows: terminal.rows,
    resizeTimer: sizeRef.current.resizeTimer,
  };

  if (isInitialMeasurement) {
    onResize(sessionId, terminal.cols, terminal.rows);
    return;
  }

  if (sizeRef.current.resizeTimer) {
    window.clearTimeout(sizeRef.current.resizeTimer);
  }
  sizeRef.current.resizeTimer = window.setTimeout(() => {
    sizeRef.current.resizeTimer = 0;
    onResize(sessionId, terminal.cols, terminal.rows);
  }, TERMINAL_RESIZE_DEBOUNCE_MS);
}

function refreshTerminalSurface(
  host: HTMLDivElement | null,
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: string,
  onResize: (id: string, cols: number, rows: number) => void,
  sizeRef: MutableRefObject<{ width: number; height: number; cols: number; rows: number; resizeTimer: number }>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (disposedRef.current) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (disposedRef.current) {
      return;
    }
    safeFit(host, terminal, fitAddon, sessionId, onResize, sizeRef);
    if (terminal.rows > 0) {
      terminal.refresh(0, terminal.rows - 1);
    }
  });
}

function shellEscape(path: string): string {
  // Single-quote the path, escaping any embedded single quotes
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

function isScrolledToBottom(terminal: Terminal): boolean {
  return terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
}
