#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { once } from "node:events";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS, DEFAULT_TERMINAL_READ_TAIL_CHARS } from "@exo/core/terminal-settings";
import {
  formatRegisteredAgentHarnessUsage,
  normalizeRegisteredAgentHarnessKindForSurface,
} from "@exo/core/agent-harness-registry";
import * as z from "zod/v4";

import { ExoCommandClient, formatAgents, stripAnsi } from "./exo-client";

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3333;
const DEFAULT_HTTP_PATH = "/mcp";

type HttpServerOptions = {
  host?: string;
  port?: number;
  path?: string;
};

type RunningHttpServer = {
  close: () => Promise<void>;
  endpoint: string;
  host: string;
  port: number;
  server: HttpServer;
  url: string;
};

export function createExoMcpServer(): McpServer {
  const server = new McpServer({
    name: "exo",
    version: "0.1.0",
  });
  registerExoTools(server);
  return server;
}

function registerExoTools(server: McpServer) {
  server.registerTool(
  "workspace_status",
  {
    title: "Workspace Status",
    description: "Show Exo workspace roots, advanced search roots, and runtime status.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const status = await client.getStatus();
    const indexStatus = await client.getIndexStatus();
    const terminals = (status as { terminals?: unknown }).terminals;
    const workspaceStatus = {
      ...status,
      agents: Array.isArray(terminals) ? terminals : [],
      indexStatus,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(workspaceStatus, null, 2) }],
      structuredContent: workspaceStatus,
    };
  },
);

server.registerTool(
  "search",
  {
    title: "Search Exo",
    description: "Search Exo using the QMD advanced provider when enabled, with core workspace fallback. Safe while sync/embeddings are running; returns warnings when degraded.",
    inputSchema: {
      query: z.string().min(1).describe("Search query."),
      limit: z.number().int().positive().max(50).default(10).describe("Maximum number of results."),
      intent: z.string().optional().describe("Optional intent/context for semantic or hybrid search."),
      includeContent: z.boolean().default(false).describe("Include bounded document content in each result."),
      maxLinesPerResult: z.number().int().positive().max(300).default(80).describe("Maximum content lines per result when includeContent is true."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ query, limit, intent, includeContent, maxLinesPerResult }) => {
    const client = await ExoCommandClient.connect();
    const results = await client.search(query, { limit, intent, includeContent, maxLinesPerResult });
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      structuredContent: results,
    };
  },
);

server.registerTool(
  "read_document",
  {
    title: "Read Document",
    description: "Read a document by filesystem path or QMD docid returned by search.",
    inputSchema: {
      target: z.string().min(1).describe("Filesystem path or docid returned by search."),
      fromLine: z.number().int().positive().optional().describe("Optional 1-indexed starting line."),
      maxLines: z.number().int().positive().max(1000).optional().describe("Optional maximum lines to return."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ target, fromLine, maxLines }) => {
    const client = await ExoCommandClient.connect();
    const document = await client.readDocument(target, { fromLine, maxLines });
    return {
      content: [{ type: "text", text: JSON.stringify(document, null, 2) }],
      structuredContent: document,
    };
  },
);

server.registerTool(
  "open_preview",
  {
    title: "Open Exo Preview",
    description:
      "Open an http(s) URL or an existing local .html/.htm file inside Exo's in-app browser preview pane. Local paths must be inside the active workspace, note roots, or project roots.",
    inputSchema: {
      target: z.string().min(1).describe("HTTP(S) URL, file:// URL, absolute local HTML path, or workspace-relative HTML path."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ target }) => {
    try {
      const client = await ExoCommandClient.connect();
      const result = await client.openPreview(target);
      const structuredContent: Record<string, unknown> = {
        ok: result.ok,
        url: result.url,
        source: result.source,
      };
      return {
        content: [{ type: "text", text: `Opened preview: ${result.url}` }],
        structuredContent,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: { ok: false, error: message },
      };
    }
  },
);

server.registerTool(
  "focus_preview",
  {
    title: "Focus Exo Preview",
    description: "Focus Exo's in-app browser preview pane, creating an empty preview pane when none is open.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const result = await client.focusPreview();
    return {
      content: [{ type: "text", text: "Focused preview pane." }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "close_preview",
  {
    title: "Close Exo Preview",
    description: "Close the focused Exo preview pane, or the first open preview pane when focus is elsewhere.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const result = await client.closePreview();
    return {
      content: [{ type: "text", text: "Closed preview pane." }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "list_agents",
  {
    title: "List Exo Agents",
    description: "List live agent terminals managed by the running Exo app.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const agents = await client.listAgents();
    return {
      content: [{ type: "text", text: formatAgents(agents) }],
      structuredContent: { agents },
    };
  },
);

server.registerTool(
  "create_agent",
  {
    title: "Create Exo Agent",
    description:
      `Create a new Exo-managed terminal session for a registered agent harness exposed to MCP. Available kinds: ${mcpAgentKindUsage()}. Unavailable harnesses return clear command-server errors.`,
    inputSchema: {
      kind: z.string().min(1).describe("Registered MCP-exposed agent harness to create."),
      cwd: z.string().min(1).optional().describe("Optional working directory. Defaults to Exo's default terminal cwd."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ kind, cwd }) => {
    const normalizedKind = normalizeMcpAgentKind(kind);
    if (!normalizedKind) {
      const usage = mcpAgentKindUsage();
      return {
        isError: true,
        content: [{ type: "text", text: `Agent harness is not exposed to MCP: ${kind}. Expected one of: ${usage}.` }],
        structuredContent: { ok: false, error: "unsupported-agent-harness", kind, expected: usage },
      };
    }
    const client = await ExoCommandClient.connect();
    const agent = await client.createAgent(normalizedKind, cwd);
    return {
      content: [{ type: "text", text: `Created ${agent.kind} agent ${agent.id} in ${agent.cwd}.` }],
      structuredContent: { agent },
    };
  },
);

server.registerTool(
  "read_agent",
  {
    title: "Read Exo Agent",
    description: "Read the bounded live terminal tail for one Exo agent. This is read-only.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
      maxLines: z.number().int().positive().optional().describe("Maximum live terminal lines to return, bounded by Exo's configured terminal history lines. Prefer this for reads that should not flood callers."),
      tailChars: z.number().int().nonnegative().optional().describe("Maximum characters to return from the end of the transcript when maxLines is omitted. Omit to use Exo's configured default."),
      clean: z.boolean().default(true).describe("Strip ANSI terminal escape codes before returning output."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ agentId, maxLines, tailChars, clean }) => {
    const client = await ExoCommandClient.connect();
    const config = await client.getConfig();
    const configuredDefault = readNonNegativeInteger(config.terminalReadTailChars, DEFAULT_TERMINAL_READ_TAIL_CHARS);
    const configuredMax = readNonNegativeInteger(config.terminalMaxReadTailChars, DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS);
    const requestedTailChars = tailChars ?? configuredDefault;
    const effectiveTailChars = configuredMax > 0 && requestedTailChars > 0
      ? Math.min(requestedTailChars, configuredMax)
      : requestedTailChars;
    const rawOutput = maxLines ? await client.readAgentTail(agentId, maxLines) : await client.readAgent(agentId, effectiveTailChars);
    const output = clean ? stripAnsi(rawOutput) : rawOutput;
    return {
      content: [{ type: "text", text: output || "(no buffered output)" }],
      structuredContent: { agentId, output, maxLines, tailChars: maxLines ? undefined : effectiveTailChars },
    };
  },
);

server.registerTool(
  "send_agent_message",
  {
    title: "Send Exo Agent Message",
    description:
      "Send a message to a live Exo agent terminal and press Enter by default. This can affect an active Claude/Codex session; use only with an explicit agent id.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
      message: z.string().min(1).describe("Text to send to the agent."),
      submit: z.boolean().default(true).describe("Append Enter after the message. Defaults to true so the agent receives the message."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ agentId, message, submit }) => {
    const client = await ExoCommandClient.connect();
    const result = await client.sendAgentMessage(agentId, message, submit);
    const text = formatAgentMessageDelivery(agentId, submit, result);
    return {
      content: [{ type: "text", text }],
      structuredContent: { agentId, submitted: submit, delivery: result.delivery, queuedInputCount: result.queuedInputCount ?? 0 },
      isError: result.delivery === "not-found" || result.ok === false,
    };
  },
);

server.registerTool(
  "terminate_agent",
  {
    title: "Terminate Exo Agent",
    description: "Terminate an Exo-managed terminal session and its supervised pty process.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ agentId }) => {
    const client = await ExoCommandClient.connect();
    await client.killAgent(agentId);
    return {
      content: [{ type: "text", text: `Terminated ${agentId}.` }],
      structuredContent: { agentId, terminated: true },
    };
  },
);

server.registerTool(
  "interrupt_agent",
  {
    title: "Interrupt Exo Agent",
    description: "Send Ctrl-C or Escape to a live Exo agent terminal.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
      signal: z.enum(["escape", "ctrl-c"]).default("escape"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ agentId, signal }) => {
    const client = await ExoCommandClient.connect();
    await client.sendAgentInput(agentId, signal === "ctrl-c" ? "\u0003" : "\u001b");
    return {
      content: [{ type: "text", text: `Sent ${signal} to ${agentId}.` }],
      structuredContent: { agentId, signal },
    };
  },
);
}

export async function runServer() {
  const server = createExoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function runHttpServer(options: HttpServerOptions = {}): Promise<RunningHttpServer> {
  const host = options.host ?? process.env.EXO_MCP_HTTP_HOST ?? DEFAULT_HTTP_HOST;
  const port = options.port ?? Number(process.env.EXO_MCP_HTTP_PORT ?? DEFAULT_HTTP_PORT);
  const endpoint = normalizeHttpPath(options.path ?? process.env.EXO_MCP_HTTP_PATH ?? DEFAULT_HTTP_PATH);
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    try {
      if (!matchesEndpoint(req.url, endpoint)) {
        sendJsonRpcError(res, 404, "Not found");
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        await handleHttpPost(req, res, body, transports);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const transport = findSessionTransport(req, transports);
        if (!transport) {
          sendJsonRpcError(res, 400, "Invalid or missing MCP session id");
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      sendJsonRpcError(res, 405, `Method ${req.method ?? "UNKNOWN"} is not supported`);
    } catch (error) {
      console.error("[exo-mcp] HTTP transport error", error instanceof Error ? error.stack ?? error.message : String(error));
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, "Internal server error");
      }
    }
  });

  server.listen(port, host);
  await once(server, "listening");

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${resolvedPort}${endpoint}`;
  console.log(`[exo-mcp] streamable http listening on ${url}`);

  return {
    close: async () => {
      await Promise.all(Array.from(transports.values(), (transport) => transport.close().catch(() => undefined)));
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    endpoint,
    host,
    port: resolvedPort,
    server,
    url,
  };
}

async function handleHttpPost(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  transports: Map<string, StreamableHTTPServerTransport>,
) {
  const existingTransport = findSessionTransport(req, transports);
  if (existingTransport) {
    await existingTransport.handleRequest(req, res, body);
    return;
  }

  if (!getMcpSessionId(req) && isInitializeRequest(body)) {
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
      },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        transports.delete(sessionId);
      }
    };

    const mcpServer = createExoMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  sendJsonRpcError(res, 400, "Bad request: no valid MCP session id or initialize request");
}

function findSessionTransport(req: IncomingMessage, transports: Map<string, StreamableHTTPServerTransport>) {
  const sessionId = getMcpSessionId(req);
  return sessionId ? transports.get(sessionId) : undefined;
}

function getMcpSessionId(req: IncomingMessage): string | undefined {
  const header = req.headers["mcp-session-id"];
  return Array.isArray(header) ? header[0] : header;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return undefined;
  }
  return JSON.parse(rawBody);
}

function matchesEndpoint(url: string | undefined, endpoint: string): boolean {
  if (!url) {
    return false;
  }
  const pathname = new URL(url, "http://localhost").pathname;
  return pathname === endpoint;
}

function normalizeHttpPath(path: string): string {
  const trimmed = path.trim() || DEFAULT_HTTP_PATH;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function formatAgentMessageDelivery(
  agentId: string,
  submit: boolean,
  result: { ok: boolean; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number },
): string {
  if (result.delivery === "queued") {
    return `Queued message for ${agentId} until the agent is ready (${result.queuedInputCount ?? 1} pending).`;
  }
  if (result.delivery === "sent") {
    return `Sent ${submit ? "message plus Enter" : "message without Enter"} to ${agentId}.`;
  }
  return `Could not send message to ${agentId}: terminal is missing, exited, or detached.`;
}

function mcpAgentKindUsage(env: NodeJS.ProcessEnv = process.env): string {
  return formatRegisteredAgentHarnessUsage({ surface: "mcp" }, env) || "(none)";
}

function normalizeMcpAgentKind(kind: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  return normalizeRegisteredAgentHarnessKindForSurface(kind, { surface: "mcp" }, env);
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export async function runCli(argv = process.argv) {
  const args = argv.slice(2);
  const transport = readArgValue(args, "--transport") ?? (args.includes("--http") ? "http" : "stdio");
  if (transport === "http" || transport === "streamable-http") {
    await runHttpServer({
      host: readArgValue(args, "--host"),
      port: readNumberArgValue(args, "--port"),
      path: readArgValue(args, "--path"),
    });
    return;
  }

  if (transport !== "stdio") {
    throw new Error(`Unsupported Exo MCP transport "${transport}". Use "stdio" or "http".`);
  }

  await runServer();
}

function readArgValue(args: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(equalsPrefix));
  if (inline) {
    return inline.slice(equalsPrefix.length);
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readNumberArgValue(args: string[], name: string): number | undefined {
  const value = readArgValue(args, name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`${name} must be an integer port between 0 and 65535.`);
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runCli(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
