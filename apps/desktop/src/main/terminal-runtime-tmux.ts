import {
  detectTmux,
  exoTmuxSessionName,
  parseTmuxPaneList,
  shellCommand,
  TmuxCommandRunner,
  TmuxControlModeProcess,
  tmuxEnvironmentArgs,
  type TmuxAvailable,
} from "./terminal-tmux";
import type {
  TerminalRuntime,
  TerminalRuntimeAttachOptions,
  TerminalRuntimeAvailability,
  TerminalRuntimeCaptureTailOptions,
  TerminalRuntimeCreateSessionOptions,
  TerminalRuntimePaneInfo,
  TerminalRuntimeProcess,
  TerminalRuntimeSession,
  TerminalRuntimeSessionOptions,
} from "./terminal-runtime";

export class TmuxTerminalRuntime implements TerminalRuntime {
  readonly kind = "tmux" as const;

  availability(): TerminalRuntimeAvailability {
    const availability = detectTmux();
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
    return this.attachSessionWithTmux(tmux, options);
  }

  listPanes(): TerminalRuntimePaneInfo[] {
    const runner = this.runnerOrNull();
    if (!runner) {
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

  captureTail(options: TerminalRuntimeCaptureTailOptions): string {
    const runner = this.runnerOrNull();
    if (!runner) {
      return "";
    }
    return normalizeCapturedTmuxPane(runner.run([
      "capture-pane",
      "-p",
      "-e",
      "-t",
      options.paneId || options.sessionName,
      "-S",
      `-${options.lineLimit && options.lineLimit > 0 ? Math.min(options.lineLimit, options.historyLimit) : options.historyLimit}`,
    ]));
  }

  terminate(sessionName: string): void {
    const tmux = this.requireTmux();
    new TmuxCommandRunner(tmux.path).run(["kill-session", "-t", sessionName]);
  }

  private requireTmux(): TmuxAvailable {
    const availability = detectTmux();
    if (!availability.available) {
      throw new Error(availability.reason);
    }
    return availability;
  }

  private runnerOrNull(): TmuxCommandRunner | null {
    const availability = detectTmux();
    return availability.available ? new TmuxCommandRunner(availability.path) : null;
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

function normalizeCapturedTmuxPane(data: string): string {
  const trimmed = data.replace(/[ \t]+\r?\n/g, "\n").replace(/\s+$/g, "");
  return trimmed.length > 0 ? `${trimmed.replace(/\r?\n/g, "\r\n")}\r\n` : "";
}
