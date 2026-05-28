import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
      expect(tools.tools.map((tool) => tool.name)).toContain("workspace_status");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${stderr}`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 20_000);
});
