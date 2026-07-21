#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(path.join(repoRoot, "apps/desktop/package.json"));
const electronPath = desktopRequire("electron");
const args = process.argv.slice(2);
const modes = selectedModes(args);
const explicitApp = optionValue(args, "--app");
const outputPath = optionValue(args, "--output");
const records = [];

for (const mode of modes) records.push(await runProbe(mode, explicitApp));

const report = {
  version: "0.1",
  capturedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, release: os.release() },
  records,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(output);
if (outputPath) {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), output, "utf8");
}
if (records.some((record) => record.exitCode !== 0
  || record.report.harnessError
  || record.report.result?.status !== "success"
  || record.report.metadata?.exoFeatureOverrideArguments?.length > 0)) {
  process.exitCode = 1;
}

async function runProbe(mode, explicitAppPath) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), `exo-webgpu-${mode}-`));
  const resultPath = path.join(fixtureRoot, "probe.json");
  const executable = mode === "packaged" ? resolvePackagedExecutable(explicitAppPath) : electronPath;
  const launchArgs = mode === "packaged" ? [] : [path.join(repoRoot, "apps/desktop/dist/main/index.js")];
  const child = spawn(executable, launchArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      EXO_GPU_PROBE_OUTPUT: resultPath,
      EXO_USER_DATA_PATH: path.join(fixtureRoot, "user-data"),
      EXO_RUNTIME_ROOT: path.join(fixtureRoot, "runtime"),
      HOME: fixtureRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk.toString()); });
  child.stdout.on("data", () => {});
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => signal ? reject(new Error(`${mode} probe stopped by ${signal}`)) : resolve(code ?? 1));
  });
  try {
    const report = JSON.parse(await readFile(resultPath, "utf8"));
    return { mode, executable, exitCode, stderr, report };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function boundedAppend(current, next) {
  const combined = `${current}${next}`;
  return combined.length <= 4_000 ? combined : combined.slice(-4_000);
}

function resolvePackagedExecutable(explicitPath) {
  const candidate = explicitPath
    ? path.resolve(explicitPath)
    : path.join(repoRoot, "release", `mac-${process.arch}`, "Exo.app");
  return candidate.endsWith(".app") ? path.join(candidate, "Contents", "MacOS", "Exo") : candidate;
}

function selectedModes(values) {
  const modes = [];
  if (values.includes("--source")) modes.push("source");
  if (values.includes("--packaged")) modes.push("packaged");
  if (modes.length === 0) throw new Error("Choose --source, --packaged, or both.");
  return modes;
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}
