import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ensureElectronRuntime } from "./electron-runtime.mjs";

const require = createRequire(import.meta.url);

const electronPackage = require.resolve("electron/package.json");
const electronDirectory = path.dirname(electronPackage);
const electronInstallRunner = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-electron-install.mjs");

ensureElectronRuntime({
  electronDirectory,
  install() {
    execFileSync(process.execPath, [electronInstallRunner], {
      stdio: "inherit",
    });
  },
});
