import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";

import { createExoMcpServer } from "./index";

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
});
