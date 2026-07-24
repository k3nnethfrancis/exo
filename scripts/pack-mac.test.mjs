import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanMacOutputDirectories,
  macOutputDirectories,
  packagingFailureDiagnostic,
  packagingTimeoutDiagnostic,
  packMacTimeouts,
  restoreLocalElectronRuntime,
  withElectronRuntimeRestore,
} from './pack-mac.mjs';

test('macOutputDirectories returns only generated mac app output directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'exo-pack-mac-test-'));
  const release = path.join(root, 'release');
  mkdirSync(path.join(release, 'mac-arm64', 'Electron.app'), { recursive: true });
  mkdirSync(path.join(release, 'mac-x64', 'Exo.app'), { recursive: true });
  mkdirSync(path.join(release, 'mac'), { recursive: true });
  mkdirSync(path.join(release, 'macos-docs'), { recursive: true });
  writeFileSync(path.join(release, 'Exo-0.1.0-alpha.3-mac-arm64.dmg'), '');

  assert.deepEqual(
    macOutputDirectories(release).map((directory) => path.basename(directory)).sort(),
    ['mac', 'mac-arm64', 'mac-x64'],
  );
});

test('cleanMacOutputDirectories removes partial and stale mac app bundles without touching other release artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'exo-pack-mac-clean-test-'));
  const release = path.join(root, 'release');
  const partialBundle = path.join(release, 'mac-arm64', 'Electron.app');
  const staleBundle = path.join(release, 'mac-x64', 'Exo.app');
  const dmg = path.join(release, 'Exo-0.1.0-alpha.3-mac-arm64.dmg');
  mkdirSync(partialBundle, { recursive: true });
  mkdirSync(staleBundle, { recursive: true });
  writeFileSync(dmg, '');

  const removed = cleanMacOutputDirectories(root);

  assert.deepEqual(removed.map((directory) => path.basename(directory)).sort(), ['mac-arm64', 'mac-x64']);
  assert.equal(existsSync(partialBundle), false);
  assert.equal(existsSync(staleBundle), false);
  assert.equal(existsSync(dmg), true);
});

test('packagingFailureDiagnostic explains pnpm SQLite dependency collector failures', () => {
  const diagnostic = packagingFailureDiagnostic('error parsing dependencies tree\nERR_SQLITE_ERROR\n');

  assert.match(diagnostic, /electron-builder asked pnpm to collect the dependency tree/);
  assert.match(diagnostic, /release\/mac-\*/);
  assert.match(diagnostic, /pnpm --dir apps\/desktop why/);
});

test('packMacTimeouts uses conservative defaults with environment overrides', () => {
  assert.deepEqual(packMacTimeouts({}), {
    timeoutMs: 20 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
  });
  assert.deepEqual(packMacTimeouts({ EXO_PACK_MAC_TIMEOUT_MS: '120000', EXO_PACK_MAC_IDLE_TIMEOUT_MS: '30000' }), {
    timeoutMs: 120000,
    idleTimeoutMs: 30000,
  });
  assert.deepEqual(packMacTimeouts({ EXO_PACK_MAC_TIMEOUT_MS: '0', EXO_PACK_MAC_IDLE_TIMEOUT_MS: 'nope' }), {
    timeoutMs: 20 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
  });
});

test('packagingTimeoutDiagnostic names dependency collection as the likely stuck phase', () => {
  const diagnostic = packagingTimeoutDiagnostic({
    kind: 'idle',
    label: 'electron-builder packaging',
    timeoutMs: 300000,
  });

  assert.match(diagnostic, /produced no output for 5m/);
  assert.match(diagnostic, /searching for node modules/);
  assert.match(diagnostic, /dependency collection/);
  assert.match(diagnostic, /EXO_PACK_MAC_IDLE_TIMEOUT_MS/);
});

test('mac packaging restores the local Electron runtime after electron-builder consumes its path marker', async () => {
  const calls = [];

  await restoreLocalElectronRuntime(async (...args) => {
    calls.push(args);
  });

  assert.deepEqual(calls, [[
    'pnpm',
    ['--filter', '@exo/desktop', 'setup:runtime'],
    { label: 'restore local Electron runtime' },
  ]]);
});

test('packaging restores Electron after success and failure without masking the packaging error', async () => {
  let restores = 0;
  await withElectronRuntimeRestore(async () => 'built', {
    restore: async () => { restores += 1; },
  });
  assert.equal(restores, 1);

  const packagingError = new Error('builder failed');
  const messages = [];
  await assert.rejects(
    withElectronRuntimeRestore(async () => { throw packagingError; }, {
      restore: async () => { restores += 1; throw new Error('restore failed'); },
      log: (message) => messages.push(message),
    }),
    (error) => error === packagingError,
  );
  assert.equal(restores, 2);
  assert.match(messages[0], /failed to restore local Electron runtime.*restore failed/);
});
