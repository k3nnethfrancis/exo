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
}

async function createOperations(env: NodeJS.ProcessEnv): Promise<ExoMcpOperations> {
  const model = await resolveWorkspace(env);
  const runtimeRoot = env.EXO_RUNTIME_ROOT ?? path.join(model.workspaceRoot, ".exo");
  const client = await AppClient.connect(runtimeRoot, env);
  if (client) {
    return {
      status: async () => workspaceStatus(model, true, await client.getIndexStatus()),
      search: (query, limit) => client.search(query, { limit }),
    };
  }
  return {
    status: async () => workspaceStatus(model, false, await filesystemSearchProvider.getStatus(model, runtimeRoot)),
    search: async (query, limit) => ({ ...await filesystemSearchProvider.search(model, runtimeRoot, query, { limit }) }),
  };
}

function workspaceStatus(model: WorkspaceModel, appAvailable: boolean, search: unknown): JsonRecord {
  return {
    ok: true,
    app: { available: appAvailable },
    workspace: {
      root: model.workspaceRoot,
      noteRoots: model.noteRoots.map((root) => ({ id: root.id, label: root.label, path: root.path })),
      indexing: model.indexing,
    },
    search,
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
      instructions: "Use Exo to orient within the current Markdown workspace. Search returns paths and metadata; use your native file tools only when your own permissions allow it. Exo MCP tools do not read or write notes.",
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
      description: "Describe the current Exo workspace: its roots and indexing configuration, application availability, and retrieval health.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "search_notes",
      description: "Search the current Exo workspace. Returns ranked note metadata including absolute file paths, title, snippet, score, and source. Uses configured retrieval when available, otherwise scoped filesystem search.",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS } },
        required: ["query"],
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

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Expected an integer from ${minimum} to ${maximum}.`);
  return parsed;
}
