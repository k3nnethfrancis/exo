import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = path.join(packageRoot, "bin", "exo-mcp.mjs");

describe("exo-mcp stdio launcher", () => {
  it("fails clearly when the built MCP artifact is missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-launcher-"));
    try {
      const tempBin = path.join(tempRoot, "bin");
      await mkdir(tempBin, { recursive: true });
      await writeFile(path.join(tempBin, "exo-mcp.mjs"), await readFile(launcherPath, "utf8"));

      const result = spawnSync(process.execPath, [path.join(tempBin, "exo-mcp.mjs")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("missing built MCP entry");
      expect(result.stderr).toContain("pnpm --filter @exo/mcp build");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("responds to MCP initialize through the packaged launcher", async () => {
    const buildResult = spawnSync("pnpm", ["--dir", packageRoot, "build"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(buildResult.status, buildResult.stderr || buildResult.stdout).toBe(0);

    const client = new Client({ name: "exo-mcp-handshake-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [launcherPath],
      env: { COREPACK_ENABLE_PROJECT_SPEC: "0" },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    try {
      await client.connect(transport, { timeout: 15_000 });

      expect(client.getServerVersion()).toMatchObject({ name: "exo" });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "close_preview",
        "create_agent",
        "focus_preview",
        "interrupt_agent",
        "list_agents",
        "open_preview",
        "read_agent",
        "read_document",
        "search",
        "send_agent_message",
        "terminate_agent",
        "workspace_status",
      ]);
      const readAgentTool = tools.tools.find((tool) => tool.name === "read_agent");
      const readAgentSchema = readAgentTool?.inputSchema as
        | { properties?: Record<string, Record<string, unknown>> }
        | undefined;
      const maxLinesSchema = readAgentSchema?.properties?.maxLines ?? {};
      expect(maxLinesSchema.maximum).not.toBe(1000);
      const createAgentTool = tools.tools.find((tool) => tool.name === "create_agent");
      const createAgentSchema = createAgentTool?.inputSchema as
        | { properties?: Record<string, Record<string, unknown>> }
        | undefined;
      expect(createAgentSchema?.properties?.kind).toMatchObject({ type: "string" });
      expect(createAgentSchema?.properties?.kind?.enum).toBeUndefined();
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${stderr}`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 20_000);

  it("responds to MCP initialize through the packaged HTTP transport", async () => {
    const buildResult = spawnSync("pnpm", ["--dir", packageRoot, "build"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(buildResult.status, buildResult.stderr || buildResult.stdout).toBe(0);

    const child = spawn(process.execPath, [launcherPath, "--transport", "http", "--host", "127.0.0.1", "--port", "0"], {
      env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrChunks: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));

    const client = new Client({ name: "exo-mcp-http-handshake-test", version: "0.0.0" });

    try {
      const url = await waitForHttpEndpoint(child);
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport, { timeout: 15_000 });

      expect(client.getServerVersion()).toMatchObject({ name: "exo" });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "close_preview",
        "create_agent",
        "focus_preview",
        "interrupt_agent",
        "list_agents",
        "open_preview",
        "read_agent",
        "read_document",
        "search",
        "send_agent_message",
        "terminate_agent",
        "workspace_status",
      ]);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${stderrChunks.join("")}`);
    } finally {
      await client.close().catch(() => undefined);
      child.kill("SIGTERM");
    }
  }, 20_000);
});

function waitForHttpEndpoint(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Exo MCP HTTP endpoint.\nstdout:\n${output}`));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onStdout = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/streamable http listening on (http:\/\/[^\s]+)/);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Exo MCP HTTP process exited before listening: code=${code ?? "null"} signal=${signal ?? "null"}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    child.stdout?.on("data", onStdout);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}
