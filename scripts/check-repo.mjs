#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inflateSync } from 'node:zlib';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readBinary(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath));
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

function listSourceFiles(relativeDirectory) {
  const root = path.join(repoRoot, relativeDirectory);
  const files = [];
  const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release']);

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) {
        continue;
      }
      files.push(path.relative(repoRoot, path.join(directory, entry.name)));
    }
  }

  visit(root);
  return files.sort();
}

function assertNoDirectImplementationImports({ label, blockedImportFragments, allowedFiles }) {
  const allowed = new Set(allowedFiles);
  for (const file of listSourceFiles('.')) {
    if (allowed.has(file)) {
      continue;
    }
    const content = read(file);
    for (const fragment of blockedImportFragments) {
      if (content.includes(fragment)) {
        fail(`${file} must not import ${label} implementation modules directly; use the public core facade/contract instead`);
      }
    }
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

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function assertPngCornerAlpha(relativePath, expectedAlpha) {
  const buffer = readBinary(relativePath);
  const { width, height } = pngSize(buffer);
  const idatChunks = [];
  let colorType = 0;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      colorType = payload[9];
    } else if (type === 'IDAT') {
      idatChunks.push(payload);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (colorType !== 6) {
    fail(`${relativePath} must be an RGBA PNG`);
    return;
  }
  const raw = inflateSync(Buffer.concat(idatChunks));
  const channels = 4;
  const stride = width * channels;
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  let topLeftAlpha = null;
  let bottomRightAlpha = null;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const scanline = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      const value = scanline[x];
      if (filter === 0) {
        row[x] = value;
      } else if (filter === 1) {
        row[x] = (value + left) & 255;
      } else if (filter === 2) {
        row[x] = (value + up) & 255;
      } else if (filter === 3) {
        row[x] = (value + Math.floor((left + up) / 2)) & 255;
      } else if (filter === 4) {
        const predictor = left + up - upLeft;
        const leftDistance = Math.abs(predictor - left);
        const upDistance = Math.abs(predictor - up);
        const upLeftDistance = Math.abs(predictor - upLeft);
        const paeth = leftDistance <= upDistance && leftDistance <= upLeftDistance ? left : upDistance <= upLeftDistance ? up : upLeft;
        row[x] = (value + paeth) & 255;
      } else {
        fail(`${relativePath} uses unsupported PNG filter ${filter}`);
        return;
      }
    }
    if (y === 0) {
      topLeftAlpha = row[3];
    }
    if (y === height - 1) {
      bottomRightAlpha = row[stride - 1];
    }
    previous = row;
  }
  if (topLeftAlpha !== expectedAlpha || bottomRightAlpha !== expectedAlpha) {
    fail(`${relativePath} must have alpha ${expectedAlpha} at app-icon corners; got ${topLeftAlpha}/${bottomRightAlpha}`);
  }
}

function assertIcnsContainsLargeIcon(relativePath) {
  const buffer = readBinary(relativePath);
  if (buffer.subarray(0, 4).toString('ascii') !== 'icns') {
    fail(`${relativePath} must be an ICNS file`);
    return;
  }
  let has1024 = false;
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 4);
    const payload = buffer.subarray(offset + 8, offset + length);
    if (payload.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      const { width, height } = pngSize(payload);
      has1024 = has1024 || (width === 1024 && height === 1024);
    }
    offset += length;
  }
  if (!has1024) {
    fail(`${relativePath} must contain a 1024x1024 macOS icon payload`);
  }
}

const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'ledger.md',
  'roadmap.md',
  'tasks.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/harness.md',
  'docs/qmd-integration-notes.md',
  'docs/usability-readiness.md',
  'packages/mcp/README.md',
  '.github/workflows/ci.yml',
  '.github/workflows/package-macos.yml',
  'scripts/install-local',
  'scripts/install-mac-app',
  'scripts/pack-mac.mjs',
];
for (const file of requiredFiles) {
  assertFile(file);
}

assertSymlink('CLAUDE.md', 'AGENTS.md');
assertFile('apps/desktop/build/icon.png');
assertFile('apps/desktop/build/icon.icns');
assertPngCornerAlpha('apps/desktop/build/icon.png', 0);
assertIcnsContainsLargeIcon('apps/desktop/build/icon.icns');

const packageJson = JSON.parse(read('package.json'));
if (packageJson.packageManager !== 'pnpm@11.2.2') {
  fail('package.json packageManager must stay pinned to pnpm@11.2.2');
}
for (const scriptName of ['ci:check', 'check:repo', 'check', 'build', 'test', 'typecheck', 'dev:qa', 'install:local', 'install:mac-app', 'pack:mac', 'dist:mac']) {
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

assertNoDirectImplementationImports({
  label: 'QMD search provider',
  blockedImportFragments: ['search-providers/qmd-provider'],
  allowedFiles: [
    'packages/core/src/qmd.ts',
    'packages/core/src/__tests__/qmd.test.ts',
    'packages/core/src/__tests__/search-provider-registry.test.ts',
    'packages/core/src/search-provider-registry.ts',
    'packages/core/src/search-providers/qmd-provider.ts',
    'scripts/check-repo.mjs',
  ],
});

assertNoDirectImplementationImports({
  label: 'built-in agent harness',
  blockedImportFragments: ['agent-harnesses/builtins'],
  allowedFiles: [
    'packages/core/src/runtime.ts',
    'packages/core/src/agent-harness-registry.ts',
    'packages/core/src/__tests__/agent-harness-registry.test.ts',
    'packages/core/src/__tests__/runtime.test.ts',
    'packages/core/src/agent-harnesses/builtins.ts',
    'scripts/check-repo.mjs',
  ],
});

if (failures.length > 0) {
  console.error('Repo checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repo checks passed.');
