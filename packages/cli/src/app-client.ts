import { readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { EXO_COMMAND_ROUTES, EXO_COMMAND_TOKEN_HEADER, type ExoCommandServerInfo } from "@exo/core";

export interface AppClientWriteResult {
  ok: boolean;
  delivery: "sent" | "queued" | "not-found";
}

const defaultRequestTimeoutMs = 2_000;
const defaultSearchRequestTimeoutMs = 30_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;
const defaultTerminalCreateTimeoutMs = 60_000;

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

export type AppClientConnectResult =
  | { ok: true; client: AppClient; discovery: AppClientDiscoveryMetadata }
  | { ok: false; failure: AppClientDiscoveryFailure };

/**
 * HTTP client for communicating with the Exo desktop app's command server.
 * Discovers the server port from .exo/server.json.
 */
export class AppClient {
  private constructor(
    private baseUrl: string,
    private readonly discovery: AppClientDiscoveryMetadata,
    private readonly token: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
    private readonly searchRequestTimeoutMs = defaultSearchRequestTimeoutMs,
    private readonly maintenanceRequestTimeoutMs = defaultMaintenanceRequestTimeoutMs,
    private readonly terminalCreateTimeoutMs = defaultTerminalCreateTimeoutMs,
  ) {}

  /**
   * Attempt to connect to a running Exo desktop app.
   * Returns null if the app isn't running or server.json doesn't exist.
   */
  static async connect(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AppClient | null> {
    const result = await AppClient.connectDetailed(runtimeRoot, env);
    return result.ok ? result.client : null;
  }

  static async connectDetailed(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AppClientConnectResult> {
    const serverJsonPath = path.join(runtimeRoot, "server.json");
    let info: ExoCommandServerInfo;

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
    const requestTimeoutMs = parsePositiveInt(env.EXO_APP_CLIENT_REQUEST_TIMEOUT_MS) ?? defaultRequestTimeoutMs;
    const searchRequestTimeoutMs = parsePositiveInt(env.EXO_APP_CLIENT_SEARCH_TIMEOUT_MS) ?? defaultSearchRequestTimeoutMs;
    const maintenanceRequestTimeoutMs =
      parsePositiveInt(env.EXO_APP_CLIENT_MAINTENANCE_TIMEOUT_MS) ?? defaultMaintenanceRequestTimeoutMs;
    const terminalCreateTimeoutMs =
      parsePositiveInt(env.EXO_APP_CLIENT_TERMINAL_CREATE_TIMEOUT_MS) ?? defaultTerminalCreateTimeoutMs;
    const discovery = { runtimeRoot, serverJsonPath, port: info.port, pid: info.pid };
    const client = new AppClient(baseUrl, discovery, info.token, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs, terminalCreateTimeoutMs);

    const initialProcessCheck = checkProcessLiveness(info.pid);
    if (initialProcessCheck.status === "dead") {
      await quarantineStaleDiscoveryFile(serverJsonPath);
      return discoveryFailure("server-stale", runtimeRoot, serverJsonPath, undefined, info, initialProcessCheck);
    }

    // Health check
    try {
      await client.getStatus();
      return { ok: true, client, discovery };
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

  async getStatus(): Promise<Record<string, unknown>> {
    const status = await this.get(EXO_COMMAND_ROUTES.status);
    return {
      ...status,
      controlPlane: {
        ...(isRecord(status.controlPlane) ? status.controlPlane : {}),
        runtimeRoot: this.discovery.runtimeRoot,
        serverJsonPath: this.discovery.serverJsonPath,
        pid: this.discovery.pid,
        port: this.discovery.port,
        baseUrl: this.baseUrl,
      },
    };
  }

  async openFile(filePath: string): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.open, { path: filePath });
  }

  async openPreview(target: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.openPreview, { target });
  }

  async focusPreview(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.focusPreview, {});
  }

  async closePreview(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.closePreview, {});
  }

  async showWindow(): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.show, {});
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.config);
  }

  async search(query: string, options: { limit?: number } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ q: query });
    if (options.limit) params.set("limit", String(options.limit));
    return this.get(`${EXO_COMMAND_ROUTES.search}?${params.toString()}`, this.searchRequestTimeoutMs);
  }

  async readDocument(target: string, options: { fromLine?: number; maxLines?: number } = {}): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.read, { target, ...options });
  }

  async getIndexStatus(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.indexStatus);
  }

  async syncIndex(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.indexSync, {}, this.maintenanceRequestTimeoutMs);
  }

  async addIndexRoot(input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.indexRoots, input);
  }

  async removeIndexRoot(target: string): Promise<Record<string, unknown>> {
    return this.delete(`${EXO_COMMAND_ROUTES.indexRoots}/${encodeURIComponent(target)}`);
  }

  async listTerminals(): Promise<unknown[]> {
    return this.get(EXO_COMMAND_ROUTES.terminals);
  }

  async createTerminal(cwd?: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.terminals, { kind: "shell", cwd }, this.terminalCreateTimeoutMs);
  }

  async spawnAgentCommand(handle: string, task: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.spawnAgentCommand, { handle, task }, this.terminalCreateTimeoutMs);
  }

  async readTerminal(id: string, options: { maxLines?: number } = {}): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTail(id, options.maxLines));
    return String(result.tail ?? "");
  }


  async writeTerminal(id: string, data: string): Promise<AppClientWriteResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalWrite(id), { data });
  }

  async sendTerminalMessage(id: string, message: string, submit = true): Promise<AppClientWriteResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalMessage(id), { message, submit });
  }

  async killTerminal(id: string): Promise<void> {
    await this.delete(EXO_COMMAND_ROUTES.terminal(id));
  }

  private async get(path: string, timeoutMs = this.requestTimeoutMs): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "GET", path, timeoutMs);
    }
  }

  private async post(path: string, body: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "POST", path, timeoutMs);
    }
  }

  private async delete(path: string): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "DELETE",
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "DELETE", path, this.requestTimeoutMs);
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      [EXO_COMMAND_TOKEN_HEADER]: this.token,
    };
  }
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
    return new Error(`Exo command server ${method} ${targetPath} timed out after ${timeoutMs}ms.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isValidServerInfo(value: unknown): value is ExoCommandServerInfo {
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
  info?: Partial<ExoCommandServerInfo>,
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
      message: discoveryFailureMessage(code, runtimeRoot, serverJsonPath, info),
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
  runtimeRoot: string,
  serverJsonPath: string,
  info?: Partial<ExoCommandServerInfo>,
): string {
  switch (code) {
    case "runtime-root-missing":
      return `Exo runtime root is missing or is not a directory. Start Exo with \`exo start\`, run \`exo runtime status\` to confirm the active workspace, or set EXO_RUNTIME_ROOT.`;
    case "server-json-missing":
      return `Exo command server discovery file is missing. Start Exo with \`exo start\`, or set EXO_RUNTIME_ROOT to the runtime containing server.json.`;
    case "server-json-invalid":
      return `Exo command server discovery file is invalid. Remove or regenerate ${serverJsonPath} by restarting Exo.`;
    case "server-stale":
      return `Exo command server discovery is stale. The recorded process${info?.pid ? ` (${info.pid})` : ""} is no longer running; restart Exo with \`exo start\`.`;
    case "server-unreachable":
      return `Exo command server is unreachable${info?.port ? ` at http://127.0.0.1:${info.port}` : ""}. Restart Exo with \`exo start\` or check that EXO_RUNTIME_ROOT points at the active runtime.`;
    case "server-liveness-unknown":
      return `Exo command server is unreachable${info?.port ? ` at http://127.0.0.1:${info.port}` : ""}, and Exo could not verify whether the recorded process${info?.pid ? ` (${info.pid})` : ""} is alive. The discovery file was preserved because the process check was blocked or inconclusive.`;
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
