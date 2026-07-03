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
  tmuxPaneGeometry?: { width: number; height: number };
  tmuxClientGeometry?: { width: number; height: number };
  geometryDivergentSince?: number;
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
  now: number;
}

export function terminalDiagnosticsFromRecord(record: TerminalDiagnosticRecord): TerminalDiagnostics {
  const debugAttach = terminalDebugAttachInfo(record.tmuxSessionName, record.tmuxPaneId);
  return {
    id: record.info.id,
    terminalKind: record.info.terminalKind,
    harnessId: record.info.harnessId,
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
    geometry: terminalDiagnosticsGeometry(record),
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

function terminalDiagnosticsGeometry(record: TerminalDiagnosticRecord): TerminalDiagnostics["geometry"] {
  const renderer = record.info.geometry ?? null;
  const tmuxPane = record.tmuxPaneGeometry ?? null;
  const tmuxClient = record.tmuxClientGeometry ?? null;
  const divergent =
    renderer !== null &&
    ((tmuxPane !== null && (renderer.cols !== tmuxPane.width || renderer.rows !== tmuxPane.height)) ||
      (tmuxClient !== null && (renderer.cols !== tmuxClient.width || renderer.rows !== tmuxClient.height)));
  return {
    renderer,
    tmuxPane,
    tmuxClient,
    divergent,
    divergentSinceMs: divergent && record.geometryDivergentSince ? Math.max(0, record.now - record.geometryDivergentSince) : null,
    attachGeneration: record.info.attachGeneration,
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
