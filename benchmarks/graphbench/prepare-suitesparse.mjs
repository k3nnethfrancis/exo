import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writeFixture } from './lib/fixture-io.mjs';
import { parseMatrixMarketFile } from './lib/suitesparse.mjs';

const execute = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const catalog = Object.freeze({
  fe_4elt2: 'https://sparse.tamu.edu/MM/DIMACS10/fe_4elt2.tar.gz',
  finance256: 'https://sparse.tamu.edu/MM/GHS_psdef/finance256.tar.gz',
  pkustk02: 'https://sparse.tamu.edu/MM/Chen/pkustk02.tar.gz',
});
const requested = readArgument('--dataset') || 'fe_4elt2';
const sourceUrl = catalog[requested];
if (!sourceUrl) throw new Error(`Unknown SuiteSparse dataset: ${requested}. Choose ${Object.keys(catalog).join(', ')}`);

const directory = path.join(root, 'artifacts', 'suitesparse', requested);
const archivePath = path.join(directory, `${requested}.tar.gz`);
await fsp.mkdir(directory, { recursive: true });
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Download failed (${response.status}): ${sourceUrl}`);
const archive = Buffer.from(await response.arrayBuffer());
const sourceSha256 = crypto.createHash('sha256').update(archive).digest('hex');
await fsp.writeFile(archivePath, archive);
await execute('tar', ['-xzf', archivePath, '-C', directory]);
const matrixPath = await findMatrix(directory);
const fixture = await parseMatrixMarketFile(matrixPath, { requested, sourceUrl, sourceSha256 });
const outputPath = path.join(root, 'artifacts', 'suitesparse', `${requested}.json`);
await writeFixture(outputPath, fixture);
console.log(JSON.stringify({ dataset: requested, nodes: fixture.nodeCount, edges: fixture.edgeCount, sourceSha256, outputPath }, null, 2));

async function findMatrix(directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.name.endsWith('.mtx')) return candidate;
    }
  }
  throw new Error(`No .mtx file found under ${directory}`);
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
