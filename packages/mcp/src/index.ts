#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { once } from "node:events";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS, DEFAULT_TERMINAL_READ_TAIL_CHARS } from "@exo/core/terminal-settings";
import { semanticTraceEventsToAgentAnswerText } from "@exo/core/semantic-trace";
import { SemanticTraceStore } from "@exo/core/semantic-trace-store";
import {
  isMcpToolExposed,
  isControlPlaneExposureProfile,
  isKnownMcpToolName,
  parseMcpCustomToolList,
  type ControlPlaneExposureProfile,
} from "@exo/core/control-plane-catalog";
import {
  formatRegisteredAgentHarnessUsage,
} from "@exo/core/agent-harness-registry";
import * as z from "zod/v4";

import { ExoCommandClient, ExoCommandDiscoveryError, ExoCommandServerHttpError, formatAgents, resolveMcpRuntimeRoot, stripAnsi } from "./exo-client";

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
  registerExoTools(server, mcpExposureFromEnv(process.env));
  return server;
}

type McpExposure = {
  profile: ControlPlaneExposureProfile;
  customTools: string[];
};

function warnMcpExposure(message: string) {
  console.warn(`[exo:mcp] ${message}`);
}

function mcpExposureFromEnv(env: NodeJS.ProcessEnv): McpExposure {
  const rawProfile = env.EXO_MCP_EXPOSURE_PROFILE?.trim();
  let profile: ControlPlaneExposureProfile;
  if (!rawProfile) {
    profile = "dev";
  } else if (isControlPlaneExposureProfile(rawProfile)) {
    profile = rawProfile;
  } else {
    // Fail closed on typos. A misspelled narrowing profile must not silently expose the dev surface.
    warnMcpExposure(`Unknown EXO_MCP_EXPOSURE_PROFILE=${JSON.stringify(rawProfile)}; registering no MCP tools.`);
    profile = "off";
  }

  const requestedCustomTools = parseMcpCustomToolList(env.EXO_MCP_TOOLS);
  if (profile === "custom") {
    const unknownTools = requestedCustomTools.filter((tool) => !isKnownMcpToolName(tool));
    if (unknownTools.length > 0) {
      warnMcpExposure(`Ignoring unknown EXO_MCP_TOOLS entries: ${unknownTools.join(", ")}`);
    }
  }

  return {
    profile,
    customTools: requestedCustomTools,
  };
}

function registerExoTools(server: McpServer, exposure: McpExposure) {
  const registerTool = ((name: string, config: unknown, callback: unknown) => {
    if (!isMcpToolExposed(name, exposure.profile, exposure.customTools)) {
      return undefined as never;
    }
    return (server.registerTool as (toolName: string, toolConfig: unknown, toolCallback: unknown) => unknown)(name, config, callback);
  }) as McpServer["registerTool"];

  registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const status = await client.getStatus();
      const indexStatusResult = await optionalCommandServerRead("indexStatus", () => client.getIndexStatus());
      const terminalDiagnosticsResult = await optionalCommandServerRead("terminalDiagnostics", () => client.terminalDiagnostics());
      const terminals = (status as { terminals?: unknown }).terminals;
      const workspaceStatus = buildWorkspaceStatusOrientation({
        status,
        indexStatus: indexStatusResult.value,
        indexStatusError: indexStatusResult.error,
        terminalDiagnostics: terminalDiagnosticsResult.value,
        terminalDiagnosticsError: terminalDiagnosticsResult.error,
        commandServerBaseUrl: client.baseUrl,
        agents: Array.isArray(terminals) ? terminals : [],
      });
      return {
        content: [{ type: "text", text: JSON.stringify(workspaceStatus, null, 2) }],
        structuredContent: workspaceStatus,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const results = await client.search(query, { limit, intent, includeContent, maxLinesPerResult });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        structuredContent: results,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const document = await client.readDocument(target, { fromLine, maxLines });
      return {
        content: [{ type: "text", text: JSON.stringify(document, null, 2) }],
        structuredContent: document,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
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
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const result = await client.focusPreview();
      return {
        content: [{ type: "text", text: "Focused preview pane." }],
        structuredContent: result,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const result = await client.closePreview();
      return {
        content: [{ type: "text", text: "Closed preview pane." }],
        structuredContent: result,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const agents = await client.listAgents();
      return {
        content: [{ type: "text", text: formatAgents(agents) }],
        structuredContent: { agents },
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const agent = await client.createAgent(kind, cwd);
      return {
        content: [{ type: "text", text: `Created ${agent.kind} agent ${agent.id} in ${agent.cwd}.` }],
        structuredContent: { agent },
      };
    });
  },
);

registerTool(
  "read_agent",
  {
    title: "Read Exo Agent",
    description: "Read terminal live-tail/transcript output by default, or trace-backed semantic answer text with source: \"trace\". This is read-only.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
      maxLines: z.number().int().positive().optional().describe("Maximum live terminal lines to return, bounded by Exo's configured terminal history lines. Prefer this for reads that should not flood callers."),
      tailChars: z.number().int().nonnegative().optional().describe("Maximum characters to return from the end of the transcript when maxLines is omitted. Omit to use Exo's configured default."),
      clean: z.boolean().default(true).describe("Strip ANSI terminal escape codes before returning terminal output."),
      source: z.enum(["terminal", "trace"]).default("terminal").describe("Read the terminal transcript/live tail, or read semantic agent answer text from persisted traces."),
      traceLimit: z.number().int().positive().optional().describe("Maximum semantic trace events to inspect when source is trace. Defaults to 100."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ agentId, maxLines, tailChars, clean, source, traceLimit }) => {
    return runAppBackedTool(async () => {
      if (source === "trace") {
        const store = new SemanticTraceStore(await resolveMcpRuntimeRoot(process.env));
        const events = await store.readEvents(agentId, { limit: traceLimit ?? 100 });
        const output = semanticTraceEventsToAgentAnswerText(events);
        return {
          content: [{ type: "text", text: output || "(no trace-backed semantic answer output)" }],
          structuredContent: { agentId, output, source: "trace", traceLimit: traceLimit ?? 100 },
        };
      }
      const client = await ExoCommandClient.connect();
      const config = await client.getConfig();
      const configuredDefault = readNonNegativeInteger(config.terminalReadTailChars, DEFAULT_TERMINAL_READ_TAIL_CHARS);
      const configuredMax = readNonNegativeInteger(config.terminalMaxReadTailChars, DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS);
      const requestedTailChars = tailChars ?? configuredDefault;
      const effectiveTailChars = configuredMax > 0 && requestedTailChars > 0
        ? Math.min(requestedTailChars, configuredMax)
        : requestedTailChars;
      const rawOutput = maxLines ? await client.readAgentTail(agentId, maxLines) : await client.readAgent(agentId, effectiveTailChars);
      const output = clean !== false ? stripAnsi(rawOutput) : rawOutput;
      return {
        content: [{ type: "text", text: output || "(no terminal transcript/live-tail output)" }],
        structuredContent: { agentId, output, source: "terminal", maxLines, tailChars: maxLines ? undefined : effectiveTailChars },
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      const result = await client.sendAgentMessage(agentId, message, submit);
      const text = formatAgentMessageDelivery(agentId, submit, result);
      return {
        content: [{ type: "text", text }],
        structuredContent: { agentId, submitted: submit, delivery: result.delivery, queuedInputCount: result.queuedInputCount ?? 0 },
        isError: result.delivery === "not-found" || result.ok === false,
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      await client.killAgent(agentId);
      return {
        content: [{ type: "text", text: `Terminated ${agentId}.` }],
        structuredContent: { agentId, terminated: true },
      };
    });
  },
);

registerTool(
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
    return runAppBackedTool(async () => {
      const client = await ExoCommandClient.connect();
      await client.sendAgentInput(agentId, signal === "ctrl-c" ? "\u0003" : "\u001b");
      return {
        content: [{ type: "text", text: `Sent ${signal} to ${agentId}.` }],
        structuredContent: { agentId, signal },
      };
    });
  },
);
}

type McpToolContent = { type: "text"; text: string };

type McpToolResult = {
  content: McpToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type OptionalReadResult<T> = { value: T; error?: undefined } | { value: undefined; error: string };

async function optionalCommandServerRead<T>(label: string, read: () => Promise<T>): Promise<OptionalReadResult<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: undefined, error: `${label}: ${message}` };
  }
}

function buildWorkspaceStatusOrientation(input: {
  status: Record<string, unknown>;
  indexStatus?: Record<string, unknown>;
  indexStatusError?: string;
  terminalDiagnostics?: Record<string, unknown>[];
  terminalDiagnosticsError?: string;
  commandServerBaseUrl: string;
  agents: unknown[];
}): Record<string, unknown> {
  const workspaceModel = objectRecord(input.status.workspace);
  const roots = workspaceRoots(workspaceModel);
  const agents = input.agents.filter((agent): agent is Record<string, unknown> => Boolean(agent && typeof agent === "object"));
  const terminalDiagnostics = input.terminalDiagnostics ?? [];
  const degradedMessages = [
    ...stringsAt(input.indexStatus?.errors),
    ...stringsAt(input.indexStatus?.warnings),
    ...terminalDegradedMessages(terminalDiagnostics),
    input.indexStatusError,
    input.terminalDiagnosticsError,
  ].filter((message): message is string => Boolean(message));

  const workspaceStatus: Record<string, unknown> = {
    ...input.status,
    ok: true,
    workspaceModel,
    workspaceRoots: roots,
    noteRoots: roots.noteRoots,
    projectRoots: roots.projectRoots,
    indexedRoots: Array.isArray(input.indexStatus?.indexedRoots)
      ? input.indexStatus.indexedRoots
      : Array.isArray(workspaceModel?.indexedRoots) ? workspaceModel.indexedRoots : [],
    indexStatus: input.indexStatus ?? {
      available: false,
      error: input.indexStatusError ?? "index status unavailable",
    },
    indexSummary: indexSummary(input.indexStatus, input.indexStatusError),
    searchProviderReadiness: searchProviderReadiness(input.indexStatus, input.indexStatusError),
    pluginReadiness: {
      searchProviders: [searchProviderReadiness(input.indexStatus, input.indexStatusError)],
      note: "MCP reports plugin readiness only from data already exposed through the command server.",
    },
    agents,
    liveAgents: agents,
    terminalSessions: terminalSessionSummary(agents, terminalDiagnostics, input.terminalDiagnosticsError),
    commandServer: {
      health: "reachable",
      baseUrl: input.commandServerBaseUrl,
      degraded: degradedMessages.length > 0,
      degradedMessages,
    },
    diagnostics: {
      degradedMessages,
      optionalReads: {
        indexStatus: input.indexStatusError ? { ok: false, error: input.indexStatusError } : { ok: true },
        terminalDiagnostics: input.terminalDiagnosticsError ? { ok: false, error: input.terminalDiagnosticsError } : { ok: true },
      },
    },
  };

  return workspaceStatus;
}

function workspaceRoots(workspaceModel: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    workspaceRoot: stringAt(workspaceModel?.workspaceRoot),
    defaultTerminalCwd: stringAt(workspaceModel?.defaultTerminalCwd),
    noteRoots: arrayAt(workspaceModel?.noteRoots),
    projectRoots: arrayAt(workspaceModel?.projectRoots),
  };
}

function indexSummary(indexStatus: Record<string, unknown> | undefined, error?: string): Record<string, unknown> {
  if (!indexStatus) {
    return { available: false, error: error ?? "index status unavailable" };
  }
  const indexedRoots = arrayAt(indexStatus.indexedRoots);
  return {
    available: true,
    enabled: booleanAt(indexStatus.enabled),
    mode: stringAt(indexStatus.mode),
    backend: stringAt(indexStatus.backend),
    indexedRootCount: indexedRoots.length,
    documentCount: numberAt(indexStatus.documentCount),
    pendingEmbeddings: numberAt(indexStatus.pendingEmbeddings),
    hasVectorIndex: booleanAt(indexStatus.hasVectorIndex),
    lastUpdated: stringAt(indexStatus.lastUpdated),
    warnings: stringsAt(indexStatus.warnings),
    errors: stringsAt(indexStatus.errors),
    recentJobs: arrayAt(indexStatus.recentJobs),
  };
}

function searchProviderReadiness(indexStatus: Record<string, unknown> | undefined, error?: string): Record<string, unknown> {
  if (!indexStatus) {
    return {
      provider: "qmd",
      state: "unknown",
      label: "Status unavailable",
      detail: error ?? "Index status could not be read from the command server.",
    };
  }
  const summary = indexSummary(indexStatus);
  const errors = stringsAt(indexStatus.errors);
  const warnings = stringsAt(indexStatus.warnings);
  const indexedRootCount = numberAt(summary.indexedRootCount) ?? 0;
  const mode = stringAt(indexStatus.mode) ?? "off";
  const enabled = booleanAt(indexStatus.enabled) === true;
  const pendingEmbeddings = numberAt(indexStatus.pendingEmbeddings) ?? 0;
  const hasVectorIndex = booleanAt(indexStatus.hasVectorIndex) === true;
  if (!enabled || mode === "off") {
    return { provider: "qmd", state: "disabled", label: "Off", detail: "Advanced QMD search is disabled; MCP search can still use core fallback.", summary };
  }
  if (indexedRootCount === 0) {
    return { provider: "qmd", state: "needsSetup", label: "Needs indexed roots", detail: "No indexed roots are configured.", summary };
  }
  if (errors.length > 0) {
    return { provider: "qmd", state: "error", label: "Index error", detail: errors[0], summary };
  }
  if (pendingEmbeddings > 0) {
    return { provider: "qmd", state: "indexing", label: "Embeddings pending", detail: `${pendingEmbeddings} documents need embeddings.`, summary };
  }
  if (warnings.length > 0 || (mode !== "lexical" && !hasVectorIndex)) {
    return { provider: "qmd", state: "degraded", label: "Degraded", detail: warnings[0] ?? "Vector search is not ready; lexical search may still work.", summary };
  }
  return { provider: "qmd", state: "ready", label: "Ready", detail: "Advanced QMD search is configured for this workspace.", summary };
}

function terminalSessionSummary(
  agents: Record<string, unknown>[],
  diagnostics: Record<string, unknown>[],
  diagnosticsError?: string,
): Record<string, unknown> {
  return {
    count: agents.length,
    running: agents.filter((agent) => agent.status === "running").length,
    exited: agents.filter((agent) => agent.status === "exited").length,
    byKind: countBy(agents, "kind"),
    byHealth: countBy(diagnostics.length > 0 ? diagnostics : agents, "health"),
    diagnosticsAvailable: !diagnosticsError,
    diagnosticsError,
    diagnostics: diagnostics.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      harnessId: entry.harnessId,
      cwd: entry.cwd,
      status: entry.status,
      readiness: entry.readiness,
      readinessDetail: entry.readinessDetail,
      health: entry.health,
      healthDetail: entry.healthDetail,
      runtime: entry.runtime,
      bridgeStatus: entry.bridgeStatus,
      paneStatus: entry.paneStatus,
      geometry: objectRecord(entry.geometry)
        ? {
            divergent: objectRecord(entry.geometry)?.divergent,
            divergentSinceMs: objectRecord(entry.geometry)?.divergentSinceMs,
          }
        : undefined,
      lastInputAt: entry.lastInputAt,
      lastOutputAt: entry.lastOutputAt,
      transcriptPath: entry.transcriptPath,
    })),
  };
}

function terminalDegradedMessages(diagnostics: Record<string, unknown>[]): string[] {
  return diagnostics.flatMap((entry) => {
    const messages: string[] = [];
    const id = stringAt(entry.id) ?? "terminal";
    const health = stringAt(entry.health);
    const paneStatus = stringAt(entry.paneStatus);
    const bridgeStatus = stringAt(entry.bridgeStatus);
    const geometry = objectRecord(entry.geometry);
    if (health === "unhealthy") {
      messages.push(`${id}: ${stringAt(entry.healthDetail) ?? "terminal health is unhealthy"}`);
    }
    if (paneStatus && paneStatus !== "alive") {
      messages.push(`${id}: tmux pane status is ${paneStatus}`);
    }
    if (bridgeStatus && bridgeStatus !== "attached") {
      messages.push(`${id}: terminal bridge is ${bridgeStatus}`);
    }
    if (geometry?.divergent === true) {
      messages.push(`${id}: terminal geometry is divergent`);
    }
    return messages;
  });
}

function countBy(items: Record<string, unknown>[], key: string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = stringAt(item[key]);
    if (value) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayAt(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringsAt(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringAt(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanAt(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function runAppBackedTool(work: () => Promise<McpToolResult>): Promise<McpToolResult> {
  try {
    return await work();
  } catch (error) {
    return mcpToolError(error);
  }
}

function mcpToolError(error: unknown): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const structuredContent: Record<string, unknown> = {
    ok: false,
    error: message,
  };
  if (error instanceof ExoCommandDiscoveryError) {
    structuredContent.error = "exo-command-server-unavailable";
    structuredContent.runtimeDiagnostic = error.diagnostic;
  }
  if (error instanceof ExoCommandServerHttpError && error.payload?.code === "unsupported-agent-harness") {
    structuredContent.error = "unsupported-agent-harness";
    structuredContent.harnessId = error.payload.harnessId;
    structuredContent.commandServerStatus = error.status;
    structuredContent.commandServerError = error.payload.error ?? message;
  }
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
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
