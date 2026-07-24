import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "private-vault-graph.spec.ts",
  timeout: 360_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "exo-private-graph-playwright"),
  preserveOutput: "never",
  use: {
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
