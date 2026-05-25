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
  config: "/config",
  projectRoots: "/project-roots",
  projectRoot: (target: string) => `/project-roots/${encodeURIComponent(target)}`,
  terminals: "/terminals",
  terminalBuffer: (id: string) => `/terminals/${encodeURIComponent(id)}/buffer`,
  terminalTranscript: (id: string, tailChars: number) =>
    `/terminals/${encodeURIComponent(id)}/transcript?tailChars=${encodeURIComponent(String(tailChars))}`,
  terminalWrite: (id: string) => `/terminals/${encodeURIComponent(id)}/write`,
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
}

export interface ExoOpenFileRequest {
  path?: string;
}

export interface ExoCreateTerminalRequest {
  kind?: string;
  cwd?: string;
}

export interface ExoWriteTerminalRequest {
  data?: string;
}

export interface ExoWriteTerminalResponse {
  ok: true;
  delivery: "sent" | "queued" | "not-found";
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

export interface ExoProjectRootRequest {
  path?: string;
}

export interface ExoReadDocumentRequest {
  target?: string;
  fromLine?: number;
  maxLines?: number;
}
