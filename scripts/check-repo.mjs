#!/usr/bin/env node
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function assertFile(relativePath) {
  try {
    const stat = lstatSync(path.join(repoRoot, relativePath));
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      fail(`${relativePath} exists but is not a file`);
    }
  } catch {
    fail(`${relativePath} is missing`);
  }
}

function assertContains(relativePath, expected) {
  const content = read(relativePath);
  if (!content.includes(expected)) {
    fail(`${relativePath} must contain: ${expected}`);
  }
}

function assertSymlink(relativePath, target) {
  const fullPath = path.join(repoRoot, relativePath);
  try {
    const stat = lstatSync(fullPath);
    if (!stat.isSymbolicLink()) {
      fail(`${relativePath} must be a symlink to ${target}`);
      return;
    }
    const actual = readlinkSync(fullPath);
    if (actual !== target) {
      fail(`${relativePath} must point to ${target}; got ${actual}`);
    }
  } catch (error) {
    fail(`${relativePath} symlink check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'ledger.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/harness.md',
  'docs/qmd-integration-notes.md',
  'docs/tasks.md',
  'docs/usability-readiness.md',
  'packages/mcp/README.md',
  '.github/workflows/ci.yml',
  '.github/workflows/package-macos.yml',
  'scripts/install-local',
  'scripts/install-mac-app',
];
for (const file of requiredFiles) {
  assertFile(file);
}

assertSymlink('CLAUDE.md', 'AGENTS.md');

const packageJson = JSON.parse(read('package.json'));
if (packageJson.packageManager !== 'pnpm@11.2.2') {
  fail('package.json packageManager must stay pinned to pnpm@11.2.2');
}
for (const scriptName of ['ci:check', 'check:repo', 'check', 'build', 'test', 'typecheck', 'dev:qa', 'install:local', 'install:mac-app']) {
  if (!packageJson.scripts?.[scriptName]) {
    fail(`package.json missing script: ${scriptName}`);
  }
}

assertContains('.github/workflows/ci.yml', 'pull_request:');
assertContains('.github/workflows/ci.yml', 'branches:');
assertContains('.github/workflows/ci.yml', '- main');
assertContains('.github/workflows/ci.yml', 'version: 11.2.2');
assertContains('.github/workflows/ci.yml', 'node-version: 24');
assertContains('.github/workflows/ci.yml', 'pnpm install --frozen-lockfile');
assertContains('.github/workflows/ci.yml', 'pnpm ci:check');

assertContains('.github/workflows/package-macos.yml', 'workflow_dispatch:');
assertContains('.github/workflows/package-macos.yml', 'pnpm install --frozen-lockfile');
assertContains('.github/workflows/package-macos.yml', 'pnpm check:repo');
assertContains('.github/workflows/package-macos.yml', 'pnpm dist:mac');
assertContains('.github/workflows/package-macos.yml', 'if-no-files-found: error');

assertContains('docs/harness.md', 'One canonical broad gate');
assertContains('docs/harness.md', 'Tests must be hermetic');
assertContains('docs/harness.md', 'CI runs `pnpm ci:check`');
assertContains('docs/usability-readiness.md', 'Installed `Exo.app` is the stable daily runtime');
assertContains('AGENTS.md', '`CLAUDE.md` is a compatibility symlink to `AGENTS.md`');
assertContains('AGENTS.md', 'docs/usability-readiness.md');
assertContains('README.md', './scripts/install-local');
assertContains('README.md', './scripts/install-mac-app');
assertContains('README.md', 'pnpm dev:qa');

if (failures.length > 0) {
  console.error('Repo checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repo checks passed.');
