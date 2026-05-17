import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXO_COMMAND_ROUTES,
  type ExoIndexRootRequest,
  type ExoCommandTerminalInfo,
  type ExoCreateTerminalRequest,
  type ExoReadDocumentRequest,
  type ExoOpenFileRequest,
  type ExoWriteTerminalRequest,
  type IndexReadResponse,
  type IndexSearchResponse,
  type IndexSyncResult,
  type IndexStatus,
  type WorkspaceSearchResults,
  type WorkspaceSettings,
} from "@exo/core";

export interface CommandServerOptions {
  runtimeRoot: string;
  onShowWindow: () => void;
  onOpenFile: (filePath: string) => void;
  onSearch: (query: string) => Promise<WorkspaceSearchResults>;
  onIndexSearch: (query: string, options: { limit?: number; intent?: string; includeContent?: boolean; maxLinesPerResult?: number }) => Promise<IndexSearchResponse>;
  onReadDocument: (target: string, options: { fromLine?: number; maxLines?: number }) => Promise<IndexReadResponse>;
  onIndexStatus: () => Promise<IndexStatus>;
  onIndexAddRoot: (input: ExoIndexRootRequest) => Promise<WorkspaceSettings>;
  onIndexRemoveRoot: (target: string) => Promise<WorkspaceSettings>;
  onIndexSync: () => Promise<IndexSyncResult>;
  onIndexUpdate: () => Promise<IndexStatus>;
  onIndexEmbed: () => Promise<IndexStatus>;
  onListTerminals: () => ExoCommandTerminalInfo[];
  onCreateTerminal: (kind: string, cwd?: string) => Promise<ExoCommandTerminalInfo>;
  onReadTerminal: (id: string) => string | null;
  onReadTerminalTranscript: (id: string, tailChars: number) => string | null;
  onWriteTerminal: (id: string, data: string) => Promise<void>;
  onKillTerminal: (id: string) => Promise<void>;
  onGetSettings: () => WorkspaceSettings;
  onGetStatus: () => object;
}

export class CommandServer {
  private server: Server | null = null;
  private port = 0;
  private serverJsonPath: string;

  constructor(private options: CommandServerOptions) {
    this.serverJsonPath = path.join(options.runtimeRoot, "server.json");
  }

  async start(): Promise<number> {
    await mkdir(this.options.runtimeRoot, { recursive: true });

    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve, reject) => {
      this.server!.listen(0, "127.0.0.1", async () => {
        const address = this.server!.address();
        if (typeof address === "object" && address) {
          this.port = address.port;
          await this.writeServerJson();
          resolve(this.port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });

      this.server!.on("error", reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    rm(this.serverJsonPath, { force: true }).catch(() => {});
  }

  private async writeServerJson(): Promise<void> {
    const data = JSON.stringify({ port: this.port, pid: process.pid }, null, 2);
    await writeFile(this.serverJsonPath, data, "utf-8");
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    try {
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

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.indexUpdate) {
        json(res, await this.options.onIndexUpdate());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.indexSync) {
        json(res, await this.options.onIndexSync());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.indexEmbed) {
        json(res, await this.options.onIndexEmbed());
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

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.config) {
        json(res, this.options.onGetSettings());
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.terminals) {
        json(res, this.options.onListTerminals());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.terminals) {
        const body = await readBody(req);
        const { kind, cwd } = body as ExoCreateTerminalRequest;
        if (!kind || !["shell", "claude", "codex"].includes(kind)) {
          json(res, { error: "kind must be shell, claude, or codex" }, 400);
          return;
        }
        const terminal = await this.options.onCreateTerminal(kind, cwd);
        json(res, terminal);
        return;
      }

      const terminalReadMatch = pathname.match(/^\/terminals\/([^/]+)\/buffer$/);
      if (method === "GET" && terminalReadMatch) {
        const buffer = this.options.onReadTerminal(decodeURIComponent(terminalReadMatch[1]));
        if (buffer === null) {
          json(res, { error: "Terminal not found" }, 404);
          return;
        }
        json(res, { buffer });
        return;
      }

      const terminalTranscriptMatch = pathname.match(/^\/terminals\/([^/]+)\/transcript$/);
      if (method === "GET" && terminalTranscriptMatch) {
        const tailChars = parseTailChars(url.searchParams.get("tailChars"));
        const transcript = this.options.onReadTerminalTranscript(
          decodeURIComponent(terminalTranscriptMatch[1]),
          tailChars,
        );
        if (transcript === null) {
          json(res, { error: "Terminal not found" }, 404);
          return;
        }
        json(res, { transcript });
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
        await this.options.onWriteTerminal(decodeURIComponent(terminalWriteMatch[1]), data);
        json(res, { ok: true });
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
      json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
}

function parseTailChars(value: string | null): number {
  if (!value) {
    return 200_000;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 2_000_000) : 200_000;
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
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
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
