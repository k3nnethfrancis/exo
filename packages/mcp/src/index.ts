#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { ExoCommandClient, formatAgents, stripAnsi } from "./exo-client";

const server = new McpServer({
  name: "exo",
  version: "0.1.0",
});

server.registerTool(
  "workspace_status",
  {
    title: "Workspace Status",
    description: "Show Exo workspace roots, indexed roots, and runtime status.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const status = await client.getStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "index_status",
  {
    title: "Index Status",
    description: "Show Exo's QMD-backed knowledge index status. pendingEmbeddings > 0 means semantic/hybrid search may use lexical fallback until sync_index completes.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const status = await client.getIndexStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status,
    };
  },
);

server.registerTool(
  "sync_index",
  {
    title: "Sync Index",
    description: "Synchronize Exo's configured knowledge index. Refreshes documents and, for semantic/hybrid modes, builds embeddings. Search remains safe to call during sync and reports fallback warnings.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const result = await client.syncIndex();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "search",
  {
    title: "Search Exo",
    description: "Search Exo's configured knowledge index. Safe while indexing/embeddings are running; returns warnings when using lexical or filesystem fallback.",
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
    description: "Read a document by filesystem path or Exo/QMD docid.",
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
  "list_project_roots",
  {
    title: "List Project Roots",
    description: "List project folders currently attached to the running Exo workspace.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async () => {
    const client = await ExoCommandClient.connect();
    const projectRoots = await client.listProjectRoots();
    return {
      content: [{ type: "text", text: JSON.stringify({ projectRoots }, null, 2) }],
      structuredContent: { projectRoots },
    };
  },
);

server.registerTool(
  "add_project_root",
  {
    title: "Add Project Root",
    description: "Attach a project folder to the running Exo workspace. Use explicit, narrow project folders rather than broad parent directories.",
    inputSchema: {
      path: z.string().min(1).describe("Absolute project folder path to attach."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ path }) => {
    const client = await ExoCommandClient.connect();
    const settings = await client.addProjectRoot(path);
    return {
      content: [{ type: "text", text: JSON.stringify(settings, null, 2) }],
      structuredContent: settings,
    };
  },
);

server.registerTool(
  "remove_project_root",
  {
    title: "Remove Project Root",
    description: "Detach a project folder from the running Exo workspace. This only changes Exo workspace settings; it does not delete files.",
    inputSchema: {
      path: z.string().min(1).describe("Project folder path to detach."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ path }) => {
    const client = await ExoCommandClient.connect();
    const settings = await client.removeProjectRoot(path);
    return {
      content: [{ type: "text", text: JSON.stringify(settings, null, 2) }],
      structuredContent: settings,
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
    description: "Create a new Exo-managed terminal session. Supports shell, Claude, and Codex sessions.",
    inputSchema: {
      kind: z.enum(["shell", "claude", "codex"]).describe("Type of terminal session to create."),
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
    const client = await ExoCommandClient.connect();
    const agent = await client.createAgent(kind, cwd);
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
    description: "Read buffered terminal output for one Exo agent. This is read-only.",
    inputSchema: {
      agentId: z.string().min(1).describe("Agent id from list_agents, for example term-3."),
      tailChars: z.number().int().positive().max(200_000).default(20_000).describe("Maximum characters to return from the end of the buffer."),
      clean: z.boolean().default(true).describe("Strip ANSI terminal escape codes before returning output."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ agentId, tailChars, clean }) => {
    const client = await ExoCommandClient.connect();
    const rawOutput = await client.readAgent(agentId, tailChars);
    const output = clean ? stripAnsi(rawOutput) : rawOutput;
    return {
      content: [{ type: "text", text: output || "(no buffered output)" }],
      structuredContent: { agentId, output },
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
    const text = result.delivery === "queued"
      ? `Queued message for ${agentId} until the agent is ready (${result.queuedInputCount ?? 1} pending).`
      : `Sent ${submit ? "message plus Enter" : "message without Enter"} to ${agentId}.`;
    return {
      content: [{ type: "text", text }],
      structuredContent: { agentId, submitted: submit, delivery: result.delivery, queuedInputCount: result.queuedInputCount ?? 0 },
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

export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  runServer().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
