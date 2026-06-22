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
  projectRoots: "/project-roots",
  projectRoot: (target: string) => `/project-roots/${encodeURIComponent(target)}`,
  terminals: "/terminals",
  terminalDiagnostics: "/terminals/diagnostics",
  terminalTail: (id: string, lines?: number) => {
    const query = lines && lines > 0 ? `?lines=${encodeURIComponent(String(lines))}` : "";
    return `/terminals/${encodeURIComponent(id)}/tail${query}`;
  },
  terminalTranscript: (id: string, tailChars: number) =>
    `/terminals/${encodeURIComponent(id)}/transcript?tailChars=${encodeURIComponent(String(tailChars))}`,
  terminalWrite: (id: string) => `/terminals/${encodeURIComponent(id)}/write`,
  terminalMessage: (id: string) => `/terminals/${encodeURIComponent(id)}/message`,
  terminalReconnect: (id: string) => `/terminals/${encodeURIComponent(id)}/reconnect`,
  terminal: (id: string) => `/terminals/${encodeURIComponent(id)}`,
} as const;

export interface ExoCommandServerInfo {
  port: number;
  pid: number;
}

export interface ExoCommandTerminalInfo {
  id: string;
  title: string;
  cwd: string;
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

export interface ExoCommandTerminalDiagnostics extends ExoCommandTerminalInfo {
  runtime?: "tmux";
  tmuxSessionName?: string;
  bridgeStatus?: "attached" | "detached";
  paneStatus?: "alive" | "dead" | "missing" | "unknown";
  bufferedLines: number;
  bufferedChars: number;
  transcriptPath: string;
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
  kind?: string;
  cwd?: string;
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

export interface ExoReconnectTerminalResponse {
  ok: true;
  terminal: ExoCommandTerminalInfo | null;
}

export interface ExoIndexRootRequest {
  path?: string;
  name?: string;
  kind?: string;
  pattern?: string;
  ignore?: string[];
  force?: boolean;
}

export interface ExoProjectRootRequest {
  path?: string;
}

export interface ExoReadDocumentRequest {
  target?: string;
  fromLine?: number;
  maxLines?: number;
}
