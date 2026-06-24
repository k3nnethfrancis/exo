import type { TerminalDiagnostics, TerminalKind, TerminalSessionInfo } from "../shared/api";

export interface TerminalDiagnosticRecord {
  info: TerminalSessionInfo;
  kind: TerminalKind;
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  health: TerminalDiagnostics["health"];
  healthDetail: string;
  tmuxSessionName: string;
  tmuxPaneId?: string | null;
  bridgeDetached?: boolean;
  paneStatus?: TerminalDiagnostics["paneStatus"];
  cwd: string;
  title: string;
  command: string;
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath: string;
  lastInputAt?: number;
  lastOutputAt?: number;
  lastWriteId: number;
  lastWriteLatencyMs?: number;
}

export function terminalDiagnosticsFromRecord(record: TerminalDiagnosticRecord): TerminalDiagnostics {
  const debugAttach = terminalDebugAttachInfo(record.tmuxSessionName, record.tmuxPaneId);
  return {
    id: record.info.id,
    kind: record.kind,
    status: record.status,
    exitCode: record.exitCode,
    health: record.health,
    healthDetail: record.healthDetail,
    runtime: "tmux",
    tmuxSessionName: record.tmuxSessionName,
    tmuxPaneId: debugAttach.tmuxPaneId,
    safeAttachCommand: debugAttach.safeAttachCommand,
    debugAttach,
    bridgeStatus: record.bridgeDetached ? "detached" : "attached",
    paneStatus: record.paneStatus ?? "unknown",
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

export function terminalDebugAttachInfo(tmuxSessionName: string, tmuxPaneId?: string | null) {
  return {
    tmuxSessionName,
    tmuxPaneId: tmuxPaneId || null,
    safeAttachCommand: safeTmuxAttachCommand(tmuxSessionName),
  };
}

export function safeTmuxAttachCommand(tmuxSessionName: string): string {
  return `tmux attach-session -t ${shellQuote(tmuxSessionName)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
