import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";

import { createExoMcpServer } from "./index";
import { captureFakeHarnessTraceFixture, SemanticTraceStore } from "@exo/core/semantic-trace-store";

const tempPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("Exo MCP server tools", () => {
  it("does not advertise a hidden read_agent maxLines cap", () => {
    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { inputSchema?: z.ZodType }>;
    };
    const readAgentSchema = server._registeredTools.read_agent?.inputSchema;
    const jsonSchema = readAgentSchema ? z.toJSONSchema(readAgentSchema) : {};
    const maxLinesSchema = (jsonSchema as { properties?: Record<string, Record<string, unknown>> }).properties?.maxLines ?? {};

    expect(maxLinesSchema.maximum).not.toBe(1000);
  });

  it("returns structured command-server diagnostics for app-backed tool failures", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-tool-"));
    tempPaths.push(runtimeRoot);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: 55432, pid: 999_993 }), "utf8");
    vi.spyOn(process, "kill").mockImplementation(() => {
      const error = new Error("operation not permitted") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("fetch failed"))));
    vi.stubEnv("EXO_RUNTIME_ROOT", runtimeRoot);
    vi.stubEnv("EXO_MCP_REQUEST_TIMEOUT_MS", "5");

    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { handler?: (args: Record<string, unknown>) => Promise<unknown> }>;
    };
    const result = await server._registeredTools.workspace_status.handler?.({});

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: "exo-command-server-unavailable",
        runtimeDiagnostic: {
          kind: "process-check-blocked",
          runtimeRoot,
          serverJsonPath: path.join(runtimeRoot, "server.json"),
          snapshot: {
            info: { port: 55432, pid: 999_993 },
            processCheck: { status: "blocked", code: "EPERM", message: "operation not permitted" },
          },
        },
      },
    });
  });

  it("returns structured unsupported-harness errors from create_agent", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-create-agent-"));
    tempPaths.push(runtimeRoot);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: 55433, pid: process.pid }), "utf8");
    let createBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = new URL(String(input));
      if (targetUrl.pathname === "/status") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (targetUrl.pathname === "/terminals" && init?.method === "POST") {
        createBody = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        return Promise.resolve(jsonResponse({
          ok: false,
          code: "unsupported-agent-harness",
          harnessId: "test.command-server-only",
          error: "Agent harness is not approved for mcp launch: test.command-server-only. Approved launchable harnesses for mcp: shell|claude|codex.",
        }, 400));
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }));
    vi.stubEnv("EXO_RUNTIME_ROOT", runtimeRoot);

    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { handler?: (args: Record<string, unknown>) => Promise<unknown> }>;
    };
    const result = await server._registeredTools.create_agent.handler?.({ kind: "test.command-server-only" });

    expect(createBody).toMatchObject({ harnessId: "test.command-server-only", kind: "test.command-server-only", callerSurface: "mcp" });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: "unsupported-agent-harness",
        harnessId: "test.command-server-only",
        commandServerStatus: 400,
        commandServerError: expect.stringContaining("Agent harness is not approved for mcp launch"),
      },
    });
  });

  it("can read trace-backed agent answers without terminal capture", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-trace-agent-"));
    tempPaths.push(runtimeRoot);
    await captureFakeHarnessTraceFixture(new SemanticTraceStore(runtimeRoot), {
      sessionId: "fake-pi-session",
      harnessId: "fake-pi",
      rawEvents: [{ type: "assistant-text", text: "PI_FIXTURE_ANSWER OK" }],
      now: () => "2026-07-03T16:00:00.000Z",
    });
    vi.stubEnv("EXO_RUNTIME_ROOT", runtimeRoot);

    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { handler?: (args: Record<string, unknown>) => Promise<unknown> }>;
    };
    const result = await server._registeredTools.read_agent.handler?.({
      agentId: "fake-pi-session",
      source: "trace",
    });

    expect(result).toMatchObject({
      content: [{ type: "text", text: "PI_FIXTURE_ANSWER OK" }],
      structuredContent: {
        agentId: "fake-pi-session",
        output: "PI_FIXTURE_ANSWER OK",
        source: "trace",
      },
    });
  });

  it("cleans default terminal reads while preserving clean false raw output", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-read-agent-"));
    tempPaths.push(runtimeRoot);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: 55434, pid: process.pid }), "utf8");
    const transcript = "\u001b(0lqqk\u001b(B\r⠋ Thinking\r\u001b[2K\u001b(0x\u001b(B Ready \u001b(0x\u001b(B\n";
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const targetUrl = new URL(String(input));
      if (targetUrl.pathname === "/status") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (targetUrl.pathname === "/config") {
        return Promise.resolve(jsonResponse({ terminalReadTailChars: 20_000, terminalMaxReadTailChars: 200_000 }));
      }
      if (targetUrl.pathname === "/terminals/term-1/transcript") {
        return Promise.resolve(jsonResponse({ transcript }));
      }
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }));
    vi.stubEnv("EXO_RUNTIME_ROOT", runtimeRoot);

    const server = createExoMcpServer() as unknown as {
      _registeredTools: Record<string, { handler?: (args: Record<string, unknown>) => Promise<unknown> }>;
    };

    await expect(server._registeredTools.read_agent.handler?.({ agentId: "term-1" })).resolves.toMatchObject({
      content: [{ type: "text", text: "│ Ready │\n" }],
      structuredContent: { output: "│ Ready │\n" },
    });
    await expect(server._registeredTools.read_agent.handler?.({ agentId: "term-1", clean: false })).resolves.toMatchObject({
      content: [{ type: "text", text: transcript }],
      structuredContent: { output: transcript },
    });
  });
});

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
