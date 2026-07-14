import type { InvocationRecord } from "./agent-invocation";

export const EXO_COMMAND_ROUTES = {
  status: "/status",
  show: "/show",
  search: "/search",
  indexStatus: "/index/status",
  indexSync: "/index/sync",
  open: "/open",
  spawnAgentCommand: "/agent-commands/spawn",
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
