const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const GENERATOR_VERSION = 'mixed-circulant-v1';

export function createFixture({ nodes: nodeCount, edgeRatio, seed }) {
  validate(nodeCount, edgeRatio, seed);
  const random = mulberry32(hashString(`${GENERATOR_VERSION}:${seed}:${nodeCount}:${edgeRatio}`));
  const groupCount = Math.max(4, Math.min(32, Math.round(Math.sqrt(nodeCount) / 8)));
  const groupSize = Math.ceil(nodeCount / groupCount);
  const offsets = chooseOffsets(nodeCount, edgeRatio, groupSize, random);
  const nodes = Array.from({ length: nodeCount }, (_, index) => createNode(index, nodeCount, groupCount, seed));
  const edges = new Array(nodeCount * edgeRatio);
  let edgeIndex = 0;
  let checksum = 2166136261;

  for (const offset of offsets) {
    for (let source = 0; source < nodeCount; source += 1) {
      const target = (source + offset) % nodeCount;
      edges[edgeIndex++] = { source, target };
      checksum = mixChecksum(checksum, source);
      checksum = mixChecksum(checksum, target);
    }
  }

  return {
    schemaVersion: 1,
    source: 'Exo GraphBench deterministic synthetic fixture',
    generatorVersion: GENERATOR_VERSION,
    seed,
    nodeCount,
    edgeCount: edges.length,
    edgeRatio,
    meanDegree: edgeRatio * 2,
    dimensions: 3,
    directed: false,
    offsets,
    checksum: checksum.toString(16).padStart(8, '0'),
    nodes,
    edges,
  };
}

function createNode(index, nodeCount, groupCount, seed) {
  const groupIndex = Math.floor(index * groupCount / nodeCount);
  const groupProgress = groupCount === 1 ? 0.5 : groupIndex / (groupCount - 1);
  const anchorAngle = groupIndex * GOLDEN_ANGLE;
  const anchorY = 1 - groupProgress * 2;
  const anchorRing = Math.sqrt(Math.max(0, 1 - anchorY * anchorY));
  const anchorRadius = Math.max(140, Math.sqrt(nodeCount) * 18);
  const anchorX = Math.cos(anchorAngle) * anchorRing * anchorRadius;
  const anchorZ = Math.sin(anchorAngle) * anchorRing * anchorRadius;
  const random = mulberry32(hashString(`${seed}:node:${index}`));
  const theta = random() * TAU;
  const z = random() * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  const radius = 18 + random() * (42 + Math.sqrt(nodeCount) * 0.8);

  return {
    id: index,
    label: `Node ${index}`,
    group: `group-${String(groupIndex + 1).padStart(2, '0')}`,
    x: anchorX + Math.cos(theta) * radial * radius,
    y: anchorY * anchorRadius * 0.78 + z * radius,
    z: anchorZ + Math.sin(theta) * radial * radius,
  };
}

function chooseOffsets(nodeCount, edgeRatio, groupSize, random) {
  const maximum = Math.floor((nodeCount - 1) / 2);
  const localMaximum = Math.max(2, Math.min(maximum, Math.floor(groupSize / 3)));
  const offsets = new Set();

  while (offsets.size < edgeRatio) {
    const local = offsets.size < Math.ceil(edgeRatio * 0.6);
    const limit = local ? localMaximum : maximum;
    offsets.add(1 + Math.floor(random() * limit));
  }
  return [...offsets].sort((left, right) => left - right);
}

function validate(nodeCount, edgeRatio, seed) {
  if (!Number.isInteger(nodeCount) || nodeCount < 4) throw new Error('nodes must be an integer of at least 4');
  if (!Number.isInteger(edgeRatio) || edgeRatio < 1) throw new Error('edgeRatio must be a positive integer');
  if (edgeRatio > Math.floor((nodeCount - 1) / 2)) throw new Error('edgeRatio is too large for a simple undirected fixture');
  if (typeof seed !== 'string' || !seed) throw new Error('seed must be a non-empty string');
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = mixChecksum(hash, value.charCodeAt(index));
  return hash >>> 0;
}

function mixChecksum(hash, value) {
  hash ^= value >>> 0;
  return Math.imul(hash, 16777619) >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
