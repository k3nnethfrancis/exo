#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedAppPath = path.join(
  repoRoot,
  'release',
  `mac-${process.arch}`,
  'Exo.app',
  'Contents',
  'MacOS',
  'Exo',
);

if (!existsSync(packagedAppPath)) {
  console.error(`Packaged Exo was not found for ${process.arch}. Run pnpm pack:mac first.`);
  process.exit(1);
}

const child = spawn(
  'pnpm',
  ['--filter', '@exo/desktop', 'exec', 'playwright', 'test', 'tests/e2e/note-root-containment.spec.ts'],
  {
    cwd: repoRoot,
    env: { ...process.env, EXO_PACKAGED_APP_PATH: packagedAppPath },
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Packaged containment journey stopped by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
