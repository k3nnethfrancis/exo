#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.EXO_PRIVATE_GRAPH_VAULT_ROOT;
const confirmation = process.env.EXO_PRIVATE_GRAPH_GATE;
const sourceOnly = process.argv.includes("--source-only");
const packagedOnly = process.argv.includes("--packaged-only");

if (sourceOnly && packagedOnly) fail("Choose only one private graph gate runtime mode.");
if (confirmation !== "copy-only" || !sourceRoot || !path.isAbsolute(sourceRoot)) {
  fail("Set an absolute EXO_PRIVATE_GRAPH_VAULT_ROOT and EXO_PRIVATE_GRAPH_GATE=copy-only.");
}
try {
  if (!statSync(sourceRoot).isDirectory()) fail("The configured private graph vault is not a directory.");
} catch {
  fail("The configured private graph vault could not be validated.");
}

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "exo-private-graph-gate-"));
const reports = [];
const buildEnvironment = { ...process.env };
delete buildEnvironment.EXO_PRIVATE_GRAPH_VAULT_ROOT;
delete buildEnvironment.EXO_PRIVATE_GRAPH_GATE;

try {
  if (!packagedOnly) {
    runVisible("pnpm", ["--filter", "@exo/desktop", "build"], buildEnvironment);
    reports.push(runGate("source", path.join(temporaryRoot, "source.json")));
  }

  if (!sourceOnly) {
    runVisible("pnpm", ["pack:mac"], buildEnvironment);
    const appPath = path.join(repoRoot, "release", "mac-arm64", "Exo.app");
    if (!existsSync(appPath)) fail("The exact packaged Exo.app was not produced.");
    reports.push(runGate("packaged", path.join(temporaryRoot, "packaged.json"), appPath));
  }

  const summary = {
    schemaVersion: 1,
    result: "pass",
    runtimes: reports,
  };
  process.stdout.write(`Private graph gate aggregate: ${JSON.stringify(summary)}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function runGate(runtime, reportPath, packagedAppPath) {
  const environment = {
    ...process.env,
    EXO_PRIVATE_GRAPH_REPORT_PATH: reportPath,
    ...(packagedAppPath ? { EXO_PACKAGED_APP_PATH: packagedAppPath } : {}),
  };
  if (!packagedAppPath) delete environment.EXO_PACKAGED_APP_PATH;
  const result = spawnSync(
    "pnpm",
    ["--filter", "@exo/desktop", "exec", "playwright", "test", "--config", "playwright.private-vault.config.ts"],
    {
      cwd: repoRoot,
      env: environment,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const phase = result.stdout?.match(/Private graph gate failed during ([a-z-]+)\./u)?.[1]
      ?? result.stderr?.match(/Private graph gate failed during ([a-z-]+)\./u)?.[1]
      ?? "redacted-journey";
    fail(`Private graph ${runtime} gate failed during ${phase}.`);
  }
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    fail(`Private graph ${runtime} gate did not produce a redacted aggregate.`);
  }
}

function runVisible(command, args, environment) {
  const result = spawnSync(command, args, { cwd: repoRoot, env: environment, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args[0] ?? ""} failed before private data entered the process.`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
