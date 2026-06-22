import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanMacOutputDirectories, macOutputDirectories, packagingFailureDiagnostic } from './pack-mac.mjs';

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
