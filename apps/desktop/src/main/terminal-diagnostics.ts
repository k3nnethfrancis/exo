import type { TerminalDiagnostics, TerminalKind, TerminalSessionInfo } from "../shared/api";

export interface TerminalDiagnosticRecord {
  info: TerminalSessionInfo;
  kind: TerminalKind;
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  health: TerminalDiagnostics["health"];
  healthDetail: string;
  runtime: "pty" | "tmux";
  sessionName?: string;
  paneId?: string | null;
  bridgeDetached?: boolean;
  cwd: string;
  title: string;
  command: string;
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath?: string;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
  now: number;
}

export function terminalDiagnosticsFromRecord(record: TerminalDiagnosticRecord): TerminalDiagnostics {
  return {
    id: record.info.id,
    terminalKind: record.info.terminalKind,
    harnessId: record.info.harnessId,
    kind: record.kind,
    status: record.status,
    exitCode: record.exitCode,
    health: record.health,
    healthDetail: record.healthDetail,
    runtime: record.runtime,
    tmuxSessionName: record.runtime === "tmux" ? record.sessionName : undefined,
    tmuxPaneId: record.runtime === "tmux" ? record.paneId ?? null : null,
    safeAttachCommand: record.runtime === "tmux" && record.sessionName ? safeTmuxAttachCommand(record.sessionName) : "",
    debugAttach: {
      tmuxSessionName: record.runtime === "tmux" ? record.sessionName ?? "" : "",
      tmuxPaneId: record.runtime === "tmux" ? record.paneId ?? null : null,
      safeAttachCommand: record.runtime === "tmux" && record.sessionName ? safeTmuxAttachCommand(record.sessionName) : "",
    },
    bridgeStatus: record.bridgeDetached ? "detached" : "attached",
    paneStatus: record.status === "exited" ? "dead" : "alive",
    geometry: {
      renderer: record.info.geometry ?? null,
      tmuxPane: null,
      tmuxClient: null,
      divergent: false,
      divergentSinceMs: null,
      attachGeneration: record.info.attachGeneration,
    },
    cwd: record.cwd,
    title: record.title,
    command: record.command,
    bufferedLines: record.bufferedLines,
    bufferedChars: record.bufferedChars,
    transcriptPath: record.transcriptPath,
    lastInputAt: record.lastInputAt ? new Date(record.lastInputAt).toISOString() : null,
    lastOutputAt: record.lastOutputAt ? new Date(record.lastOutputAt).toISOString() : null,
    lastWriteId: record.lastWriteId,
    lastWriteLatencyMs: record.lastWriteLatencyMs ?? null,
  };
}

export function safeTmuxAttachCommand(tmuxSessionName: string, tmuxServerName = process.env.EXO_TMUX_SERVER_NAME): string {
  const serverArgs = tmuxServerName ? ` -L ${shellQuote(tmuxServerName)}` : "";
  return `tmux${serverArgs} attach-session -t ${shellQuote(tmuxSessionName)}`;
}

export function terminalDebugAttachInfo(tmuxSessionName: string, tmuxPaneId?: string | null) {
  return {
    tmuxSessionName,
    tmuxPaneId: tmuxPaneId || null,
    safeAttachCommand: safeTmuxAttachCommand(tmuxSessionName),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
