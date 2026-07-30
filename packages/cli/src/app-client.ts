import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  STEM_COMMAND_ROUTES,
  STEM_COMMAND_TOKEN_HEADER,
  type StemCommandIndexStatusResponse,
  type StemCommandIndexSyncResponse,
  type StemCommandIndexSyncRequest,
  type StemCommandOkResponse,
  type StemCommandSearchRequest,
  type StemCommandSearchResponse,
  type StemCommandServerInfo,
  type StemCommandStatusResponse,
  type StemCommandStatusTerminalInfo,
  type StemCommandStatusWithControlPlane,
  type StemCommandTerminalInfo,
  type StemCommandShowRequest,
  type StemOpenFileRequest,
  type StemSpawnAgentCommandRequest,
  type StemSpawnAgentCommandResponse,
  type IndexedRoot,
  type IndexSearchResponse,
  type IndexStatus,
  type IndexSyncResult,
  type WorkspaceModel,
} from "@stem/core";

const defaultRequestTimeoutMs = 2_000;
const defaultSearchRequestTimeoutMs = 30_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;

export type AppClientDiscoveryFailureCode =
  | "runtime-root-missing"
  | "server-json-missing"
  | "server-json-invalid"
  | "server-stale"
  | "server-unreachable"
  | "server-liveness-unknown";

export interface AppClientDiscoveryMetadata {
  runtimeRoot: string;
  serverJsonPath: string;
  port?: number;
  pid?: number;
}

export interface AppClientDiscoveryFailure extends AppClientDiscoveryMetadata {
  code: AppClientDiscoveryFailureCode;
  message: string;
  causeMessage?: string;
  processCheck?: AppClientProcessCheckDiagnostic;
}

export interface AppClientProcessCheckDiagnostic {
  status: "alive" | "dead" | "blocked" | "unknown";
  code?: string;
  message?: string;
}

type ConnectedAppClientDiscovery = AppClientDiscoveryMetadata & { port: number; pid: number };

export type AppClientConnectResult =
  | {
    ok: true;
    client: AppClient;
    discovery: AppClientDiscoveryMetadata;
    status: StemCommandStatusWithControlPlane;
  }
  | { ok: false; failure: AppClientDiscoveryFailure };

/**
 * HTTP client for communicating with the Stem desktop app's command server.
 * Discovers the server port from .exograph/server.json.
 */
export class AppClient {
  private constructor(
    private baseUrl: string,
    private readonly discovery: ConnectedAppClientDiscovery,
    private readonly token: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
    private readonly searchRequestTimeoutMs = defaultSearchRequestTimeoutMs,
    private readonly maintenanceRequestTimeoutMs = defaultMaintenanceRequestTimeoutMs,
  ) {}

  /**
   * Attempt to connect to a running Stem desktop app.
   * Returns null if the app isn't running or server.json doesn't exist.
   */
  static async connect(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AppClient | null> {
    const result = await AppClient.connectDetailed(runtimeRoot, env);
    return result.ok ? result.client : null;
  }

  static async connectDetailed(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AppClientConnectResult> {
    const serverJsonPath = path.join(runtimeRoot, "server.json");
    let info: StemCommandServerInfo;

    try {
      const runtimeRootStat = await stat(runtimeRoot);
      if (!runtimeRootStat.isDirectory()) {
        return discoveryFailure("runtime-root-missing", runtimeRoot, serverJsonPath);
      }
    } catch (error) {
      return discoveryFailure("runtime-root-missing", runtimeRoot, serverJsonPath, error);
    }

    try {
      const raw = await readFile(serverJsonPath, "utf-8");
      info = JSON.parse(raw);
      if (!isValidServerInfo(info)) {
        return discoveryFailure("server-json-invalid", runtimeRoot, serverJsonPath);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return discoveryFailure("server-json-missing", runtimeRoot, serverJsonPath, error);
      }
      return discoveryFailure("server-json-invalid", runtimeRoot, serverJsonPath, error);
    }

    const baseUrl = `http://127.0.0.1:${info.port}`;
    const requestTimeoutMs = parsePositiveInt(env.STEM_APP_CLIENT_REQUEST_TIMEOUT_MS) ?? defaultRequestTimeoutMs;
    const searchRequestTimeoutMs = parsePositiveInt(env.STEM_APP_CLIENT_SEARCH_TIMEOUT_MS) ?? defaultSearchRequestTimeoutMs;
    const maintenanceRequestTimeoutMs =
      parsePositiveInt(env.STEM_APP_CLIENT_MAINTENANCE_TIMEOUT_MS) ?? defaultMaintenanceRequestTimeoutMs;
    const discovery: ConnectedAppClientDiscovery = { runtimeRoot, serverJsonPath, port: info.port, pid: info.pid };
    const client = new AppClient(baseUrl, discovery, info.token, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);

    const initialProcessCheck = checkProcessLiveness(info.pid);
    if (initialProcessCheck.status === "dead") {
      await quarantineStaleDiscoveryFile(serverJsonPath);
      return discoveryFailure("server-stale", runtimeRoot, serverJsonPath, undefined, info, initialProcessCheck);
    }

    // Health check
    try {
      const status = await client.getStatus();
      return { ok: true, client, discovery, status };
    } catch (error) {
      const postFetchProcessCheck = checkProcessLiveness(info.pid);
      if (postFetchProcessCheck.status === "dead") {
        await quarantineStaleDiscoveryFile(serverJsonPath);
        return discoveryFailure("server-stale", runtimeRoot, serverJsonPath, error, info, postFetchProcessCheck);
      }
      if (postFetchProcessCheck.status === "blocked" || postFetchProcessCheck.status === "unknown") {
        return discoveryFailure("server-liveness-unknown", runtimeRoot, serverJsonPath, error, info, postFetchProcessCheck);
      }
      return discoveryFailure("server-unreachable", runtimeRoot, serverJsonPath, error, info, postFetchProcessCheck);
    }
  }

  async getStatus(): Promise<StemCommandStatusWithControlPlane> {
    const status = await this.get(STEM_COMMAND_ROUTES.status, decodeStemCommandStatusResponse);
    return {
      ...status,
      controlPlane: {
        runtimeRoot: this.discovery.runtimeRoot,
        serverJsonPath: this.discovery.serverJsonPath,
        pid: this.discovery.pid,
        port: this.discovery.port,
        baseUrl: this.baseUrl,
      },
    };
  }

  async openFile(filePath: string): Promise<void> {
    const request: StemOpenFileRequest = { path: filePath };
    await this.post(STEM_COMMAND_ROUTES.open, request, decodeStemCommandOkResponse);
  }

  async showWindow(): Promise<void> {
    const request: StemCommandShowRequest = {};
    await this.post(STEM_COMMAND_ROUTES.show, request, decodeStemCommandOkResponse);
  }

  async search(query: string, options: { limit?: number; offset?: number } = {}): Promise<StemCommandSearchResponse> {
    const request: StemCommandSearchRequest = { q: query, ...options };
    const params = new URLSearchParams({ q: request.q });
    if (request.limit) params.set("limit", String(request.limit));
    if (request.offset) params.set("offset", String(request.offset));
    return this.get(`${STEM_COMMAND_ROUTES.search}?${params.toString()}`, decodeStemIndexSearchResponse, this.searchRequestTimeoutMs);
  }

  async getIndexStatus(): Promise<StemCommandIndexStatusResponse> {
    return this.get(STEM_COMMAND_ROUTES.indexStatus, decodeStemIndexStatusResponse);
  }

  async syncIndex(): Promise<StemCommandIndexSyncResponse> {
    const request: StemCommandIndexSyncRequest = {};
    return this.post(STEM_COMMAND_ROUTES.indexSync, request, decodeStemIndexSyncResponse, this.maintenanceRequestTimeoutMs);
  }

  async spawnAgentCommand(handle: string, task: string): Promise<StemSpawnAgentCommandResponse> {
    const request: StemSpawnAgentCommandRequest = { handle, task };
    return this.post(STEM_COMMAND_ROUTES.spawnAgentCommand, request, decodeStemSpawnAgentCommandResponse, this.maintenanceRequestTimeoutMs);
  }

  private async get<T>(path: string, decode: (value: unknown) => T, timeoutMs = this.requestTimeoutMs): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return decodeSuccessfulResponse(await res.text(), "GET", path, decode);
    } catch (error) {
      throw enhanceTimeoutError(error, "GET", path, timeoutMs);
    }
  }

  private async post<T>(path: string, body: object, decode: (value: unknown) => T, timeoutMs = this.requestTimeoutMs): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return decodeSuccessfulResponse(await res.text(), "POST", path, decode);
    } catch (error) {
      throw enhanceTimeoutError(error, "POST", path, timeoutMs);
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      [STEM_COMMAND_TOKEN_HEADER]: this.token,
    };
  }
}

function decodeStemCommandStatusResponse(value: unknown): StemCommandStatusResponse {
  if (!isStemCommandStatusResponse(value)) {
    throw protocolShapeError("a valid status response");
  }
  return value;
}

function decodeStemCommandOkResponse(value: unknown): StemCommandOkResponse {
  if (!isStemCommandOkResponse(value)) {
    throw protocolShapeError("an { ok: true } response");
  }
  return value;
}

function decodeStemIndexSearchResponse(value: unknown): IndexSearchResponse {
  if (!isIndexSearchResponse(value)) {
    throw protocolShapeError("a valid search response");
  }
  return value;
}

function decodeStemIndexStatusResponse(value: unknown): IndexStatus {
  if (!isIndexStatus(value)) {
    throw protocolShapeError("a valid index status response");
  }
  return value;
}

function decodeStemIndexSyncResponse(value: unknown): IndexSyncResult {
  if (!isIndexSyncResult(value)) {
    throw protocolShapeError("a valid index sync response");
  }
  return value;
}

function decodeStemSpawnAgentCommandResponse(value: unknown): StemSpawnAgentCommandResponse {
  if (!isStemSpawnAgentCommandResponse(value)) {
    throw protocolShapeError("a valid agent command spawn response");
  }
  return value;
}

function decodeSuccessfulResponse<T>(body: string, method: string, targetPath: string, decode: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw protocolError(method, targetPath, "successful response was not valid JSON");
  }
  try {
    return decode(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw protocolError(method, targetPath, detail.replace("Stem command-server protocol error: ", ""));
  }
}

function protocolShapeError(expected: string): Error {
  return new Error(`Stem command-server protocol error: expected ${expected}`);
}

function protocolError(method: string, targetPath: string, detail: string): Error {
  return new Error(`Stem command-server protocol error for ${method} ${targetPath}: ${detail}.`);
}

function isStemCommandStatusResponse(value: unknown): value is StemCommandStatusResponse {
  return isRecord(value) && isWorkspaceModel(value.workspace) && Array.isArray(value.terminals) && value.terminals.every(isCommandStatusTerminal);
}

function isStemCommandOkResponse(value: unknown): value is StemCommandOkResponse {
  return isRecord(value) && value.ok === true;
}

function isIndexSearchResponse(value: unknown): value is IndexSearchResponse {
  return isRecord(value) && typeof value.query === "string" && isIndexMode(value.mode) && isIndexBackend(value.source) && isStringArray(value.warnings) && Array.isArray(value.results) && value.results.every(isIndexSearchResult) && (value.hasMore === undefined || typeof value.hasMore === "boolean");
}

function isIndexSyncResult(value: unknown): value is IndexSyncResult {
  return isRecord(value) && isIndexStatus(value.status) && Array.isArray(value.phases) && value.phases.every(isIndexSyncPhase) && isStringArray(value.warnings);
}

function isStemSpawnAgentCommandResponse(value: unknown): value is StemSpawnAgentCommandResponse {
  return isRecord(value) && value.ok === true && isRecord(value.invocation) && typeof value.invocation.id === "string" && typeof value.invocation.status === "string" && typeof value.invocation.handle === "string" && typeof value.invocation.createdAt === "string" && isCommandTerminal(value.terminal);
}

function isWorkspaceModel(value: unknown): value is WorkspaceModel {
  return isRecord(value) && typeof value.workspaceRoot === "string" && typeof value.defaultTerminalCwd === "string" && Array.isArray(value.noteRoots) && value.noteRoots.every(isNoteRoot) && Array.isArray(value.indexedRoots) && value.indexedRoots.every(isIndexedRoot) && isIndexingConfig(value.indexing) && (value.searchEngine === undefined || isIndexBackend(value.searchEngine));
}

function isNoteRoot(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" && typeof value.path === "string";
}

function isIndexedRoot(value: unknown): value is IndexedRoot {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" && typeof value.path === "string" && isIndexedRootKind(value.kind) && typeof value.pattern === "string" && isStringArray(value.ignore) && isIndexBackend(value.backend);
}

function isIndexingConfig(value: unknown): boolean {
  return isRecord(value) && typeof value.enabled === "boolean" && isIndexMode(value.mode) && isIndexBackend(value.backend);
}

function isCommandStatusTerminal(value: unknown): value is StemCommandStatusTerminalInfo {
  return isRecord(value) && isCommandTerminal(value) && value.kind === "shell" && (value.status === "running" || value.status === "exited") && typeof value.command === "string" && typeof value.attachGeneration === "number" && (value.health === undefined || value.health === "healthy" || value.health === "idle" || value.health === "unhealthy" || value.health === "exited") && (value.healthDetail === undefined || typeof value.healthDetail === "string") && (value.geometry === undefined || isTerminalGeometry(value.geometry));
}

function isCommandTerminal(value: unknown): value is StemCommandTerminalInfo {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.cwd === "string" && typeof value.kind === "string" && typeof value.status === "string" && (value.command === undefined || typeof value.command === "string") && (value.exitCode === undefined || typeof value.exitCode === "number");
}

function isTerminalGeometry(value: unknown): boolean {
  return isRecord(value) && typeof value.cols === "number" && typeof value.rows === "number" && typeof value.reportedAt === "string" && (value.source === "renderer-fit" || value.source === "initial-default");
}

function isIndexStatus(value: unknown): value is IndexStatus {
  return isRecord(value) && typeof value.enabled === "boolean" && isIndexMode(value.mode) && isIndexBackend(value.backend) && typeof value.dbPath === "string" && typeof value.runtimePath === "string" && Array.isArray(value.indexedRoots) && value.indexedRoots.every(isIndexedRoot) && typeof value.documentCount === "number" && typeof value.pendingEmbeddings === "number" && typeof value.hasVectorIndex === "boolean" && (typeof value.lastUpdated === "string" || value.lastUpdated === null) && isStringArray(value.warnings) && isStringArray(value.errors) && (value.recentJobs === undefined || (Array.isArray(value.recentJobs) && value.recentJobs.every(isIndexJobMetric)));
}

function isIndexJobMetric(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && (value.kind === "sync" || value.kind === "update" || value.kind === "embed") && typeof value.reason === "string" && (value.status === "completed" || value.status === "failed") && typeof value.startedAt === "string" && typeof value.completedAt === "string" && typeof value.durationMs === "number" && (value.documentCount === undefined || typeof value.documentCount === "number") && (value.pendingEmbeddings === undefined || typeof value.pendingEmbeddings === "number") && (value.warnings === undefined || isStringArray(value.warnings)) && (value.error === undefined || typeof value.error === "string");
}

function isIndexSearchResult(value: unknown): boolean {
  return isRecord(value) && typeof value.filePath === "string" && typeof value.title === "string" && typeof value.snippet === "string" && typeof value.score === "number" && (value.docid === undefined || typeof value.docid === "string") && isIndexBackend(value.source) && (value.content === undefined || typeof value.content === "string");
}

function isIndexSyncPhase(value: unknown): boolean {
  return isRecord(value) && (value.name === "update" || value.name === "embed") && (value.status === "completed" || value.status === "skipped" || value.status === "failed") && typeof value.message === "string";
}

function isIndexMode(value: unknown): value is IndexSearchResponse["mode"] {
  return value === "off" || value === "lexical" || value === "semantic" || value === "hybrid";
}

function isIndexBackend(value: unknown): value is IndexSearchResponse["source"] {
  return value === "filesystem" || value === "qmd";
}

function isIndexedRootKind(value: unknown): boolean {
  return value === "notes" || value === "docs" || value === "code" || value === "mixed";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function enhanceTimeoutError(error: unknown, method: string, targetPath: string, timeoutMs: number): Error {
  if (isAbortError(error)) {
    return new Error(`Stem command server ${method} ${targetPath} timed out after ${timeoutMs}ms.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isValidServerInfo(value: unknown): value is StemCommandServerInfo {
  if (!isRecord(value)) {
    return false;
  }
  const port = value.port;
  const pid = value.pid;
  const token = value.token;
  return Number.isInteger(port) && Number(port) > 0 && Number.isInteger(pid) && Number(pid) > 0 && typeof token === "string" && token.length >= 32;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function discoveryFailure(
  code: AppClientDiscoveryFailureCode,
  runtimeRoot: string,
  serverJsonPath: string,
  cause?: unknown,
  info?: Partial<StemCommandServerInfo>,
  processCheck?: AppClientProcessCheckDiagnostic,
): AppClientConnectResult {
  const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
  return {
    ok: false,
    failure: {
      code,
      runtimeRoot,
      serverJsonPath,
      port: info?.port,
      pid: info?.pid,
      message: discoveryFailureMessage(code, serverJsonPath, info),
      causeMessage,
      processCheck,
    },
  };
}

export function formatAppClientDiscoveryFailure(failure: AppClientDiscoveryFailure): string {
  const lines = [
    failure.message,
    `Runtime root: ${failure.runtimeRoot}`,
    `Discovery file: ${failure.serverJsonPath}`,
  ];
  if (failure.pid) lines.push(`Recorded pid: ${failure.pid}`);
  if (failure.port) lines.push(`Recorded port: ${failure.port}`);
  if (failure.causeMessage) lines.push(`Cause: ${failure.causeMessage}`);
  if (failure.processCheck) {
    const parts = [`Process check: ${failure.processCheck.status}`];
    if (failure.processCheck.code) parts.push(`code=${failure.processCheck.code}`);
    if (failure.processCheck.message) parts.push(`message=${failure.processCheck.message}`);
    lines.push(parts.join("; "));
  }
  return `${lines.join("\n")}\n`;
}

function discoveryFailureMessage(
  code: AppClientDiscoveryFailureCode,
  serverJsonPath: string,
  info?: Partial<StemCommandServerInfo>,
): string {
  switch (code) {
    case "runtime-root-missing":
      return `Stem runtime root is missing or is not a directory. Start Stem with \`stem start\`, run \`stem status\` to confirm the active workspace, or set STEM_RUNTIME_ROOT.`;
    case "server-json-missing":
      return `Stem command server discovery file is missing. Start Stem with \`stem start\`, or set STEM_RUNTIME_ROOT to the runtime containing server.json.`;
    case "server-json-invalid":
      return `Stem command server discovery file is invalid. Remove or regenerate ${serverJsonPath} by restarting Stem.`;
    case "server-stale":
      return `Stem command server discovery is stale. The recorded process${info?.pid ? ` (${info.pid})` : ""} is no longer running; restart Stem with \`stem start\`.`;
    case "server-unreachable":
      return `Stem command server is unreachable${info?.port ? ` at http://127.0.0.1:${info.port}` : ""}. Restart Stem with \`stem start\` or check that STEM_RUNTIME_ROOT points at the active runtime.`;
    case "server-liveness-unknown":
      return `Stem command server is unreachable${info?.port ? ` at http://127.0.0.1:${info.port}` : ""}, and Stem could not verify whether the recorded process${info?.pid ? ` (${info.pid})` : ""} is alive. The discovery file was preserved because the process check was blocked or inconclusive. Run \`stem start\`, then retry; if Stem is already open, confirm STEM_RUNTIME_ROOT points to its active Workspace.`;
  }
}

function checkProcessLiveness(pid: number): AppClientProcessCheckDiagnostic {
  try {
    process.kill(pid, 0);
    return { status: "alive" };
  } catch (error) {
    if (isNodeError(error)) {
      const message = error.message || String(error);
      if (error.code === "ESRCH") {
        return { status: "dead", code: error.code, message };
      }
      if (error.code === "EPERM") {
        return { status: "blocked", code: error.code, message };
      }
      return { status: "unknown", code: error.code, message };
    }
    return { status: "unknown", message: error instanceof Error ? error.message : String(error) };
  }
}

async function quarantineStaleDiscoveryFile(serverJsonPath: string): Promise<void> {
  const stalePath = `${serverJsonPath}.stale-${Date.now()}`;
  try {
    await rename(serverJsonPath, stalePath);
  } catch {
    await rm(serverJsonPath, { force: true }).catch(() => {});
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
