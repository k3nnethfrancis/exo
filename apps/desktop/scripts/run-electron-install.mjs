import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

import {
  electronInstallStrategy,
  electronPlatformPath,
  resolveElectronDownloadArch,
} from "./electron-runtime.mjs";

const require = createRequire(import.meta.url);
const electronPackage = require.resolve("electron/package.json");
const electronDirectory = path.dirname(electronPackage);
const electronRequire = createRequire(electronPackage);
const platform = process.env.npm_config_platform || process.platform;
if (electronInstallStrategy(platform) === "upstream") {
  execFileSync(process.execPath, [path.join(electronDirectory, "install.js")], { stdio: "inherit" });
} else {
  const { version } = electronRequire("./package.json");
  const { downloadArtifact } = electronRequire("@electron/get");
  const configuredArch = process.env.npm_config_arch;
  let isRosetta = false;
  if (platform === "darwin" && process.arch === "x64" && !configuredArch) {
    try {
      isRosetta = execFileSync("sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8" }).trim() === "1";
    } catch {
      // Native x64 macOS returns no translation flag.
    }
  }
  const arch = resolveElectronDownloadArch({ platform, arch: process.arch, configuredArch, isRosetta });
  const platformPath = electronPlatformPath(platform);
  const dist = path.join(electronDirectory, "dist");
  const archive = await downloadArtifact({
    version,
    artifactName: "electron",
    force: process.env.force_no_cache === "true",
    cacheRoot: process.env.electron_config_cache,
    checksums: process.env.electron_use_remote_checksums || process.env.npm_config_electron_use_remote_checksums
      ? undefined
      : electronRequire("./checksums.json"),
    platform,
    arch,
  });

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  try {
    execFileSync("/usr/bin/ditto", ["-x", "-k", archive, dist], { stdio: "inherit" });
  } catch (error) {
    throw new Error(`Failed to extract Electron ${version} for ${platform}-${arch} with ditto`, { cause: error });
  }
  const extractedTypes = path.join(dist, "electron.d.ts");
  try {
    await rename(extractedTypes, path.join(electronDirectory, "electron.d.ts"));
  } catch {
    // Electron archives normally omit type declarations; preserve upstream's
    // optional relocation behavior without making their absence an error.
  }
  await writeFile(path.join(electronDirectory, "path.txt"), platformPath);
}
