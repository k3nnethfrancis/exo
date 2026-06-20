#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "packages/cli/src/index.ts")],
  outfile: path.join(root, "packages/cli/dist/index.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  banner: {
    js: "const __exoImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  define: {
    "import.meta.url": "__exoImportMetaUrl",
  },
  external: [
    "@tobilu/qmd",
    "better-sqlite3",
  ],
});
