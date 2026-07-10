import type { CapabilitySurface } from "./capabilities";
import type { InvocationRecord } from "./agent-invocation";

export const EXO_COMMAND_ROUTES = {
  status: "/status",
  show: "/show",
  search: "/search",
  read: "/read",
  indexStatus: "/index/status",
  indexRoots: "/index/roots",
  indexSync: "/index/sync",
  indexUpdate: "/index/update",
  indexEmbed: "/index/embed",
  open: "/open",
  openPreview: "/preview/open",
  focusPreview: "/preview/focus",
  closePreview: "/preview/close",
  config: "/config",
  spawnAgentCommand: "/agent-commands/spawn",
  terminals: "/terminals",
  terminalDiagnostics: "/terminals/diagnostics",
  terminalTail: (id: string, lines?: number) => {
    const query = lines && lines > 0 ? `?lines=${encodeURIComponent(String(lines))}` : "";
    return `/terminals/${encodeURIComponent(id)}/tail${query}`;
  },
  terminalTranscript: (id: string, tailChars: number) =>
    `/terminals/${encodeURIComponent(id)}/transcript?tailChars=${encodeURIComponent(String(tailChars))}`,
  terminalSemanticAnswer: (id: string, limit?: number) => {
    const query = limit && limit > 0 ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return `/terminals/${encodeURIComponent(id)}/semantic-answer${query}`;
  },
  terminalWrite: (id: string) => `/terminals/${encodeURIComponent(id)}/write`,
  terminalMessage: (id: string) => `/terminals/${encodeURIComponent(id)}/message`,
  terminal: (id: string) => `/terminals/${encodeURIComponent(id)}`,
} as const;

export const EXO_COMMAND_TOKEN_HEADER = "x-exo-command-token";

export interface ExoCommandServerInfo {
  port: number;
  pid: number;
  token: string;
}

export interface ExoCommandTerminalInfo {
  id: string;
  title: string;
  cwd: string;
  terminalKind?: "shell" | "agent";
  harnessId?: string | null;
  kind: string;
  command?: string;
  status: string;
  exitCode?: number;
  readiness?: "ready" | "starting" | "blocked";
  readinessDetail?: string;
  queuedInputCount?: number;
  health?: "healthy" | "idle" | "unhealthy" | "exited";
  healthDetail?: string;
}

export interface ExoCommandTerminalDebugAttachInfo {
  tmuxSessionName: string;
  tmuxPaneId: string | null;
  safeAttachCommand: string;
}

export interface ExoCommandTerminalGeometryRecord {
  cols: number;
  rows: number;
  reportedAt: string;
  source: "renderer-fit" | "initial-default";
}

export interface ExoCommandTerminalDiagnosticsGeometry {
  renderer: ExoCommandTerminalGeometryRecord | null;
  tmuxPane: { width: number; height: number } | null;
  tmuxClient: { width: number; height: number } | null;
  divergent: boolean;
  divergentSinceMs: number | null;
  attachGeneration: number;
}

export interface ExoCommandTerminalDiagnostics extends ExoCommandTerminalInfo {
  runtime?: "pty" | "tmux";
  tmuxSessionName?: string;
  tmuxPaneId?: string | null;
  safeAttachCommand?: string;
  debugAttach?: ExoCommandTerminalDebugAttachInfo;
  bridgeStatus?: "attached" | "detached";
  paneStatus?: "alive" | "dead" | "missing" | "unknown";
  geometry?: ExoCommandTerminalDiagnosticsGeometry;
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath?: string;
  lastInputAt: string | null;
  lastOutputAt: string | null;
  lastWriteId: number;
  lastWriteLatencyMs: number | null;
}

export interface ExoOpenFileRequest {
  path?: string;
}

export interface ExoOpenPreviewRequest {
  target?: string;
}

export interface ExoOpenPreviewResponse {
  ok: true;
  url: string;
  source: "url" | "file";
}

export interface ExoPreviewCommandResponse {
  ok: true;
}

export interface ExoCreateTerminalRequest {
  // Legacy compatibility for older app/CLI clients. New terminal launch requests should use kind: "shell".
  harnessId?: string;
  kind?: string;
  cwd?: string;
  callerSurface?: CapabilitySurface;
}

export interface ExoSpawnAgentCommandRequest {
  handle?: string;
  task?: string;
}

export interface ExoSpawnAgentCommandResponse {
  ok: true;
  invocation: InvocationRecord;
  terminal: ExoCommandTerminalInfo;
}

export interface ExoCommandErrorResponse {
  ok: false;
  code: string;
  error: string;
  [key: string]: unknown;
}

export interface ExoWriteTerminalRequest {
  data?: string;
}

export interface ExoSendTerminalMessageRequest {
  message?: string;
  submit?: boolean;
}

export interface ExoWriteTerminalResponse {
  ok: boolean;
  delivery: "sent" | "queued" | "not-found";
  writeId?: number;
  queuedInputCount?: number;
  readiness?: ExoCommandTerminalInfo["readiness"];
  readinessDetail?: string;
}

export interface ExoIndexRootRequest {
  path?: string;
  name?: string;
  kind?: string;
  pattern?: string;
  ignore?: string[];
  force?: boolean;
}

export interface ExoReadDocumentRequest {
  target?: string;
  fromLine?: number;
  maxLines?: number;
}
