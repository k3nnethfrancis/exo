import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export function electronPlatformPath(platform) {
  switch (platform) {
    case "darwin":
    case "mas":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

export function ensureElectronRuntime({
  electronDirectory,
  install,
  platform = process.env.npm_config_platform || process.platform,
}) {
  const platformPath = electronPlatformPath(platform);
  const pathFile = path.join(electronDirectory, "path.txt");
  const binaryPath = path.join(electronDirectory, "dist", platformPath);

  if (isFile(binaryPath)) {
    if (readPathFile(pathFile) !== platformPath) {
      writeFileSync(pathFile, platformPath);
    }
  } else {
    install();
  }

  if (readPathFile(pathFile) !== platformPath || !isFile(binaryPath)) {
    throw new Error(
      `Electron runtime is incomplete after installation: expected ${binaryPath} and ${pathFile} -> ${platformPath}`,
    );
  }

  return binaryPath;
}

function readPathFile(pathFile) {
  try {
    return readFileSync(pathFile, "utf8");
  } catch {
    return null;
  }
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
