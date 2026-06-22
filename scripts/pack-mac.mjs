#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function macOutputDirectories(releaseDir) {
  if (!existsSync(releaseDir)) {
    return [];
  }

  return readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^mac(?:-|$)/.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));
}

export function cleanMacOutputDirectories(root = repoRoot, { log = () => {} } = {}) {
  const releaseDir = path.join(root, 'release');
  const directories = macOutputDirectories(releaseDir);

  for (const directory of directories) {
    log(`removing stale mac package output: ${path.relative(root, directory)}`);
    rmSync(directory, { recursive: true, force: true });
  }

  return directories;
}

export function packagingFailureDiagnostic(output) {
  if (!output.includes('ERR_SQLITE_ERROR')) {
    return '';
  }

  return [
    '',
    'Exo mac packaging failed while electron-builder asked pnpm to collect the dependency tree.',
    'pnpm reported ERR_SQLITE_ERROR. On macOS this can happen when the pnpm store/index SQLite files are inaccessible from a sandboxed shell.',
    'Generated release/mac-* app output was removed so a partial Electron.app or stale Exo.app is not mistaken for an installable build.',
    '',
    'Try again from a normal terminal with access to your pnpm store/cache, or verify pnpm can inspect dependencies:',
    '  pnpm --dir apps/desktop why @tobilu/qmd better-sqlite3 sqlite-vec --prod',
  ].join('\n');
}

function run(command, args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      error.output = output;
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`);
      error.code = code;
      error.output = output;
      reject(error);
    });
  });
}

async function main() {
  const builderArgs = process.argv.slice(2);
  if (builderArgs.length === 0) {
    builderArgs.push('--mac', 'dir');
  }

  cleanMacOutputDirectories(repoRoot, { log: (message) => console.error(`[exo pack:mac] ${message}`) });

  try {
    await run('pnpm', ['build']);
    await run('electron-builder', ['--projectDir', 'apps/desktop', ...builderArgs]);
  } catch (error) {
    cleanMacOutputDirectories(repoRoot, { log: (message) => console.error(`[exo pack:mac] ${message}`) });
    const diagnostic = packagingFailureDiagnostic(String(error.output ?? error.message ?? error));
    if (diagnostic) {
      console.error(diagnostic);
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
