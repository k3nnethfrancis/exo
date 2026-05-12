import { readFile } from "node:fs/promises";
import path from "node:path";

import { EXO_COMMAND_ROUTES, type ExoCommandServerInfo } from "@exo/core";

/**
 * HTTP client for communicating with the Exo desktop app's command server.
 * Discovers the server port from .exo/server.json.
 */
export class AppClient {
  private constructor(private baseUrl: string) {}

  /**
   * Attempt to connect to a running Exo desktop app.
   * Returns null if the app isn't running or server.json doesn't exist.
   */
  static async connect(runtimeRoot: string): Promise<AppClient | null> {
    const serverJsonPath = path.join(runtimeRoot, "server.json");
    let info: ExoCommandServerInfo;

    try {
      const raw = await readFile(serverJsonPath, "utf-8");
      info = JSON.parse(raw);
    } catch {
      return null;
    }

    const baseUrl = `http://127.0.0.1:${info.port}`;
    const client = new AppClient(baseUrl);

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
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async delete(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
