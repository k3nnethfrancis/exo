#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = path.join(mcpRoot, "dist/index.cjs");

if (!existsSync(builtEntry)) {
  console.error(`[exo-mcp] missing built MCP entry: ${builtEntry}`);
  console.error("[exo-mcp] run `pnpm --filter @exo/mcp build` before starting the MCP server.");
  process.exit(1);
}

const { runCli, runServer } = await import(builtEntry);
await (runCli ?? runServer)(process.argv);
