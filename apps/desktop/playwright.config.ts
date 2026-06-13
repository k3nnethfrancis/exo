import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  // Electron + tmux runtime tests share OS-level app and tmux resources. Keep
  // e2e serial until the harness has explicit multi-instance isolation.
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
