import type { TerminalHealthState, TerminalSessionInfo } from "../shared/api";

export interface TerminalHealthRuntimeOptions {
  unresponsiveThresholdMs: number;
  idleThresholdMs: number;
}

export interface TerminalHealthInput {
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  paneStatus?: "alive" | "dead" | "missing" | "unknown";
  bridgeDetached?: boolean;
  lastInputAt?: number;
  lastOutputAt?: number;
}

export function terminalHealth(record: TerminalHealthInput, options: TerminalHealthRuntimeOptions, now = Date.now()): TerminalHealthState {
  if (record.status === "exited") {
    return "exited";
  }
  if (record.paneStatus === "missing" || record.paneStatus === "dead" || record.bridgeDetached) {
    return "unhealthy";
  }
  if (record.lastInputAt && (!record.lastOutputAt || record.lastOutputAt < record.lastInputAt) && now - record.lastInputAt > options.unresponsiveThresholdMs) {
    return "unhealthy";
  }
  if (!record.lastOutputAt || now - record.lastOutputAt > options.idleThresholdMs) {
    return "idle";
  }
  return "healthy";
}

export function terminalHealthDetail(record: TerminalHealthInput, options: TerminalHealthRuntimeOptions, now = Date.now()): string {
  const health = terminalHealth(record, options, now);
  if (health === "exited") {
    return record.exitCode === undefined ? "Process exited." : `Process exited with code ${record.exitCode}.`;
  }
  if (record.paneStatus === "missing") {
    return "Tmux session is missing; transcript remains available.";
  }
  if (record.paneStatus === "dead") {
    return "Tmux pane is dead; restart or open transcript.";
  }
  if (record.bridgeDetached) {
    return "Tmux session is alive but Exo's attach bridge is detached; reconnect the terminal.";
  }
  if (health === "unhealthy") {
    return `Input was sent but no terminal output has been observed for more than ${formatDuration(options.unresponsiveThresholdMs)}.`;
  }
  if (health === "idle") {
    return "No recent terminal output; terminal may simply be waiting for input.";
  }
  return "Recent terminal input/output observed.";
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${Math.round(durationMs / 1000)} seconds`;
}
