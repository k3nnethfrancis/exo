import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXO_COMMAND_ROUTES,
  EXO_COMMAND_TOKEN_HEADER,
  type ExoCommandServerInfo,
  type ExoIndexRootRequest,
  type ExoCommandTerminalInfo,
  type ExoCreateTerminalRequest,
  type ExoReadDocumentRequest,
  type ExoOpenFileRequest,
  type ExoOpenPreviewRequest,
  type ExoOpenPreviewResponse,
  type ExoPreviewCommandResponse,
  type ExoSendTerminalMessageRequest,
  type ExoSpawnAgentCommandRequest,
  type ExoSpawnAgentCommandResponse,
  type ExoWriteTerminalRequest,
  type ExoWriteTerminalResponse,
  type IndexReadResponse,
  type IndexSearchResponse,
  type IndexSyncResult,
  type IndexStatus,
  type WorkspaceSearchResults,
  type WorkspaceSettings,
} from "@exo/core";

import type { TerminalCreateOptions } from "../shared/api";
import { AgentCommandInvocationError, type AgentCommandInvocationResult } from "./agent-command-invocation-service";

export interface CommandServerOptions {
  runtimeRoot: string;
  onShowWindow: () => void;
  onOpenFile: (filePath: string) => void;
  onOpenPreview: (target: string) => Promise<ExoOpenPreviewResponse>;
  onFocusPreview: () => ExoPreviewCommandResponse;
  onClosePreview: () => ExoPreviewCommandResponse;
  onSearch: (query: string) => Promise<WorkspaceSearchResults>;
  onIndexSearch: (query: string, options: { limit?: number; intent?: string; includeContent?: boolean; maxLinesPerResult?: number }) => Promise<IndexSearchResponse>;
  onReadDocument: (target: string, options: { fromLine?: number; maxLines?: number }) => Promise<IndexReadResponse>;
  onIndexStatus: () => Promise<IndexStatus>;
  onIndexAddRoot: (input: ExoIndexRootRequest) => Promise<WorkspaceSettings>;
  onIndexRemoveRoot: (target: string) => Promise<WorkspaceSettings>;
  onIndexSync: () => Promise<IndexSyncResult>;
  onListTerminals: () => ExoCommandTerminalInfo[];
  onCreateTerminal: (options: TerminalCreateOptions) => Promise<ExoCommandTerminalInfo>;
  onReadTerminalTail: (id: string, options?: { maxLines?: number }) => string | null;
  onWriteTerminal: (id: string, data: string) => Promise<ExoWriteTerminalResponse>;
  onSendTerminalMessage: (id: string, message: string, submit: boolean) => Promise<ExoWriteTerminalResponse>;
  onKillTerminal: (id: string) => Promise<void>;
  onGetSettings: () => WorkspaceSettings;
  onGetStatus: () => object;
  onSpawnAgentCommand: (input: { handle: string; task: string }) => Promise<AgentCommandInvocationResult>;
}

export class CommandServer {
  private server: Server | null = null;
  private port = 0;
  private serverJsonPath: string;
  private discoveryRefreshTimer: NodeJS.Timeout | null = null;
  private readonly token = randomBytes(32).toString("base64url");

  constructor(private options: CommandServerOptions) {
    this.serverJsonPath = path.join(options.runtimeRoot, "server.json");
  }

  async start(): Promise<number> {
    await mkdir(this.options.runtimeRoot, { recursive: true });

    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        if (typeof address === "object" && address) {
          this.port = address.port;
          this.writeServerJson().then(() => {
            this.startDiscoveryRefreshTimer();
            resolve(this.port);
          }, (error) => {
            this.server?.close();
            this.server = null;
            reject(error);
          });
        } else {
          reject(new Error("Failed to get server address"));
        }
      });

      this.server!.on("error", reject);
    });
  }

  stop(): void {
    if (this.discoveryRefreshTimer) {
      clearInterval(this.discoveryRefreshTimer);
      this.discoveryRefreshTimer = null;
    }
    if (this.server) {
      if (this.server.listening) {
        this.server.close();
      }
      this.server = null;
    }
    rm(this.serverJsonPath, { force: true }).catch(() => {});
  }

  isListening(): boolean {
    return Boolean(this.server?.listening && this.port > 0);
  }

  getPort(): number | null {
    return this.isListening() ? this.port : null;
  }

  async ensureDiscoveryFile(): Promise<ExoCommandServerInfo & { path: string }> {
    if (!this.isListening()) {
      throw new Error("Command server is not listening.");
    }
    await this.writeServerJson();
    return { port: this.port, pid: process.pid, token: this.token, path: this.serverJsonPath };
  }

  private async writeServerJson(): Promise<void> {
    const data = JSON.stringify({ port: this.port, pid: process.pid, token: this.token }, null, 2);
    await mkdir(this.options.runtimeRoot, { recursive: true });
    await writeFile(this.serverJsonPath, data, { encoding: "utf-8", mode: 0o600 });
    await chmod(this.serverJsonPath, 0o600).catch(() => {});
  }

  private startDiscoveryRefreshTimer(): void {
    if (this.discoveryRefreshTimer) {
      clearInterval(this.discoveryRefreshTimer);
    }
    this.discoveryRefreshTimer = setInterval(() => {
      if (!this.isListening()) {
        return;
      }
      this.writeServerJson().catch((error) => {
        console.warn("[exo] failed to refresh command server discovery:", error);
      });
    }, 5_000);
    this.discoveryRefreshTimer.unref?.();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (!isLoopbackRemote(req.socket.remoteAddress)) {
        json(res, { error: "Command server only accepts loopback requests." }, 403);
        return;
      }

      if (!this.isAuthenticated(req)) {
        json(res, { error: "Missing or invalid Exo command token." }, 401);
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.status) {
        json(res, this.options.onGetStatus());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.show) {
        this.options.onShowWindow();
        json(res, { ok: true });
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.search) {
        const query = url.searchParams.get("q") ?? "";
        if (!query) {
          json(res, { error: "Missing query parameter ?q=" }, 400);
          return;
        }
        const limit = parseOptionalNumber(url.searchParams.get("limit"));
        const results = await this.options.onIndexSearch(query, {
          limit,
          intent: url.searchParams.get("intent") ?? undefined,
          includeContent: url.searchParams.get("includeContent") === "1",
          maxLinesPerResult: parseOptionalNumber(url.searchParams.get("maxLinesPerResult")),
        });
        json(res, results);
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.read) {
        const body = await readBody(req);
        const { target, fromLine, maxLines } = body as ExoReadDocumentRequest;
        if (!target) {
          json(res, { error: "Missing target in body" }, 400);
          return;
        }
        json(res, await this.options.onReadDocument(target, { fromLine, maxLines }));
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.indexStatus) {
        json(res, await this.options.onIndexStatus());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.indexRoots) {
        const body = await readBody(req);
        json(res, await this.options.onIndexAddRoot(body as ExoIndexRootRequest));
        return;
      }

      const indexRootMatch = pathname.match(/^\/index\/roots\/(.+)$/);
      if (method === "DELETE" && indexRootMatch) {
        json(res, await this.options.onIndexRemoveRoot(decodeURIComponent(indexRootMatch[1])));
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.indexSync) {
        json(res, await this.options.onIndexSync());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.open) {
        const body = await readBody(req);
        const { path: filePath } = body as ExoOpenFileRequest;
        if (!filePath) {
          json(res, { error: "Missing path in body" }, 400);
          return;
        }
        this.options.onOpenFile(filePath);
        json(res, { ok: true });
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.openPreview) {
        const body = await readBody(req);
        const { target } = body as ExoOpenPreviewRequest;
        if (!target) {
          json(res, { error: "Missing target in body" }, 400);
          return;
        }
        json(res, await this.options.onOpenPreview(target));
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.focusPreview) {
        json(res, this.options.onFocusPreview());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.closePreview) {
        json(res, this.options.onClosePreview());
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.config) {
        json(res, this.options.onGetSettings());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.spawnAgentCommand) {
        const body = await readBody(req);
        const { handle, task } = body as ExoSpawnAgentCommandRequest;
        if (!handle || !task) {
          json(res, { ok: false, code: "missing-agent-command-spawn-input", error: "Missing handle or task in body." }, 400);
          return;
        }
        try {
          const result = await this.options.onSpawnAgentCommand({ handle, task });
          json(res, { ok: true, invocation: result.invocation, terminal: result.terminal } satisfies ExoSpawnAgentCommandResponse);
        } catch (error) {
          if (error instanceof AgentCommandInvocationError) {
            json(res, { ok: false, code: error.code, error: error.message, ...error.details }, error.code === "agent-command-untrusted" ? 403 : 400);
            return;
          }
          throw error;
        }
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.terminals) {
        json(res, this.options.onListTerminals());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.terminals) {
        const body = await readBody(req);
        const { kind, cwd } = body as ExoCreateTerminalRequest;
        if (kind && kind !== "shell") {
          json(res, {
            ok: false,
            code: "unsupported-terminal-launch",
            error: "Terminal creation only supports shell. Configure agents as AgentCommands and invoke them from notes.",
          }, 400);
          return;
        }
        try {
          const terminal = await this.options.onCreateTerminal({
            terminalKind: "shell",
            cwd,
          });
          json(res, terminal);
        } catch (error) {
          json(res, {
            ok: false,
            code: "unsupported-terminal-launch",
            error: error instanceof Error ? error.message : String(error),
          }, 400);
        }
        return;
      }

      const terminalReadMatch = pathname.match(/^\/terminals\/([^/]+)\/tail$/);
      if (method === "GET" && terminalReadMatch) {
        const tail = this.options.onReadTerminalTail(decodeURIComponent(terminalReadMatch[1]), {
          maxLines: parsePositiveNumber(url.searchParams.get("lines")),
        });
        if (tail === null) {
          json(res, { error: "Terminal not found" }, 404);
          return;
        }
        json(res, { tail });
        return;
      }

      const terminalWriteMatch = pathname.match(/^\/terminals\/([^/]+)\/write$/);
      if (method === "POST" && terminalWriteMatch) {
        const body = await readBody(req);
        const { data } = body as ExoWriteTerminalRequest;
        if (typeof data !== "string") {
          json(res, { error: "Missing string data in body" }, 400);
          return;
        }
        json(res, await this.options.onWriteTerminal(decodeURIComponent(terminalWriteMatch[1]), data));
        return;
      }

      const terminalMessageMatch = pathname.match(/^\/terminals\/([^/]+)\/message$/);
      if (method === "POST" && terminalMessageMatch) {
        const body = await readBody(req);
        const { message, submit } = body as ExoSendTerminalMessageRequest;
        if (typeof message !== "string") {
          json(res, { error: "Missing string message in body" }, 400);
          return;
        }
        json(res, await this.options.onSendTerminalMessage(decodeURIComponent(terminalMessageMatch[1]), message, submit !== false));
        return;
      }

      const terminalKillMatch = pathname.match(/^\/terminals\/([^/]+)$/);
      if (method === "DELETE" && terminalKillMatch) {
        await this.options.onKillTerminal(decodeURIComponent(terminalKillMatch[1]));
        json(res, { ok: true });
        return;
      }

      json(res, { error: "Not found" }, 404);
    } catch (error) {
      const status = error instanceof CommandServerHttpError ? error.status : 500;
      json(res, { error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  private isAuthenticated(req: IncomingMessage): boolean {
    const headerToken = req.headers[EXO_COMMAND_TOKEN_HEADER];
    if (typeof headerToken === "string" && headerToken === this.token) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader === `Bearer ${this.token}`) {
      return true;
    }

    return false;
  }
}

function parsePositiveNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] ?? "");
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      reject(new CommandServerHttpError(415, "Command server request body must be application/json."));
      return;
    }

    const chunks: Buffer[] = [];
    let byteLength = 0;
    req.on("data", (chunk: Buffer) => {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_COMMAND_SERVER_BODY_BYTES) {
        reject(new CommandServerHttpError(413, "Command server request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const MAX_COMMAND_SERVER_BODY_BYTES = 1_000_000;

class CommandServerHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isLoopbackRemote(remoteAddress: string | undefined): boolean {
  return !remoteAddress || remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}
