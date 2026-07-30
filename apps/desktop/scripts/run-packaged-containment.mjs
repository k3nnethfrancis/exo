#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function packagedExecutablePath(appPath) {
  if (!appPath) {
    return path.join(repoRoot, 'release', `mac-${process.arch}`, 'Exograph.app', 'Contents', 'MacOS', 'Exograph');
  }
  return appPath.endsWith('.app')
    ? path.join(appPath, 'Contents', 'MacOS', 'Exograph')
    : appPath;
}

const packagedAppPath = packagedExecutablePath(process.env.EXOGRAPH_PACKAGED_APP_PATH);

if (!existsSync(packagedAppPath)) {
  console.error(`Packaged Exograph was not found for ${process.arch}. Run pnpm pack:mac first.`);
  process.exit(1);
}

const child = spawn(
  'pnpm',
  ['--filter', '@exograph/desktop', 'exec', 'playwright', 'test', 'tests/e2e/note-root-containment.spec.ts'],
  {
    cwd: repoRoot,
    env: { ...process.env, EXOGRAPH_PACKAGED_APP_PATH: packagedAppPath },
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
