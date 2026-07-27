import type { IndexSearchResponse, IndexStatus, IndexSyncResult, WorkspaceModel } from "./types";

export const STEM_COMMAND_ROUTES = {
  status: "/status",
  show: "/show",
  search: "/search",
  indexStatus: "/index/status",
  indexSync: "/index/sync",
  open: "/open",
  spawnAgentCommand: "/agent-commands/spawn",
} as const;

export const STEM_COMMAND_TOKEN_HEADER = "x-stem-command-token";

export interface StemCommandServerInfo {
  port: number;
  pid: number;
  token: string;
}

/** The successful `/status` body emitted by the desktop command server. */
export interface StemCommandStatusResponse {
  workspace: WorkspaceModel;
  terminals: StemCommandStatusTerminalInfo[];
}

/** Discovery facts added locally by the CLI after a successful `/status` response. */
export interface StemCommandStatusControlPlane {
  runtimeRoot: string;
  serverJsonPath: string;
  pid: number;
  port: number;
  baseUrl: string;
}

export interface StemCommandStatusWithControlPlane extends StemCommandStatusResponse {
  controlPlane: StemCommandStatusControlPlane;
}

/** The full terminal representation currently returned by `/status`. */
export interface StemCommandStatusTerminalInfo extends StemCommandTerminalInfo {
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

export interface StemCommandTerminalInfo {
  id: string;
  title: string;
  cwd: string;
  kind: string;
  command?: string;
  status: string;
  exitCode?: number;
}

export interface StemCommandOkResponse {
  ok: true;
}

export type StemCommandShowRequest = Record<string, never>;
export type StemCommandIndexSyncRequest = Record<string, never>;

export interface StemCommandSearchRequest {
  q: string;
  limit?: number;
  offset?: number;
  intent?: string;
  includeContent?: boolean;
  maxLinesPerResult?: number;
}

export type StemCommandSearchResponse = IndexSearchResponse;
export type StemCommandIndexStatusResponse = IndexStatus;
export type StemCommandIndexSyncResponse = IndexSyncResult;

export interface StemOpenFileRequest {
  path: string;
}

export interface StemSpawnAgentCommandRequest {
  handle: string;
  task: string;
}

export interface StemSpawnAgentCommandResponse {
  ok: true;
  invocation: {
    id: string;
    status: string;
    handle: string;
    createdAt: string;
  };
  terminal: StemCommandTerminalInfo;
}

/** The error envelope shared by routes that report only a human-readable failure. */
export interface StemCommandBasicErrorResponse {
  error: string;
}

/** The structured failure envelope emitted only by `/agent-commands/spawn`. */
export interface StemSpawnAgentCommandErrorResponse {
  ok: false;
  code: string;
  error: string;
  [key: string]: unknown;
}
