import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const electronDirectory = path.dirname(require.resolve("electron/package.json"));
const pathFile = path.join(electronDirectory, "path.txt");
const installScript = path.join(electronDirectory, "install.js");
const deadline = Date.now() + 120_000;

// Electron's CommonJS installer starts a promise chain without exporting it.
// Node 26 can otherwise exit during cached extraction. Top-level polling keeps
// the child alive until the installer's final atomic signal, path.txt, exists.
await import(pathToFileURL(installScript).href);
while (!existsSync(pathFile)) {
  if (Date.now() >= deadline) {
    throw new Error("Electron installation did not produce path.txt within 120 seconds");
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
