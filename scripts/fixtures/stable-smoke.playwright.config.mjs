import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: 'stable-smoke-skipped.spec.mjs',
  outputDir: path.join(fixtureDir, 'test-results'),
  fullyParallel: false,
  workers: 1,
});
