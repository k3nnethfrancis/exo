import { existsSync } from "node:fs";
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
