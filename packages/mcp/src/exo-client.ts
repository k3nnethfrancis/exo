import { spawn } from "node:child_process";
import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXO_COMMAND_ROUTES, type ExoCommandServerInfo, type ExoOpenPreviewResponse } from "@exo/core/command-protocol";
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

export type ExoAgentKind = string;

export interface ExoAgentInputResult {
  ok: boolean;
  delivery: "sent" | "queued" | "not-found";
  queuedInputCount?: number;
  readiness?: "ready" | "starting" | "blocked";
  readinessDetail?: string;
}

const defaultConnectTimeoutMs = 20_000;
const defaultRequestTimeoutMs = 2_000;
const defaultSearchRequestTimeoutMs = 30_000;
const defaultMaintenanceRequestTimeoutMs = 30 * 60_000;
const pollIntervalMs = 250;

export type ProcessCheckResult =
  | { status: "alive" }
  | { status: "dead"; code?: string; message: string }
  | { status: "blocked"; code?: string; message: string }
  | { status: "unknown"; code?: string; message: string };

export type ServerDiscoverySnapshot = {
  info: ExoCommandServerInfo;
  baseUrl: string;
  processCheck: ProcessCheckResult;
};

export type ReachabilityFailure = {
  baseUrl: string;
  message: string;
};

export type AutostartState = {
  attempted: boolean;
  command?: string;
  failed?: boolean;
  errorMessage?: string;
};

export type DiscoveryDiagnostic = {
  kind:
    | "missing-discovery"
    | "stale-pid"
    | "process-check-blocked"
    | "server-unreachable"
    | "autostart-timeout";
  runtimeRoot: string;
  serverJsonPath: string;
  snapshot?: ServerDiscoverySnapshot;
  timeoutMs: number;
  autostart: AutostartState;
  lastReachabilityFailure?: ReachabilityFailure;
};

export class ExoCommandDiscoveryError extends Error {
  constructor(readonly diagnostic: DiscoveryDiagnostic) {
    super(formatDiscoveryDiagnostic(diagnostic));
    this.name = "ExoCommandDiscoveryError";
  }
}

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
    let snapshot = await readServerSnapshot(serverJsonPath);

    const startEnv = await resolveMcpWorkspaceEnv(env);
    const autostartState: AutostartState = { attempted: false };
    if (snapshot?.processCheck.status === "dead" && autostart) {
      await quarantineStaleDiscoveryFile(serverJsonPath);
      Object.assign(autostartState, startExo(startEnv));
      return waitForReachableClient({
        serverJsonPath,
        runtimeRoot,
        initialSnapshot: snapshot,
        timeoutMs,
        requestTimeoutMs,
        searchRequestTimeoutMs,
        maintenanceRequestTimeoutMs,
        autostart: autostartState,
        ignoreSnapshot: snapshot,
      });
    }

    if (!snapshot && autostart) {
      Object.assign(autostartState, startExo(startEnv));
      snapshot = await waitForServerSnapshot(serverJsonPath, timeoutMs);
    }

    if (!snapshot) {
      throw discoveryDiagnosticError({
        kind: autostartState.attempted ? "autostart-timeout" : "missing-discovery",
        runtimeRoot,
        serverJsonPath,
        timeoutMs,
        autostart: autostartState,
      });
    }

    const client = new ExoCommandClient(snapshot.baseUrl, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);
    const reachability = await checkReachability(client);
    if (reachability.ok) {
      return client;
    }

    const lastReachabilityFailure = { baseUrl: snapshot.baseUrl, message: reachability.errorMessage };
    if (!autostart) {
      throw discoveryDiagnosticError({
        kind: classifyUnreachableSnapshot(snapshot),
        runtimeRoot,
        serverJsonPath,
        snapshot,
        timeoutMs,
        autostart: autostartState,
        lastReachabilityFailure,
      });
    }

    Object.assign(autostartState, startExo(startEnv));
    return waitForReachableClient({
      serverJsonPath,
      runtimeRoot,
      initialSnapshot: snapshot,
      timeoutMs,
      requestTimeoutMs,
      searchRequestTimeoutMs,
      maintenanceRequestTimeoutMs,
      autostart: autostartState,
      initialReachabilityFailure: lastReachabilityFailure,
      ignoreSnapshot: snapshot.processCheck.status === "dead" ? snapshot : undefined,
    });
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.status);
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.get(EXO_COMMAND_ROUTES.config);
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

  async openPreview(target: string): Promise<ExoOpenPreviewResponse> {
    return this.post(EXO_COMMAND_ROUTES.openPreview, { target });
  }

  async focusPreview(): Promise<{ ok: true }> {
    return this.post(EXO_COMMAND_ROUTES.focusPreview, {});
  }

  async closePreview(): Promise<{ ok: true }> {
    return this.post(EXO_COMMAND_ROUTES.closePreview, {});
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

  async readAgent(id: string, tailChars: number): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTranscript(id, tailChars));
    return String(result.transcript ?? "");
  }

  async readAgentTail(id: string, maxLines?: number): Promise<string> {
    const result = await this.get(EXO_COMMAND_ROUTES.terminalTail(id, maxLines));
    return String(result.tail ?? "");
  }

  async sendAgentInput(id: string, input: string): Promise<ExoAgentInputResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalWrite(id), { data: input });
  }

  async sendAgentMessage(id: string, message: string, submit = true): Promise<ExoAgentInputResult> {
    return this.post(EXO_COMMAND_ROUTES.terminalMessage(id), { message, submit });
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
    return (await checkReachability(this)).ok;
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
  const settings = await loadActiveWorkspaceSettings(env);
  if (!settings) {
    return env;
  }
  return {
    ...workspaceSettingsToEnv(settings, { includeWorkspace: !workspaceEnvOverrides(env) }),
    ...env,
  };
}

async function readServerInfo(serverJsonPath: string): Promise<ExoCommandServerInfo | null> {
  try {
    return JSON.parse(await readFile(serverJsonPath, "utf8")) as ExoCommandServerInfo;
  } catch {
    return null;
  }
}

async function readServerSnapshot(serverJsonPath: string): Promise<ServerDiscoverySnapshot | null> {
  const info = await readServerInfo(serverJsonPath);
  if (!info) {
    return null;
  }
  return {
    info,
    baseUrl: `http://127.0.0.1:${info.port}`,
    processCheck: checkProcess(info.pid),
  };
}

async function waitForServerSnapshot(serverJsonPath: string, timeoutMs: number): Promise<ServerDiscoverySnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readServerSnapshot(serverJsonPath);
    if (snapshot) {
      return snapshot;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

async function waitForReachableClient(options: {
  serverJsonPath: string;
  runtimeRoot: string;
  initialSnapshot: ServerDiscoverySnapshot;
  timeoutMs: number;
  requestTimeoutMs: number;
  searchRequestTimeoutMs: number;
  maintenanceRequestTimeoutMs: number;
  autostart: AutostartState;
  initialReachabilityFailure?: ReachabilityFailure;
  ignoreSnapshot?: ServerDiscoverySnapshot;
}): Promise<ExoCommandClient> {
  const {
    serverJsonPath,
    runtimeRoot,
    initialSnapshot,
    timeoutMs,
    requestTimeoutMs,
    searchRequestTimeoutMs,
    maintenanceRequestTimeoutMs,
    autostart,
    initialReachabilityFailure,
    ignoreSnapshot,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = initialSnapshot;
  let lastReachabilityFailure: ReachabilityFailure | undefined = initialReachabilityFailure;
  while (Date.now() < deadline) {
    const snapshot = await readServerSnapshot(serverJsonPath);
    if (snapshot) {
      lastSnapshot = snapshot;
      if (ignoreSnapshot && isSameServerSnapshot(snapshot, ignoreSnapshot) && snapshot.processCheck.status === "dead") {
        await sleep(pollIntervalMs);
        continue;
      }
      const client = new ExoCommandClient(snapshot.baseUrl, requestTimeoutMs, searchRequestTimeoutMs, maintenanceRequestTimeoutMs);
      const reachability = await checkReachability(client);
      if (reachability.ok) {
        return client;
      }
      lastReachabilityFailure = { baseUrl: snapshot.baseUrl, message: reachability.errorMessage };
    }
    await sleep(pollIntervalMs);
  }
  throw discoveryDiagnosticError({
    kind: "autostart-timeout",
    runtimeRoot,
    serverJsonPath,
    snapshot: lastSnapshot,
    timeoutMs,
    autostart,
    lastReachabilityFailure,
  });
}

function isSameServerSnapshot(left: ServerDiscoverySnapshot, right: ServerDiscoverySnapshot): boolean {
  return left.info.pid === right.info.pid && left.info.port === right.info.port;
}

function startExo(env: NodeJS.ProcessEnv): AutostartState {
  const command = env.EXO_MCP_START_COMMAND ?? `${defaultExoCommand()} start`;
  try {
    const child = spawn(command, {
      shell: true,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
    child.unref();
    return { attempted: true, command };
  } catch (error) {
    return {
      attempted: true,
      command,
      failed: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
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

async function checkReachability(client: ExoCommandClient): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  try {
    await client.getStatus();
    return { ok: true };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }
}

function checkProcess(pid: number): ProcessCheckResult {
  try {
    process.kill(pid, 0);
    return { status: "alive" };
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "ESRCH") {
      return { status: "dead", code, message };
    }
    if (code === "EPERM" || code === "EACCES") {
      return { status: "blocked", code, message };
    }
    return { status: "unknown", code, message };
  }
}

function classifyUnreachableSnapshot(snapshot: ServerDiscoverySnapshot): DiscoveryDiagnostic["kind"] {
  if (snapshot.processCheck.status === "dead") {
    return "stale-pid";
  }
  if (snapshot.processCheck.status === "blocked") {
    return "process-check-blocked";
  }
  return "server-unreachable";
}

async function quarantineStaleDiscoveryFile(serverJsonPath: string): Promise<void> {
  const stalePath = `${serverJsonPath}.stale-${Date.now()}`;
  try {
    await rename(serverJsonPath, stalePath);
  } catch {
    await rm(serverJsonPath, { force: true }).catch(() => {});
  }
}

function discoveryDiagnosticError(diagnostic: DiscoveryDiagnostic): Error {
  return new ExoCommandDiscoveryError(diagnostic);
}

function formatDiscoveryDiagnostic(diagnostic: DiscoveryDiagnostic): string {
  const lines = [
    discoveryDiagnosticSummary(diagnostic),
    `Runtime root: ${diagnostic.runtimeRoot}`,
    `Discovery file: ${diagnostic.serverJsonPath}`,
    `Connect timeout: ${diagnostic.timeoutMs}ms`,
  ];
  if (diagnostic.autostart.attempted) {
    lines.push("Autostart attempted: yes");
    if (diagnostic.autostart.command) lines.push(`Autostart command: ${diagnostic.autostart.command}`);
    if (diagnostic.autostart.failed) lines.push(`Autostart failed: ${diagnostic.autostart.errorMessage ?? "unknown error"}`);
  } else {
    lines.push("Autostart attempted: no");
  }
  if (diagnostic.snapshot) {
    lines.push(`Recorded pid: ${diagnostic.snapshot.info.pid}`);
    lines.push(`Recorded port: ${diagnostic.snapshot.info.port}`);
    lines.push(`Recorded baseUrl: ${diagnostic.snapshot.baseUrl}`);
    lines.push(`Process check: ${formatProcessCheck(diagnostic.snapshot.processCheck)}`);
  }
  if (diagnostic.lastReachabilityFailure) {
    lines.push(`Last reachability failure: ${diagnostic.lastReachabilityFailure.baseUrl} - ${diagnostic.lastReachabilityFailure.message}`);
  }
  return lines.join("\n");
}

function discoveryDiagnosticSummary(diagnostic: DiscoveryDiagnostic): string {
  switch (diagnostic.kind) {
    case "missing-discovery":
      return "Exo command server discovery file is missing or invalid. Start Exo first, set EXO_MCP_AUTOSTART=1, or set EXO_RUNTIME_ROOT to the runtime containing server.json.";
    case "stale-pid":
      return "Exo command server discovery is stale: the recorded pid is not running.";
    case "process-check-blocked":
      return "Exo command server process check was blocked by permissions or sandbox policy; server reachability could not be confirmed.";
    case "server-unreachable":
      return "Exo command server is unreachable at the recorded base URL.";
    case "autostart-timeout":
      return "Timed out waiting for Exo command server after autostart.";
  }
}

function formatProcessCheck(result: ProcessCheckResult): string {
  if (result.status === "alive") {
    return "alive";
  }
  const code = result.code ? `${result.code}: ` : "";
  return `${result.status} (${code}${result.message})`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
