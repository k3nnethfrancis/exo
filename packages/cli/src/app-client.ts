import { readFile } from "node:fs/promises";
import path from "node:path";

import { EXO_COMMAND_ROUTES, type ExoCommandServerInfo } from "@exo/core";

const defaultRequestTimeoutMs = 2_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;

/**
 * HTTP client for communicating with the Exo desktop app's command server.
 * Discovers the server port from .exo/server.json.
 */
export class AppClient {
  private constructor(
    private baseUrl: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
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
    const maintenanceRequestTimeoutMs =
      parsePositiveInt(env.EXO_APP_CLIENT_MAINTENANCE_TIMEOUT_MS) ?? defaultMaintenanceRequestTimeoutMs;
    const client = new AppClient(baseUrl, requestTimeoutMs, maintenanceRequestTimeoutMs);

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

  async search(query: string): Promise<Record<string, unknown>> {
    return this.get(`${EXO_COMMAND_ROUTES.search}?q=${encodeURIComponent(query)}`);
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

  async createTerminal(kind: string, cwd?: string): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.terminals, { kind, cwd });
  }

  async readTerminal(id: string): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalBuffer(id));
    return String(result.buffer ?? "");
  }

  async readTerminalTranscript(id: string, tailChars = 200_000): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTranscript(id, tailChars));
    return String(result.transcript ?? "");
  }

  async writeTerminal(id: string, data: string): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.terminalWrite(id), { data });
  }

  async killTerminal(id: string): Promise<void> {
    await this.delete(EXO_COMMAND_ROUTES.terminal(id));
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async post(path: string, body: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async delete(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE", signal: AbortSignal.timeout(this.requestTimeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
