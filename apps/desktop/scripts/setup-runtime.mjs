import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

import { ensureElectronRuntime } from "./electron-runtime.mjs";

const require = createRequire(import.meta.url);

const electronPackage = require.resolve("electron/package.json");
const electronDirectory = path.dirname(electronPackage);
const electronInstallScript = path.join(electronDirectory, "install.js");

ensureElectronRuntime({
  electronDirectory,
  install() {
    execFileSync(process.execPath, [electronInstallScript], {
      stdio: "inherit",
    });
  },
});
