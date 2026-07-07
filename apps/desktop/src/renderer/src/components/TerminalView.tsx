import { useEffect, useRef, type MutableRefObject } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
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
import { normalizeTerminalPresentation } from "./terminalPresentation";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

const TERMINAL_RESIZE_DEBOUNCE_MS = 16;

interface TerminalViewProps {
  theme: ExoThemeVariant;
  session: TerminalSessionInfo;
  focused: boolean;
  hydrationSnapshot: string;
  hydrationVersion: number;
  hydrationReason: TerminalHydrationReason;
  fontSize: number;
  scrollbackLines: number;
  onFocus: () => void;
  onInput: (id: string, data: string) => void;
  onGeometryMeasured: (id: string, cols: number, rows: number) => void;
  onReady?: (id: string) => void;
  onHydrated?: (id: string) => void;
  inputEnabled?: boolean;
}

export function TerminalView(props: TerminalViewProps) {
  const { theme, session, focused, hydrationSnapshot, hydrationVersion, hydrationReason, fontSize, scrollbackLines, onFocus, onInput, onGeometryMeasured, onReady, onHydrated, inputEnabled = true } = props;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hydrationStateRef = useRef(initialTerminalHydrationViewState());
  const writeQueueRef = useRef<string[]>([]);
  const writeDrainCallbacksRef = useRef<Array<() => void>>([]);
  const outputChunkerRef = useRef(new TerminalOutputChunker());
  const writingRef = useRef(false);
  const disposedRef = useRef(false);
  const inputHandlerRef = useRef(onInput);
  const inputEnabledRef = useRef(inputEnabled);
  const hydratedHandlerRef = useRef(onHydrated);
  const geometryMeasuredHandlerRef = useRef(onGeometryMeasured);
  const focusedRef = useRef(focused);
  const sizeRef = useRef({ width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 });

  useEffect(() => {
    inputHandlerRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    inputEnabledRef.current = inputEnabled;
  }, [inputEnabled]);

  useEffect(() => {
    hydratedHandlerRef.current = onHydrated;
  }, [onHydrated]);

  useEffect(() => {
    geometryMeasuredHandlerRef.current = onGeometryMeasured;
  }, [onGeometryMeasured]);

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  useEffect(() => {
    hydrationStateRef.current = initialTerminalHydrationViewState();
    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize,
      customGlyphs: TERMINAL_CUSTOM_GLYPHS,
      cursorBlink: false,
      minimumContrastRatio: 4.5,
      scrollback: scrollbackLines,
      theme: exoXtermTheme(theme),
    });
    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    disposedRef.current = false;
    // Terminal harnesses render modern TUI glyphs: emoji, braille spinners,
    // box drawing, and private-use symbols. Xterm's default width table is too
    // old for those sequences, which can make clean tmux output display as
    // wrapped borders or replacement glyphs after reconnect/resize.
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(fitAddon);
    terminal.open(viewportRef.current!);
    requestAnimationFrame(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef);
      if (focusedRef.current) {
        terminal.focus();
      }
    });

    const disposeData = terminal.onData((data) => {
      // Main owns terminal writability. Renderer inputEnabled can briefly lag
      // after reconnect/hydration, and dropping keystrokes here caused live
      // tmux panes to accept input only after a hard refresh.
      if (isTerminalGeneratedResponse(data)) {
        return;
      }
      inputHandlerRef.current(session.id, data);
    });

    const observer = new ResizeObserver(() => {
      refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
    });
    observer.observe(viewportRef.current!);

    const visibilityObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
        }
      }, { threshold: 0.01 });
    visibilityObserver?.observe(surfaceRef.current!);

    const reconcileSurface = () => {
      refreshTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
    };
    const fitSurface = () => {
      fitTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
    };
    const eventNames: Array<"focus" | "resize" | "pageshow" | "visibilitychange"> = [
      "focus",
      "resize",
      "pageshow",
      "visibilitychange",
    ];
    for (const eventName of eventNames) {
      window.addEventListener(eventName, reconcileSurface);
    }

    function focusTerminal(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      onFocus();
      fitSurface();
      focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
      window.requestAnimationFrame(() => {
        focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
      });
      window.setTimeout(() => {
        fitSurface();
        focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
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
    surfaceRef.current!.addEventListener("dragover", handleDragOver, { capture: true });
    surfaceRef.current!.addEventListener("drop", handleDrop, { capture: true });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 };
    registerTerminal(session.id, session.attachGeneration, terminal, (data) => {
      enqueueTerminalWrite(terminal, data, writeQueueRef, writeDrainCallbacksRef, outputChunkerRef, writingRef, disposedRef);
    }, () => {
      fitTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
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
      visibilityObserver?.disconnect();
      for (const eventName of eventNames) {
        window.removeEventListener(eventName, reconcileSurface);
      }
      surfaceRef.current?.removeEventListener("mousedown", focusTerminal);
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
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    if (sizeRef.current.resizeTimer) {
      window.clearTimeout(sizeRef.current.resizeTimer);
    }
    sizeRef.current = { width: 0, height: 0, cols: 0, rows: 0, resizeTimer: 0 };
    registerTerminal(session.id, session.attachGeneration, terminal, (data) => {
      enqueueTerminalWrite(terminal, data, writeQueueRef, writeDrainCallbacksRef, outputChunkerRef, writingRef, disposedRef);
    }, () => {
      fitTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
    });
    safeFit(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef);
    onReady?.(session.id);
  }, [session.id, session.attachGeneration]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!focused || !terminal || !fitAddon) {
      return;
    }

    fitTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
    focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
    window.requestAnimationFrame(() => {
      fitTerminalSurface(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef, disposedRef);
      focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
    });
  }, [focused, session.id]);

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
      safeFit(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef);
    });
  }, [fontSize, session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    requestAnimationFrame(() => {
      safeFit(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef);
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
    writeDrainCallbacksRef.current = [];
    outputChunkerRef.current.reset();
    writingRef.current = false;
    safeFit(viewportRef.current, terminal, fitAddon, session.id, geometryMeasuredHandlerRef.current, sizeRef);
    const previousConvertEol = terminal.options.convertEol;
    terminal.options.convertEol = true;
    const markHydrated = () => {
      hydratedHandlerRef.current?.(session.id);
    };
    if (hydrationSnapshot.length === 0) {
      terminal.options.convertEol = previousConvertEol;
      markHydrated();
      return;
    }
    enqueueTerminalWrite(terminal, hydrationSnapshot, writeQueueRef, writeDrainCallbacksRef, outputChunkerRef, writingRef, disposedRef, () => {
      terminal.options.convertEol = previousConvertEol;
      terminal.scrollToBottom();
      markHydrated();
    });
    if (focusedRef.current) {
      focusTerminalElement(surfaceRef.current, viewportRef.current, terminal);
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
  drainCallbacksRef: MutableRefObject<Array<() => void>>,
  outputChunkerRef: MutableRefObject<TerminalOutputChunker>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
  onDrained?: () => void,
) {
  if (data.length === 0 || disposedRef.current) {
    return;
  }

  // Presentation normalization is display-only: tmux output, transcripts, and
  // CLI reads keep the original bytes. This asks Chromium/xterm to render
  // terminal UI symbols like Claude's U+23FA marker as text, not colorful emoji.
  const displayData = normalizeTerminalPresentation(data);
  for (const chunk of outputChunkerRef.current.chunks(displayData, TERMINAL_WRITE_CHUNK_SIZE)) {
    queueRef.current.push(chunk);
  }
  if (onDrained) {
    drainCallbacksRef.current.push(onDrained);
  }

  drainTerminalWriteQueue(terminal, queueRef, drainCallbacksRef, writingRef, disposedRef);
}

function drainTerminalWriteQueue(
  terminal: Terminal,
  queueRef: MutableRefObject<string[]>,
  drainCallbacksRef: MutableRefObject<Array<() => void>>,
  writingRef: MutableRefObject<boolean>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (writingRef.current || disposedRef.current) {
    return;
  }

  const next = queueRef.current.shift();
  if (next === undefined) {
    const callbacks = drainCallbacksRef.current.splice(0);
    for (const callback of callbacks) {
      callback();
    }
    return;
  }

  writingRef.current = true;
  try {
    terminal.write(next, () => {
      writingRef.current = false;
      if (!disposedRef.current) {
        window.requestAnimationFrame(() => {
          drainTerminalWriteQueue(terminal, queueRef, drainCallbacksRef, writingRef, disposedRef);
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
  onGeometryMeasured: (id: string, cols: number, rows: number) => void,
  sizeRef: MutableRefObject<{ width: number; height: number; cols: number; rows: number; resizeTimer: number }>,
) {
  const rect = host?.getBoundingClientRect();
  if (!rect || rect.width < 80 || rect.height < 60) {
    return;
  }

  fitAddon.fit();

  // This dedupe is scoped to one TerminalView attach generation. The
  // attachGeneration effect clears sizeRef so a new attach reports its first
  // renderer-fit geometry back to tmux.
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
    onGeometryMeasured(sessionId, terminal.cols, terminal.rows);
    return;
  }

  if (sizeRef.current.resizeTimer) {
    window.clearTimeout(sizeRef.current.resizeTimer);
  }
  sizeRef.current.resizeTimer = window.setTimeout(() => {
    sizeRef.current.resizeTimer = 0;
    onGeometryMeasured(sessionId, terminal.cols, terminal.rows);
  }, TERMINAL_RESIZE_DEBOUNCE_MS);
}

function refreshTerminalSurface(
  host: HTMLDivElement | null,
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: string,
  onGeometryMeasured: (id: string, cols: number, rows: number) => void,
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
    safeFit(host, terminal, fitAddon, sessionId, onGeometryMeasured, sizeRef);
    if (terminal.rows > 0) {
      terminal.refresh(0, terminal.rows - 1);
    }
  });
}

function fitTerminalSurface(
  host: HTMLDivElement | null,
  terminal: Terminal,
  fitAddon: FitAddon,
  sessionId: string,
  onGeometryMeasured: (id: string, cols: number, rows: number) => void,
  sizeRef: MutableRefObject<{ width: number; height: number; cols: number; rows: number; resizeTimer: number }>,
  disposedRef: MutableRefObject<boolean>,
) {
  if (disposedRef.current) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (!disposedRef.current) {
      safeFit(host, terminal, fitAddon, sessionId, onGeometryMeasured, sizeRef);
    }
  });
}

function focusTerminalElement(
  surface: HTMLDivElement | null,
  viewport: HTMLDivElement | null,
  terminal: Terminal,
) {
  void window.exo.shell.focusWindow().catch(() => {});
  window.focus();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  surface?.focus({ preventScroll: true });
  terminal.focus();
  const helperTextarea = viewport?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
  helperTextarea?.focus({ preventScroll: true });
}

function shellEscape(path: string): string {
  // Single-quote the path, escaping any embedded single quotes
  return "'" + path.replace(/'/g, "'\\''") + "'";
}
