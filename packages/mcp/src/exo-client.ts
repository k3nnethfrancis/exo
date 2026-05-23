import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXO_COMMAND_ROUTES, type ExoCommandServerInfo } from "@exo/core/command-protocol";
import { loadActiveWorkspaceSettings, workspaceEnvOverrides, workspaceSettingsToEnv } from "@exo/core/workspace-settings";

export interface ExoAgent {
  id: string;
  title: string;
  cwd: string;
  kind: string;
  command: string;
  status: string;
  exitCode?: number;
}

export type ExoAgentKind = "shell" | "claude" | "codex";

const defaultConnectTimeoutMs = 20_000;
const defaultRequestTimeoutMs = 2_000;
const defaultSearchRequestTimeoutMs = 30_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;
const pollIntervalMs = 250;

export class ExoCommandClient {
  constructor(
    readonly baseUrl: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
    private readonly searchRequestTimeoutMs = defaultSearchRequestTimeoutMs,
    private readonly maintenanceRequestTimeoutMs = defaultMaintenanceRequestTimeoutMs,
  ) {}

  static async connect(env: NodeJS.ProcessEnv = process.env): Promise<ExoCommandClient> {
    const runtimeRoot = await resolveMcpRuntimeRoot(env);
    const serverJsonPath = path.join(runtimeRoot, "server.json");
    const autostart = env.EXO_MCP_AUTOSTART === "1";
    const timeoutMs = parsePositiveInt(env.EXO_MCP_CONNECT_TIMEOUT_MS) ?? defaultConnectTimeoutMs;
    const requestTimeoutMs = parsePositiveInt(env.EXO_MCP_REQUEST_TIMEOUT_MS) ?? defaultRequestTimeoutMs;
    const searchRequestTimeoutMs = parsePositiveInt(env.EXO_MCP_SEARCH_TIMEOUT_MS) ?? defaultSearchRequestTimeoutMs;
    const maintenanceRequestTimeoutMs =
      parsePositiveInt(env.EXO_MCP_MAINTENANCE_TIMEOUT_MS) ?? defaultMaintenanceRequestTimeoutMs;
    let info = await readServerInfo(serverJsonPath);

    const startEnv = await resolveMcpWorkspaceEnv(env);
    if (!info && autostart) {
      startExo(startEnv);
      info = await waitForServerInfo(serverJsonPath, timeoutMs);
    }

    if (!info) {
      throw new Error(
        `Exo app is not reachable. Start Exo first, set EXO_MCP_AUTOSTART=1, or set EXO_RUNTIME_ROOT to the runtime containing server.json. Looked at: ${serverJsonPath}`,
      );
    }

    let client = new ExoCommandClient(`http://127.0.0.1:${info.port}`, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);
    if (await client.isReachable()) {
      return client;
    }

    if (!autostart) {
      throw new Error(`Exo command server is stale or unreachable at ${client.baseUrl}. Set EXO_MCP_AUTOSTART=1 to let MCP start Exo.`);
    }

    startExo(startEnv);
    client = await waitForReachableClient(serverJsonPath, timeoutMs, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);
    return client;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.status);
  }

  async getIndexStatus(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.indexStatus);
  }

  async syncIndex(): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.indexSync, {}, this.maintenanceRequestTimeoutMs);
  }

  async search(query: string, options: { limit?: number; intent?: string; includeContent?: boolean; maxLinesPerResult?: number } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ q: query });
    if (options.limit) params.set("limit", String(options.limit));
    if (options.intent) params.set("intent", options.intent);
    if (options.includeContent) params.set("includeContent", "1");
    if (options.maxLinesPerResult) params.set("maxLinesPerResult", String(options.maxLinesPerResult));
    return this.get(`${EXO_COMMAND_ROUTES.search}?${params.toString()}`, this.searchRequestTimeoutMs);
  }

  async readDocument(target: string, options: { fromLine?: number; maxLines?: number } = {}): Promise<Record<string, unknown>> {
    return this.post(EXO_COMMAND_ROUTES.read, { target, ...options });
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

  async listAgents(): Promise<ExoAgent[]> {
    return this.get(EXO_COMMAND_ROUTES.terminals);
  }

  async createAgent(kind: ExoAgentKind, cwd?: string): Promise<ExoAgent> {
    return this.post(EXO_COMMAND_ROUTES.terminals, { kind, cwd });
  }

  async readAgent(id: string, tailChars = 20_000): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTranscript(id, tailChars));
    return String(result.transcript ?? "");
  }

  async sendAgentInput(id: string, input: string): Promise<void> {
    await this.post(EXO_COMMAND_ROUTES.terminalWrite(id), { data: input });
  }

  async killAgent(id: string): Promise<void> {
    await this.delete(EXO_COMMAND_ROUTES.terminal(id));
  }

  private async get(targetPath: string, timeoutMs = this.requestTimeoutMs): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${targetPath}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new Error(`Exo command server returned HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "GET", targetPath, timeoutMs);
    }
  }

  private async post(targetPath: string, body: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${targetPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Exo command server returned HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "POST", targetPath, timeoutMs);
    }
  }

  private async delete(targetPath: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${targetPath}`, { method: "DELETE", signal: AbortSignal.timeout(this.requestTimeoutMs) });
      if (!response.ok) {
        throw new Error(`Exo command server returned HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json();
    } catch (error) {
      throw enhanceTimeoutError(error, "DELETE", targetPath, this.requestTimeoutMs);
    }
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }
}

async function resolveMcpRuntimeRoot(env: NodeJS.ProcessEnv): Promise<string> {
  if (env.EXO_RUNTIME_ROOT) {
    return env.EXO_RUNTIME_ROOT;
  }
  const workspaceEnv = await resolveMcpWorkspaceEnv(env);
  return path.join(workspaceEnv.EXO_WORKSPACE_ROOT ?? process.cwd(), ".exo");
}

async function resolveMcpWorkspaceEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (workspaceEnvOverrides(env)) {
    return env;
  }
  const settings = await loadActiveWorkspaceSettings(env);
  return settings ? { ...env, ...workspaceSettingsToEnv(settings) } : env;
}

async function readServerInfo(serverJsonPath: string): Promise<ExoCommandServerInfo | null> {
  try {
    return JSON.parse(await readFile(serverJsonPath, "utf8")) as ExoCommandServerInfo;
  } catch {
    return null;
  }
}

async function waitForServerInfo(serverJsonPath: string, timeoutMs: number): Promise<ExoCommandServerInfo | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await readServerInfo(serverJsonPath);
    if (info) {
      return info;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

async function waitForReachableClient(
  serverJsonPath: string,
  timeoutMs: number,
  requestTimeoutMs: number,
  searchRequestTimeoutMs: number,
  maintenanceRequestTimeoutMs: number,
): Promise<ExoCommandClient> {
  const deadline = Date.now() + timeoutMs;
  let lastBaseUrl = "";
  while (Date.now() < deadline) {
    const info = await readServerInfo(serverJsonPath);
    if (info) {
      const client = new ExoCommandClient(`http://127.0.0.1:${info.port}`, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);
      lastBaseUrl = client.baseUrl;
      if (await client.isReachable()) {
        return client;
      }
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Exo command server${lastBaseUrl ? ` at ${lastBaseUrl}` : ""}.`);
}

function startExo(env: NodeJS.ProcessEnv): void {
  const command = env.EXO_MCP_START_COMMAND ?? `${defaultExoCommand()} dev`;
  const child = spawn(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  child.unref();
}

function defaultExoCommand(): string {
  return shellQuote(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bin/exo"));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parsePositiveInt(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatAgents(agents: ExoAgent[]): string {
  if (agents.length === 0) {
    return "No Exo agents are registered.";
  }

  return agents
    .map((agent) => `${agent.id}\t${agent.kind}\t${agent.status}\t${agent.cwd}\t${agent.title}`)
    .join("\n");
}

export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}
