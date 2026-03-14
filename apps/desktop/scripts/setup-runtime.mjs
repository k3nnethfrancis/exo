import { chmodSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

const electronPackage = require.resolve("electron/package.json");
const electronDirectory = path.dirname(electronPackage);
const electronInstallScript = path.join(electronDirectory, "install.js");
const electronDist = path.join(electronDirectory, "dist");

if (!existsSync(electronDist)) {
  execFileSync(process.execPath, [electronInstallScript], {
    stdio: "inherit",
  });
}

const nodePtyPackage = require.resolve("node-pty/package.json");
const nodePtyDirectory = path.dirname(nodePtyPackage);
const helperPath = path.join(nodePtyDirectory, "prebuilds", `${os.platform()}-${os.arch()}`, "spawn-helper");

if (existsSync(helperPath)) {
  chmodSync(helperPath, 0o755);
}
