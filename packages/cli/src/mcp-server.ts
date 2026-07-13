import readline from "node:readline";
import path from "node:path";

import {
  filesystemSearchProvider,
  loadActiveWorkspaceSettings,
  resolveWorkspaceModel,
  workspaceEnvOverrides,
  workspaceModelFromSettings,
  type WorkspaceModel,
} from "@exo/core";

import { AppClient } from "./app-client";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_SEARCH_RESULTS = 20;
const MAX_READ_LINES = 500;

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;

/**
 * Read-only MCP adapter for the active Exo Workspace. The same command-server
 * client is used when the app is running; filesystem retrieval is the honest
 * app-off fallback. This is intentionally not a mutation or agent-launch API.
 */
export async function runExoMcpServer(options: {
  env?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
} = {}): Promise<void> {
  const env = options.env ?? process.env;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const operations = await createOperations(env);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line) as JsonRecord;
      const response = await handleRequest(request, operations);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error.write(`[exo mcp] ${message}\n`);
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`);
    }
  }
}

interface ExoMcpOperations {
  status(): Promise<JsonRecord>;
  search(query: string, limit: number): Promise<JsonRecord>;
  read(target: string, fromLine: number | undefined, maxLines: number | undefined): Promise<JsonRecord>;
}

async function createOperations(env: NodeJS.ProcessEnv): Promise<ExoMcpOperations> {
  const model = await resolveWorkspace(env);
  const runtimeRoot = env.EXO_RUNTIME_ROOT ?? path.join(model.workspaceRoot, ".exo");
  const client = await AppClient.connect(runtimeRoot, env);
  if (client) {
    return {
      status: () => client.getStatus(),
      search: (query, limit) => client.search(query, { limit }),
      read: (target, fromLine, maxLines) => client.readDocument(target, { fromLine, maxLines }),
    };
  }
  return {
    status: async () => ({
      ok: true,
      app: { available: false },
      workspace: { root: model.workspaceRoot, noteRoots: model.noteRoots.map((root) => root.path) },
      search: await filesystemSearchProvider.getStatus(model, runtimeRoot),
    }),
    search: async (query, limit) => ({ ...await filesystemSearchProvider.search(model, runtimeRoot, query, { limit }) }),
    read: async (target, fromLine, maxLines) => ({ ...await filesystemSearchProvider.read(model, runtimeRoot, target, { fromLine, maxLines }) }),
  };
}

async function resolveWorkspace(env: NodeJS.ProcessEnv): Promise<WorkspaceModel> {
  if (workspaceEnvOverrides(env)) return resolveWorkspaceModel(env);
  const settings = await loadActiveWorkspaceSettings(env);
  return settings ? workspaceModelFromSettings(settings) : resolveWorkspaceModel(env);
}

async function handleRequest(request: JsonRecord, operations: ExoMcpOperations): Promise<JsonRecord | null> {
  const method = typeof request.method === "string" ? request.method : "";
  const id = isJsonRpcId(request.id) ? request.id : null;
  if (!method) return jsonRpcError(id, -32600, "Invalid request");
  if (request.id === undefined) return null;

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "exo", version: "0.1.0-alpha.3" },
      instructions: "Use Exo to orient within the active Markdown workspace. Search before reading broadly; read paths returned by search. Exo MCP tools are read-only.",
    });
  }
  if (method === "ping") return jsonRpcResult(id, {});
  if (method === "tools/list") return jsonRpcResult(id, { tools: toolDefinitions() });
  if (method === "tools/call") return jsonRpcResult(id, await callTool(request.params, operations));
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function toolDefinitions(): JsonRecord[] {
  return [
    {
      name: "workspace_status",
      description: "Describe the active Exo workspace, its Markdown roots, application availability, and search health.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "search_notes",
      description: "Search the active Exo workspace. Uses the running Exo app's configured retrieval when available, otherwise safe filesystem search across its Note Roots.",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS } },
        required: ["query"],
      },
    },
    {
      name: "read_note",
      description: "Read a Markdown note inside the active Exo workspace. Pass a path returned by search_notes.",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          target: { type: "string", minLength: 1 },
          from_line: { type: "integer", minimum: 1 },
          max_lines: { type: "integer", minimum: 1, maximum: MAX_READ_LINES },
        },
        required: ["target"],
      },
    },
  ];
}

async function callTool(rawParams: unknown, operations: ExoMcpOperations): Promise<JsonRecord> {
  const params = isRecord(rawParams) ? rawParams : {};
  const name = typeof params.name === "string" ? params.name : "";
  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    if (name === "workspace_status") return toolResult(await operations.status());
    if (name === "search_notes") {
      const query = requiredString(args.query, "query");
      return toolResult(await operations.search(query, boundedInteger(args.limit, 10, 1, MAX_SEARCH_RESULTS)));
    }
    if (name === "read_note") {
      const target = requiredString(args.target, "target");
      return toolResult(await operations.read(target, optionalInteger(args.from_line, 1), optionalInteger(args.max_lines, MAX_READ_LINES)));
    }
    return toolError(`Unknown Exo tool: ${name || "(missing name)"}`);
  } catch (cause) {
    return toolError(cause instanceof Error ? cause.message : String(cause));
  }
}

function toolResult(value: unknown): JsonRecord {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): JsonRecord {
  return { content: [{ type: "text", text: message }], isError: true };
}

function jsonRpcResult(id: JsonRpcId, result: JsonRecord): JsonRecord {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRecord {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optionalInteger(value: unknown, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  return boundedInteger(value, maximum, 1, maximum);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  return parsed;
}
