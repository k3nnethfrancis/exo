import {
  detectTmux,
  exoTmuxSessionName,
  parseTmuxPaneList,
  shellCommand,
  TmuxCommandRunner,
  TmuxControlModeProcess,
  type TmuxAvailability,
  tmuxEnvironmentArgs,
  type TmuxAvailable,
} from "./terminal-tmux";
import type {
  TerminalRuntime,
  TerminalRuntimeAttachOptions,
  TerminalRuntimeAvailability,
  TerminalRuntimeCaptureRestoreSnapshotOptions,
  TerminalRuntimeCaptureTailOptions,
  TerminalRuntimeCreateSessionOptions,
  TerminalRuntimePaneInfo,
  TerminalRuntimeProcess,
  TerminalRuntimeRestoreSnapshot,
  TerminalRuntimeSession,
  TerminalRuntimeSessionOptions,
} from "./terminal-runtime";

export class TmuxTerminalRuntime implements TerminalRuntime {
  readonly kind = "tmux" as const;
  private tmuxAvailabilityCache?: {
    exoTmuxPath: string | undefined;
    availability: TmuxAvailability;
  };

  availability(): TerminalRuntimeAvailability {
    const availability = this.detectTmuxCached();
    if (availability.available) {
      return { available: true };
    }
    return availability;
  }

  createSession(options: TerminalRuntimeCreateSessionOptions): TerminalRuntimeSession {
    const tmux = this.requireTmux();
    const runner = new TmuxCommandRunner(tmux.path);
    const sessionName = exoTmuxSessionName(options.sessionToken, options.workspaceRoot);
    let created = false;
    runner.run(
      [
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-x",
        String(tmuxCellCount(options.cols)),
        "-y",
        String(tmuxCellCount(options.rows)),
        "-c",
        options.cwd,
        ...tmuxEnvironmentArgs(options.env),
        shellCommand(options.command, options.args),
      ],
      {
        cwd: options.cwd,
        env: options.env,
      },
    );
    created = true;
    try {
      this.applySessionOptionsWithRunner(runner, { sessionName, historyLimit: options.historyLimit });
      const paneId = this.requirePaneId(runner, sessionName);
      this.resizeWindowBeforeAttach(runner, {
        sessionName,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env,
      });
      return {
        sessionName,
        paneId,
        process: this.attachSessionWithTmux(tmux, {
          sessionName,
          paneId,
          cwd: options.cwd,
          env: options.env,
          cols: options.cols,
          rows: options.rows,
        }),
      };
    } catch (error) {
      if (created) {
        this.cleanupCreatedSession(runner, sessionName, error);
      }
      throw error;
    }
  }

  attachSession(options: TerminalRuntimeAttachOptions): TerminalRuntimeProcess {
    const tmux = this.requireTmux();
    this.resizeWindowBeforeAttach(new TmuxCommandRunner(tmux.path), {
      sessionName: options.sessionName,
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });
    return this.attachSessionWithTmux(tmux, options);
  }

  listPanes(): TerminalRuntimePaneInfo[] {
    const runner = this.runnerOrNull();
    if (!runner) {
      // Pane listing is used by diagnostics/reconciliation. Creation still
      // calls requireTmux(), so this is graceful degraded health reporting,
      // not an alternate runtime path.
      return [];
    }
    return this.listPanesWithRunner(runner);
  }

  applySessionOptions(options: TerminalRuntimeSessionOptions): void {
    const runner = this.runnerOrNull();
    if (!runner) {
      return;
    }
    this.applySessionOptionsWithRunner(runner, options);
  }

  private applySessionOptionsWithRunner(runner: TmuxCommandRunner, options: TerminalRuntimeSessionOptions): void {
    for (const [key, value] of tmuxSessionOptions(options.historyLimit)) {
      try {
        runner.run(["set-option", "-t", options.sessionName, key, value]);
      } catch (error) {
        console.warn("[exo] failed to set tmux session option", {
          sessionName: options.sessionName,
          option: key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  captureTailForDisplay(options: TerminalRuntimeCaptureTailOptions): string {
    const runner = this.runnerOrNull();
    if (!runner) {
      // Tail reads should not crash the app if tmux disappears between startup
      // and diagnostics/CLI reads; callers can fall back to their bounded cache.
      return "";
    }
    return normalizeCapturedTailForDisplay(runner.run([
      "capture-pane",
      "-p",
      "-e",
      "-t",
      options.paneId || options.sessionName,
      "-S",
      `-${options.lineLimit && options.lineLimit > 0 ? Math.min(options.lineLimit, options.historyLimit) : options.historyLimit}`,
    ]));
  }

  captureRestoreSnapshot(options: TerminalRuntimeCaptureRestoreSnapshotOptions): TerminalRuntimeRestoreSnapshot {
    const runner = this.runnerOrNull();
    if (!runner) {
      return { content: "", cols: 0, rows: 0, altScreen: false };
    }

    const paneTarget = options.paneId || options.sessionName;
    const state = parseRestorePaneState(runner.run([
      "display-message",
      "-p",
      "-t",
      paneTarget,
      "#{pane_width}\t#{pane_height}\t#{alternate_on}\t#{pane_mode}\t#{cursor_x}\t#{cursor_y}",
    ]));
    if (state.paneMode === "copy-mode") {
      console.warn("[exo] captured terminal restore snapshot while tmux pane is in copy-mode", {
        sessionName: options.sessionName,
        paneId: options.paneId,
      });
    }
    if (state.altScreen) {
      return { content: "", cols: state.cols, rows: state.rows, altScreen: true };
    }

    const captureLines = Math.min(options.liveScrollbackLines, options.historyLimit);
    const content = runner.run([
      "capture-pane",
      "-e",
      "-p",
      "-J",
      "-t",
      paneTarget,
      "-S",
      `-${captureLines}`,
    ]);
    return {
      content: `${content}${cursorPositionEscape(state.cursorX, state.cursorY, state.cols)}`,
      cols: state.cols,
      rows: state.rows,
      altScreen: false,
    };
  }

  terminate(sessionName: string): void {
    const tmux = this.requireTmux();
    new TmuxCommandRunner(tmux.path).run(["kill-session", "-t", sessionName]);
  }

  private requireTmux(): TmuxAvailable {
    const availability = this.detectTmuxCached();
    if (!availability.available) {
      throw new Error(availability.reason);
    }
    return availability;
  }

  private runnerOrNull(): TmuxCommandRunner | null {
    const availability = this.detectTmuxCached();
    return availability.available ? new TmuxCommandRunner(availability.path) : null;
  }

  private detectTmuxCached(): TmuxAvailability {
    const exoTmuxPath = process.env.EXO_TMUX_PATH;
    const cached = this.tmuxAvailabilityCache;
    if (cached && cached.exoTmuxPath === exoTmuxPath) {
      return cached.availability;
    }
    const availability = detectTmux();
    this.tmuxAvailabilityCache = { exoTmuxPath, availability };
    return availability;
  }

  private attachSessionWithTmux(tmux: TmuxAvailable, options: TerminalRuntimeAttachOptions): TerminalRuntimeProcess {
    return new TmuxControlModeProcess({
      tmuxPath: tmux.path,
      sessionName: options.sessionName,
      paneId: options.paneId,
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        SHELL_SESSIONS_DISABLE: "1",
        ...options.env,
      },
    });
  }

  private resizeWindowBeforeAttach(
    runner: TmuxCommandRunner,
    options: { sessionName: string; cols: number; rows: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ): void {
    // Tmux may collapse a detached window to its default size before a new
    // control client exists. Assert the renderer-recorded geometry before
    // attach so cursor-relative repaint apps receive the right SIGWINCH size.
    runner.run([
      "resize-window",
      "-t",
      options.sessionName,
      "-x",
      String(tmuxCellCount(options.cols)),
      "-y",
      String(tmuxCellCount(options.rows)),
    ], {
      cwd: options.cwd,
      env: options.env,
    });
  }

  private requirePaneId(runner: TmuxCommandRunner, sessionName: string): string {
    let panes: TerminalRuntimePaneInfo[];
    try {
      panes = this.listPanesWithRunner(runner);
    } catch (error) {
      console.warn("[exo] failed to list tmux panes while creating terminal session", {
        sessionName,
        error: error instanceof Error ? error.message : String(error),
      });
      panes = [];
    }
    const pane = panes.find((candidate) => candidate.sessionName === sessionName && !candidate.dead);
    if (!pane) {
      throw new Error(`Unable to find live tmux pane for session ${sessionName}.`);
    }
    return pane.paneId;
  }

  private cleanupCreatedSession(runner: TmuxCommandRunner, sessionName: string, cause: unknown): void {
    try {
      runner.run(["kill-session", "-t", sessionName]);
    } catch (cleanupError) {
      console.warn("[exo] failed to clean up partially-created tmux terminal session", {
        sessionName,
        cause: cause instanceof Error ? cause.message : String(cause),
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  private listPanesWithRunner(runner: TmuxCommandRunner): TerminalRuntimePaneInfo[] {
    const raw = runner.run([
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_current_path}",
    ]);
    return parseTmuxPaneList(raw).map((pane) => ({
      sessionName: pane.sessionName,
      paneId: pane.paneId,
      dead: pane.dead,
      currentCommand: pane.currentCommand,
      currentPath: pane.currentPath,
    }));
  }
}

function tmuxSessionOptions(historyLimit: number): Array<[string, string]> {
  return [
    ["history-limit", String(historyLimit)],
    ["status", "off"],
    ["mouse", "off"],
    ["focus-events", "on"],
  ];
}

function tmuxCellCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * Display-only. Never use for live restore -- trimming desynchronizes xterm's
 * grid from tmux's (see EXO-ISSUE-075).
 */
function normalizeCapturedTailForDisplay(data: string): string {
  const trimmed = data.replace(/[ \t]+\r?\n/g, "\n").replace(/\s+$/g, "");
  return trimmed.length > 0 ? `${trimmed.replace(/\r?\n/g, "\r\n")}\r\n` : "";
}

function parseRestorePaneState(raw: string): {
  cols: number;
  rows: number;
  altScreen: boolean;
  paneMode: string;
  cursorX: number;
  cursorY: number;
} {
  const [cols, rows, alternateOn, paneMode = "", cursorX, cursorY] = raw.replace(/\r?\n$/, "").split("\t");
  return {
    cols: tmuxCellCount(Number(cols)),
    rows: tmuxCellCount(Number(rows)),
    altScreen: alternateOn === "1",
    paneMode,
    cursorX: tmuxCellIndex(Number(cursorX)),
    cursorY: tmuxCellIndex(Number(cursorY)),
  };
}

function cursorPositionEscape(cursorX: number, cursorY: number, cols: number): string {
  if (cursorX >= cols) {
    // tmux can report the virtual column just past a full-width final line.
    // CUP cannot encode that wrap-pending state, so place xterm at the right
    // edge one row up; the next printable cell advances to tmux's effective row.
    return `\x1b[${Math.max(1, cursorY - 2)};${cols}H`;
  }
  return `\x1b[${cursorY + 1};${Math.min(cursorX + 1, cols)}H`;
}

function tmuxCellIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
