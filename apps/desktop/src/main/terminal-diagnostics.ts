import type { TerminalDiagnostics, TerminalKind, TerminalSessionInfo } from "../shared/api";

export interface TerminalDiagnosticRecord {
  info: TerminalSessionInfo;
  kind: TerminalKind;
  status: TerminalSessionInfo["status"];
  exitCode?: number;
  health: TerminalDiagnostics["health"];
  healthDetail: string;
  runtime: "pty";
  bridgeDetached?: boolean;
  cwd: string;
  title: string;
  command: string;
  bufferedLines: number;
  bufferedChars: number;
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
    tmuxSessionName: undefined,
    tmuxPaneId: null,
    safeAttachCommand: "",
    debugAttach: {
      tmuxSessionName: "",
      tmuxPaneId: null,
      safeAttachCommand: "",
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
    transcriptPath: undefined,
    lastInputAt: record.lastInputAt ? new Date(record.lastInputAt).toISOString() : null,
    lastOutputAt: record.lastOutputAt ? new Date(record.lastOutputAt).toISOString() : null,
    lastWriteId: record.lastWriteId,
    lastWriteLatencyMs: record.lastWriteLatencyMs ?? null,
  };
}
