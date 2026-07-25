import type { IndexSearchResponse, IndexStatus, IndexSyncResult, WorkspaceModel } from "./types";

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

/** The successful `/status` body emitted by the desktop command server. */
export interface ExoCommandStatusResponse {
  workspace: WorkspaceModel;
  terminals: ExoCommandStatusTerminalInfo[];
}

/** Discovery facts added locally by the CLI after a successful `/status` response. */
export interface ExoCommandStatusControlPlane {
  runtimeRoot: string;
  serverJsonPath: string;
  pid: number;
  port: number;
  baseUrl: string;
}

export interface ExoCommandStatusWithControlPlane extends ExoCommandStatusResponse {
  controlPlane: ExoCommandStatusControlPlane;
}

/** The full terminal representation currently returned by `/status`. */
export interface ExoCommandStatusTerminalInfo extends ExoCommandTerminalInfo {
  command: string;
  kind: "shell";
  status: "running" | "exited";
  attachGeneration: number;
  health?: "healthy" | "idle" | "unhealthy" | "exited";
  healthDetail?: string;
  geometry?: {
    cols: number;
    rows: number;
    reportedAt: string;
    source: "renderer-fit" | "initial-default";
  };
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

export interface ExoCommandOkResponse {
  ok: true;
}

export type ExoCommandShowRequest = Record<string, never>;
export type ExoCommandIndexSyncRequest = Record<string, never>;

export interface ExoCommandSearchRequest {
  q: string;
  limit?: number;
  offset?: number;
  intent?: string;
  includeContent?: boolean;
  maxLinesPerResult?: number;
}

export type ExoCommandShowResponse = ExoCommandOkResponse;
export type ExoCommandOpenFileResponse = ExoCommandOkResponse;
export type ExoCommandSearchResponse = IndexSearchResponse;
export type ExoCommandIndexStatusResponse = IndexStatus;
export type ExoCommandIndexSyncResponse = IndexSyncResult;

export interface ExoOpenFileRequest {
  path: string;
}

export interface ExoSpawnAgentCommandRequest {
  handle: string;
  task: string;
}

export interface ExoSpawnAgentCommandResponse {
  ok: true;
  invocation: {
    id: string;
    status: string;
    handle: string;
    createdAt: string;
  };
  terminal: ExoCommandTerminalInfo;
}

/** The error envelope shared by routes that report only a human-readable failure. */
export interface ExoCommandBasicErrorResponse {
  error: string;
}

/** The structured failure envelope emitted only by `/agent-commands/spawn`. */
export interface ExoSpawnAgentCommandErrorResponse {
  ok: false;
  code: string;
  error: string;
  [key: string]: unknown;
}
