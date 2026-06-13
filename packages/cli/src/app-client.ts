import { readFile } from "node:fs/promises";
import path from "node:path";

import { EXO_COMMAND_ROUTES, type ExoCommandServerInfo } from "@exo/core";

export interface AppClientWriteResult {
  ok: true;
  delivery: "sent" | "queued" | "not-found";
  queuedInputCount?: number;
  readiness?: "ready" | "starting" | "blocked";
  readinessDetail?: string;
}

const defaultRequestTimeoutMs = 2_000;
const defaultSearchRequestTimeoutMs = 30_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;

/**
 * HTTP client for communicating with the Exo desktop app's command server.
 * Discovers the server port from .exo/server.json.
 */
export class AppClient {
  private constructor(
    private baseUrl: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
    private readonly searchRequestTimeoutMs = defaultSearchRequestTimeoutMs,
    private readonly maintenanceRequestTimeoutMs = defaultMaintenanceRequestTimeoutMs,
  ) {}

  /**
   * Attempt to connect to a running Exo desktop app.
   * Returns null if the app isn't running or server.json doesn't exist.
   */
  static async connect(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AppClient | null> {
    const serverJsonPath = path.join(runtimeRoot, "server.json");
    let info: ExoCommandServerInfo;

    try {
      const raw = await readFile(serverJsonPath, "utf-8");
      info = JSON.parse(raw);
    } catch {
      return null;
    }

    const baseUrl = `http://127.0.0.1:${info.port}`;
    const requestTimeoutMs = parsePositiveInt(env.EXO_APP_CLIENT_REQUEST_TIMEOUT_MS) ?? defaultRequestTimeoutMs;
    const searchRequestTimeoutMs = parsePositiveInt(env.EXO_APP_CLIENT_SEARCH_TIMEOUT_MS) ?? defaultSearchRequestTimeoutMs;
    const maintenanceRequestTimeoutMs =
      parsePositiveInt(env.EXO_APP_CLIENT_MAINTENANCE_TIMEOUT_MS) ?? defaultMaintenanceRequestTimeoutMs;
    const client = new AppClient(baseUrl, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);

    // Health check
    try {
      await client.getStatus();
      return client;
    } catch {
      return null;
    }
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.status);
  }

  async openFile(filePath: string): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.open, { path: filePath });
  }

  async showWindow(): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.show, {});
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.config);
  }

  async listProjectRoots(): Promise<string[]> {
    const result = await this.get(EXO_COMMAND_ROUTES.projectRoots);
    return Array.isArray(result.projectRoots) ? result.projectRoots.map(String) : [];
  }

  async addProjectRoot(projectRootPath: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.projectRoots, { path: projectRootPath });
  }

  async removeProjectRoot(target: string): Promise<Record<string, unknown>> {
    return this.delete(EXO_COMMAND_ROUTES.projectRoot(target));
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

  async updateIndex(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.indexUpdate, {}, this.maintenanceRequestTimeoutMs);
  }

  async embedIndex(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.indexEmbed, {}, this.maintenanceRequestTimeoutMs);
  }

  async listTerminals(): Promise<unknown[]> {
    return this.get(EXO_COMMAND_ROUTES.terminals);
  }

  async terminalDiagnostics(): Promise<unknown[]> {
    return this.get(EXO_COMMAND_ROUTES.terminalDiagnostics);
  }

  async createTerminal(kind: string, cwd?: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.terminals, { kind, cwd });
  }

  async readTerminal(id: string): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTail(id));
    return String(result.tail ?? "");
  }

  async readTerminalTranscript(id: string, tailChars = 0): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTranscript(id, tailChars));
    return String(result.transcript ?? "");
  }

  async writeTerminal(id: string, data: string): Promise<AppClientWriteResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalWrite(id), { data });
  }

  async sendTerminalMessage(id: string, message: string, submit = true): Promise<AppClientWriteResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalMessage(id), { message, submit });
  }

  async reconnectTerminal(id: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.terminalReconnect(id), {});
  }

  async killTerminal(id: string): Promise<void> {
    await this.delete(EXO_COMMAND_ROUTES.terminal(id));
  }

  private async get(path: string, timeoutMs = this.requestTimeoutMs): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
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
        headers: { "Content-Type": "application/json" },
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
      const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE", signal: AbortSignal.timeout(this.requestTimeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "DELETE", path, this.requestTimeoutMs);
    }
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
