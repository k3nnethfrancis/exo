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
  terminalTail: (id: string, lines?: number) => {
    const query = lines && lines > 0 ? `?lines=${encodeURIComponent(String(lines))}` : "";
    return `/terminals/${encodeURIComponent(id)}/tail${query}`;
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
  kind: string;
  command?: string;
  status: string;
  exitCode?: number;
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
  kind?: "shell";
  cwd?: string;
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
