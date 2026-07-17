import fs from 'node:fs';
import readline from 'node:readline';

export async function parseMatrixMarketFile(matrixPath, provenance) {
  const input = fs.createReadStream(matrixPath, 'utf8');
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  return parseMatrixMarketLines(lines, provenance, matrixPath);
}

export async function parseMatrixMarketLines(lines, provenance, sourceName = 'Matrix Market input') {
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
      if (!Number.isInteger(nodeCount) || nodeCount < 1) throw new Error(`Invalid Matrix Market dimensions in ${sourceName}`);
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
  if (!dimensionsRead) throw new Error(`Matrix dimensions were not found in ${sourceName}`);
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

function mixChecksum(hash, value) {
  return Math.imul((hash ^ (value >>> 0)) >>> 0, 16777619) >>> 0;
}
