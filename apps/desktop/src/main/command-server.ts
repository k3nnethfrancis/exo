import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXO_COMMAND_ROUTES,
  validateRegisteredAgentHarnessLaunch,
  type ExoCommandServerInfo,
  type ExoCommandTerminalDiagnostics,
  type ExoCreateProposalRequest,
  type ExoCreateProposalResponse,
  type ExoDecideProposalRequest,
  type ExoDecideProposalResponse,
  type ExoReconnectTerminalResponse,
  type ExoIndexRootRequest,
  type ExoListProposalsResponse,
  type ExoCommandTerminalInfo,
  type ExoCreateTerminalRequest,
  type ExoProjectRootRequest,
  type ExoReadProposalResponse,
  type ExoReadDocumentRequest,
  type ExoOpenFileRequest,
  type ExoOpenPreviewRequest,
  type ExoOpenPreviewResponse,
  type ExoPreviewCommandResponse,
  type ExoReconnectRecoverableTerminalsResponse,
  type ExoSendTerminalMessageRequest,
  type ExoWriteTerminalRequest,
  type ExoWriteTerminalResponse,
  type IndexReadResponse,
  type IndexSearchResponse,
  type IndexSyncResult,
  type IndexStatus,
  type WorkspaceSearchResults,
  type WorkspaceSettings,
  type ProposalApplyResult,
  type ProposalBatch,
} from "@exo/core";

export interface CommandServerOptions {
  runtimeRoot: string;
  onShowWindow: () => void;
  onOpenFile: (filePath: string) => void;
  onOpenPreview: (target: string) => Promise<ExoOpenPreviewResponse>;
  onFocusPreview: () => ExoPreviewCommandResponse;
  onClosePreview: () => ExoPreviewCommandResponse;
  onCreateProposal: (proposal: ProposalBatch) => Promise<ProposalBatch>;
  onListProposals: () => Promise<ProposalBatch[]>;
  onReadProposal: (id: string) => Promise<ProposalBatch | null>;
  onDecideProposal: (id: string, input: { decision: "accept" | "reject"; itemId?: string }) => Promise<ProposalApplyResult>;
  onSearch: (query: string) => Promise<WorkspaceSearchResults>;
  onIndexSearch: (query: string, options: { limit?: number; intent?: string; includeContent?: boolean; maxLinesPerResult?: number }) => Promise<IndexSearchResponse>;
  onReadDocument: (target: string, options: { fromLine?: number; maxLines?: number }) => Promise<IndexReadResponse>;
  onIndexStatus: () => Promise<IndexStatus>;
  onIndexAddRoot: (input: ExoIndexRootRequest) => Promise<WorkspaceSettings>;
  onIndexRemoveRoot: (target: string) => Promise<WorkspaceSettings>;
  onIndexSync: () => Promise<IndexSyncResult>;
  onIndexUpdate: () => Promise<IndexStatus>;
  onIndexEmbed: () => Promise<IndexStatus>;
  onListProjectRoots: () => string[];
  onAddProjectRoot: (input: ExoProjectRootRequest) => Promise<WorkspaceSettings>;
  onRemoveProjectRoot: (target: string) => Promise<WorkspaceSettings>;
  onListTerminals: () => ExoCommandTerminalInfo[];
  onTerminalDiagnostics: () => ExoCommandTerminalDiagnostics[];
  onCreateTerminal: (kind: string, cwd?: string) => Promise<ExoCommandTerminalInfo>;
  onReadTerminalTail: (id: string, options?: { maxLines?: number }) => string | null;
  onReadTerminalTranscript: (id: string, tailChars: number) => string | null;
  onWriteTerminal: (id: string, data: string) => Promise<ExoWriteTerminalResponse>;
  onSendTerminalMessage: (id: string, message: string, submit: boolean) => Promise<ExoWriteTerminalResponse>;
  onReconnectTerminal: (id: string) => Promise<ExoCommandTerminalInfo | null>;
  onReconnectRecoverableTerminals: () => void;
  onKillTerminal: (id: string) => Promise<void>;
  onGetSettings: () => WorkspaceSettings;
  onGetStatus: () => object;
}

export class CommandServer {
  private server: Server | null = null;
  private port = 0;
  private serverJsonPath: string;
  private discoveryRefreshTimer: NodeJS.Timeout | null = null;

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
    return { port: this.port, pid: process.pid, path: this.serverJsonPath };
  }

  private async writeServerJson(): Promise<void> {
    const data = JSON.stringify({ port: this.port, pid: process.pid }, null, 2);
    await mkdir(this.options.runtimeRoot, { recursive: true });
    await writeFile(this.serverJsonPath, data, "utf-8");
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

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.proposals) {
        json(res, { proposals: await this.options.onListProposals() } satisfies ExoListProposalsResponse);
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.proposals) {
        const body = await readBody(req);
        const { proposal } = body as ExoCreateProposalRequest;
        if (!proposal) {
          json(res, { error: "Missing proposal in body" }, 400);
          return;
        }
        json(res, { ok: true, proposal: await this.options.onCreateProposal(proposal) } satisfies ExoCreateProposalResponse);
        return;
      }

      const proposalMatch = pathname.match(/^\/proposals\/([^/]+)$/);
      if (method === "GET" && proposalMatch) {
        const proposal = await this.options.onReadProposal(decodeURIComponent(proposalMatch[1]));
        if (!proposal) {
          json(res, { error: "Proposal not found" }, 404);
          return;
        }
        json(res, { proposal } satisfies ExoReadProposalResponse);
        return;
      }

      const proposalDecisionMatch = pathname.match(/^\/proposals\/([^/]+)\/decision$/);
      if (method === "POST" && proposalDecisionMatch) {
        const body = await readBody(req);
        const { decision, itemId } = body as ExoDecideProposalRequest;
        if (decision !== "accept" && decision !== "reject") {
          json(res, { error: "Missing decision in body" }, 400);
          return;
        }
        const result = await this.options.onDecideProposal(decodeURIComponent(proposalDecisionMatch[1]), { decision, itemId });
        json(res, { ok: true, proposal: result.proposal, appliedItems: result.appliedItems } satisfies ExoDecideProposalResponse);
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.config) {
        json(res, this.options.onGetSettings());
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.projectRoots) {
        json(res, { projectRoots: this.options.onListProjectRoots() });
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.projectRoots) {
        const body = await readBody(req);
        const { path: projectRootPath } = body as ExoProjectRootRequest;
        if (!projectRootPath) {
          json(res, { error: "Missing path in body" }, 400);
          return;
        }
        json(res, await this.options.onAddProjectRoot({ path: projectRootPath }));
        return;
      }

      const projectRootMatch = pathname.match(/^\/project-roots\/(.+)$/);
      if (method === "DELETE" && projectRootMatch) {
        json(res, await this.options.onRemoveProjectRoot(decodeURIComponent(projectRootMatch[1])));
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.terminals) {
        json(res, this.options.onListTerminals());
        return;
      }

      if (method === "GET" && pathname === EXO_COMMAND_ROUTES.terminalDiagnostics) {
        json(res, this.options.onTerminalDiagnostics());
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.terminalReconnectRecoverable) {
        this.options.onReconnectRecoverableTerminals();
        json(res, { ok: true } satisfies ExoReconnectRecoverableTerminalsResponse);
        return;
      }

      if (method === "POST" && pathname === EXO_COMMAND_ROUTES.terminals) {
        const body = await readBody(req);
        const { kind, cwd } = body as ExoCreateTerminalRequest;
        if (!kind) {
          json(res, { error: "Missing kind in body" }, 400);
          return;
        }
        if (kind !== "shell") {
          try {
            validateRegisteredAgentHarnessLaunch(kind);
          } catch (error) {
            json(res, { error: error instanceof Error ? error.message : String(error) }, 400);
            return;
          }
        }
        const terminal = await this.options.onCreateTerminal(kind, cwd);
        json(res, terminal);
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

      const terminalReconnectMatch = pathname.match(/^\/terminals\/([^/]+)\/reconnect$/);
      if (method === "POST" && terminalReconnectMatch) {
        const terminal = await this.options.onReconnectTerminal(decodeURIComponent(terminalReconnectMatch[1]));
        json(res, { ok: true, terminal } satisfies ExoReconnectTerminalResponse);
        return;
      }

      const terminalResyncMatch = pathname.match(/^\/terminals\/([^/]+)\/resync$/);
      if (method === "POST" && terminalResyncMatch) {
        // Geometry resync deliberately uses the reconnect implementation so there is one tested
        // tmux reattach/resize recovery path instead of a parallel "just resize" fallback.
        const terminal = await this.options.onReconnectTerminal(decodeURIComponent(terminalResyncMatch[1]));
        json(res, { ok: true, terminal } satisfies ExoReconnectTerminalResponse);
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
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
