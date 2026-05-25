#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exoRoot = path.resolve(mcpRoot, "../..");

const build = spawnSync("pnpm", ["--silent", "--dir", exoRoot, "--filter", "@exo/mcp", "build"], {
  stdio: ["ignore", "ignore", "inherit"],
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const { runServer } = await import(path.join(mcpRoot, "dist/index.cjs"));
await runServer();
