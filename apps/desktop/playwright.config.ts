import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
