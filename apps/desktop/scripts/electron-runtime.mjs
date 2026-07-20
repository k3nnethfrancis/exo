import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const requiredPaths = electronRuntimeRequiredPaths(electronDirectory, platform);

  if (requiredPaths.every(isFile)) {
    if (readPathFile(pathFile) !== platformPath) {
      writeFileSync(pathFile, platformPath);
    }
  } else {
    // Electron's installer trusts path.txt plus the launcher binary. Packaging
    // can leave both while consuming the Framework, so invalidate the marker
    // before installing or the upstream script will incorrectly short-circuit.
    rmSync(pathFile, { force: true });
    install();
  }

  if (readPathFile(pathFile) !== platformPath || !requiredPaths.every(isFile)) {
    throw new Error(
      `Electron runtime is incomplete after installation: expected ${requiredPaths.join(", ")} and ${pathFile} -> ${platformPath}`,
    );
  }

  return binaryPath;
}

export function electronRuntimeRequiredPaths(electronDirectory, platform) {
  const dist = path.join(electronDirectory, "dist");
  const paths = [path.join(dist, electronPlatformPath(platform))];
  if (platform === "darwin" || platform === "mas") {
    paths.push(path.join(
      dist,
      "Electron.app",
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Electron Framework",
    ));
  }
  return paths;
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
