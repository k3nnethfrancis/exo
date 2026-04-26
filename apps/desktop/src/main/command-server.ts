import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SemanticSearchResult, WorkspaceSearchResults, WorkspaceSettings } from "@exo/core";

export interface CommandServerOptions {
  runtimeRoot: string;
  onOpenFile: (filePath: string) => void;
  onSearch: (query: string) => Promise<WorkspaceSearchResults>;
  onSearchSemantic: (query: string) => Promise<SemanticSearchResult[]>;
  onListTerminals: () => Array<{ id: string; title: string; cwd: string; kind: string; status: string }>;
  onCreateTerminal: (kind: string, cwd?: string) => Promise<{ id: string; title: string; cwd: string; kind: string }>;
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
      if (method === "GET" && pathname === "/status") {
        json(res, this.options.onGetStatus());
        return;
      }

      if (method === "GET" && pathname === "/search") {
        const query = url.searchParams.get("q") ?? "";
        if (!query) {
          json(res, { error: "Missing query parameter ?q=" }, 400);
          return;
        }
        const results = await this.options.onSearch(query);
        json(res, results);
        return;
      }

      if (method === "GET" && pathname === "/search/semantic") {
        const query = url.searchParams.get("q") ?? "";
        if (!query) {
          json(res, { error: "Missing query parameter ?q=" }, 400);
          return;
        }
        const results = await this.options.onSearchSemantic(query);
        json(res, results);
        return;
      }

      if (method === "POST" && pathname === "/open") {
        const body = await readBody(req);
        const { path: filePath } = body as { path?: string };
        if (!filePath) {
          json(res, { error: "Missing path in body" }, 400);
          return;
        }
        this.options.onOpenFile(filePath);
        json(res, { ok: true });
        return;
      }

      if (method === "GET" && pathname === "/config") {
        json(res, this.options.onGetSettings());
        return;
      }

      if (method === "GET" && pathname === "/terminals") {
        json(res, this.options.onListTerminals());
        return;
      }

      if (method === "POST" && pathname === "/terminals") {
        const body = await readBody(req);
        const { kind, cwd } = body as { kind?: string; cwd?: string };
        if (!kind || !["shell", "claude", "codex"].includes(kind)) {
          json(res, { error: "kind must be shell, claude, or codex" }, 400);
          return;
        }
        const terminal = await this.options.onCreateTerminal(kind, cwd);
        json(res, terminal);
        return;
      }

      json(res, { error: "Not found" }, 404);
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
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
