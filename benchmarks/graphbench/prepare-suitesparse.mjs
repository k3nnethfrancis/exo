import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writeFixture } from './lib/fixture-io.mjs';

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
const fixture = await parseMatrixMarket(matrixPath, { requested, sourceUrl, sourceSha256 });
const outputPath = path.join(root, 'artifacts', 'suitesparse', `${requested}.json`);
await writeFixture(outputPath, fixture);
console.log(JSON.stringify({ dataset: requested, nodes: fixture.nodeCount, edges: fixture.edgeCount, sourceSha256, outputPath }, null, 2));

async function parseMatrixMarket(matrixPath, provenance) {
  const input = fs.createReadStream(matrixPath, 'utf8');
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let nodeCount = 0;
  let dimensionsRead = false;
  const edges = [];
  const seen = new Set();
  let checksum = 2166136261;
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%')) continue;
    const fields = line.split(/\s+/);
    if (!dimensionsRead) {
      nodeCount = Math.max(Number(fields[0]), Number(fields[1]));
      dimensionsRead = true;
      continue;
    }
    const oneBasedSource = Number(fields[0]);
    const oneBasedTarget = Number(fields[1]);
    if (!Number.isInteger(oneBasedSource) || !Number.isInteger(oneBasedTarget)) continue;
    const left = oneBasedSource - 1;
    const right = oneBasedTarget - 1;
    if (left === right || left < 0 || right < 0 || left >= nodeCount || right >= nodeCount) continue;
    const source = Math.min(left, right);
    const target = Math.max(left, right);
    const key = `${source}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target });
    checksum = mixChecksum(mixChecksum(checksum, source), target);
  }
  if (!dimensionsRead) throw new Error(`Matrix dimensions were not found in ${matrixPath}`);
  const nodes = Array.from({ length: nodeCount }, (_, index) => sphereNode(index, nodeCount, provenance.requested));
  return {
    schemaVersion: 1,
    source: 'SuiteSparse Matrix Collection',
    sourceUrl: provenance.sourceUrl,
    sourceSha256: provenance.sourceSha256,
    dataset: provenance.requested,
    generatorVersion: 'suitesparse-fixed-position-v1',
    seed: 'golden-angle-sphere-v1',
    nodeCount,
    edgeCount: edges.length,
    edgeRatio: edges.length / nodeCount,
    meanDegree: edges.length * 2 / nodeCount,
    dimensions: 3,
    directed: false,
    checksum: (checksum >>> 0).toString(16).padStart(8, '0'),
    nodes,
    edges,
  };
}

function sphereNode(index, count, dataset) {
  const progress = (index + 0.5) / count;
  const y = 1 - progress * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return {
    id: index,
    label: `${dataset} ${index + 1}`,
    group: `band-${String(Math.min(15, Math.floor(progress * 16)) + 1).padStart(2, '0')}`,
    x: Math.cos(angle) * radius * 500,
    y: y * 500,
    z: Math.sin(angle) * radius * 500,
  };
}

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

function mixChecksum(hash, value) {
  return Math.imul((hash ^ (value >>> 0)) >>> 0, 16777619) >>> 0;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
