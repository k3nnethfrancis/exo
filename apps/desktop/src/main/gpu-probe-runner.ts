import { BrowserWindow, type App } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { GpuStartupPolicy } from "./gpu-startup-policy";

interface StandaloneGraphGpuProbeOptions {
  app: App;
  currentDirectory: string;
  outputPath: string;
  gpuStartupPolicy: GpuStartupPolicy;
}

const PROBE_TIMEOUT_MS = 30_000;
const INSPECTED_SWITCHES = [
  "disable-gpu",
  "disable-gpu-compositing",
  "disable-zero-copy",
  "enable-unsafe-webgpu",
  "enable-features",
  "disable-features",
  "use-angle",
] as const;

export async function runStandaloneGraphGpuProbe(options: StandaloneGraphGpuProbeOptions): Promise<void> {
  const window = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  let result: unknown;
  let harnessError: string | undefined;
  try {
    await window.loadFile(path.join(options.currentDirectory, "../renderer/gpu-probe.html"));
    result = await waitForProbeResult(window);
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error);
  }

  const switches = Object.fromEntries(INSPECTED_SWITCHES.map((name) => [name, {
    enabled: options.app.commandLine.hasSwitch(name),
    value: options.app.commandLine.getSwitchValue(name),
  }]));
  const launchArguments = process.argv.slice(1);
  const exoFeatureOverrideArguments = launchArguments.filter((argument) =>
    /^--(?:enable|disable)-features(?:=|$)/.test(argument)
    || /^--enable-unsafe-webgpu(?:=|$)/.test(argument)
    || /^--use-angle(?:=|$)/.test(argument));
  const metadata = {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: options.app.isPackaged,
    appPath: options.app.getAppPath(),
    gpuStartupPolicy: options.gpuStartupPolicy,
    gpuFeatureStatus: options.app.getGPUFeatureStatus(),
    gpuInfo: await options.app.getGPUInfo("basic").catch((error) => ({ error: String(error) })),
    launchArguments,
    exoFeatureOverrideArguments,
    switches,
  };
  const report = {
    version: "0.1",
    capturedAt: new Date().toISOString(),
    metadata,
    ...(harnessError ? { harnessError } : { result }),
  };
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  window.destroy();
  const status = isSuccessfulProbe(result) && exoFeatureOverrideArguments.length === 0 ? 0 : 1;
  options.app.exit(status);
}

async function waitForProbeResult(window: BrowserWindow): Promise<unknown> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (window.isDestroyed()) throw new Error("The WebGPU probe window closed before producing a result.");
    const result = await window.webContents.executeJavaScript("globalThis.__exoGraphGpuProbeResult ?? null", true);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The WebGPU probe did not finish within ${PROBE_TIMEOUT_MS} ms.`);
}

function isSuccessfulProbe(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "success");
}
