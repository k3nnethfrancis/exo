export function computeLayoutQuality({ fixture, positions, dimensions = 3, sampleSize = 64 }) {
  const nodeCount = fixture.nodes.length;
  if (!(positions instanceof Float32Array) && !Array.isArray(positions)) throw new Error('positions must be an array or Float32Array');
  if (positions.length !== nodeCount * dimensions) throw new Error('positions length does not match fixture nodes and dimensions');
  if (dimensions !== 2 && dimensions !== 3) throw new Error('dimensions must be 2 or 3');

  const adjacency = buildAdjacency(nodeCount, fixture.edges);
  const samples = sampleIndices(nodeCount, Math.min(sampleSize, nodeCount), fixture.checksum);
  const edgeUniformity = computeEdgeUniformity(fixture.edges, positions, dimensions);
  const neighborhoodPreservation = computeNeighborhoodPreservation(adjacency, positions, dimensions, samples);
  const sampledStress = computeSampledStress(adjacency, positions, dimensions, samples);

  return {
    dimensions,
    sampleSize: samples.length,
    edgeUniformity,
    neighborhoodPreservation,
    sampledStress,
  };
}

function computeEdgeUniformity(edges, positions, dimensions) {
  let count = 0;
  let mean = 0;
  let squaredDeviation = 0;
  for (const { source, target } of edges) {
    const length = distance(positions, dimensions, source, target);
    if (!Number.isFinite(length)) continue;
    count += 1;
    const delta = length - mean;
    mean += delta / count;
    squaredDeviation += delta * (length - mean);
  }
  if (!count || mean === 0) return 0;
  return Math.sqrt(squaredDeviation / count) / mean;
}

function computeNeighborhoodPreservation(adjacency, positions, dimensions, samples) {
  let total = 0;
  let measured = 0;
  for (const source of samples) {
    const begin = adjacency.offsets[source];
    const end = adjacency.offsets[source + 1];
    const degree = end - begin;
    if (!degree) continue;
    const nearest = nearestNodes(positions, dimensions, source, degree);
    const topological = new Set(adjacency.neighbors.subarray(begin, end));
    let intersection = 0;
    for (const candidate of nearest) if (topological.has(candidate)) intersection += 1;
    total += intersection / (topological.size + nearest.length - intersection);
    measured += 1;
  }
  return measured ? total / measured : 0;
}

function computeSampledStress(adjacency, positions, dimensions, samples) {
  const origins = samples.slice(0, Math.min(8, samples.length));
  const targets = samples.slice(Math.min(8, samples.length), Math.min(24, samples.length));
  if (!origins.length || !targets.length) return 0;
  const pairs = [];
  const visited = new Int32Array(adjacency.offsets.length - 1);
  const graphDistance = new Int32Array(adjacency.offsets.length - 1);
  const queue = new Uint32Array(adjacency.offsets.length - 1);
  let stamp = 0;

  for (const origin of origins) {
    stamp += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = origin;
    visited[origin] = stamp;
    graphDistance[origin] = 0;
    let pending = new Set(targets.filter((target) => target !== origin));
    while (head < tail && pending.size) {
      const node = queue[head++];
      const nextDistance = graphDistance[node] + 1;
      for (let edge = adjacency.offsets[node]; edge < adjacency.offsets[node + 1]; edge += 1) {
        const neighbor = adjacency.neighbors[edge];
        if (visited[neighbor] === stamp) continue;
        visited[neighbor] = stamp;
        graphDistance[neighbor] = nextDistance;
        queue[tail++] = neighbor;
        if (pending.delete(neighbor)) {
          pairs.push({
            graph: nextDistance,
            euclidean: distance(positions, dimensions, origin, neighbor),
          });
        }
      }
    }
  }

  let scaleNumerator = 0;
  let scaleDenominator = 0;
  for (const pair of pairs) {
    scaleNumerator += pair.graph * pair.euclidean;
    scaleDenominator += pair.euclidean * pair.euclidean;
  }
  const scale = scaleDenominator ? scaleNumerator / scaleDenominator : 1;
  let error = 0;
  let normalizer = 0;
  for (const pair of pairs) {
    const delta = scale * pair.euclidean - pair.graph;
    error += delta * delta;
    normalizer += pair.graph * pair.graph;
  }
  return normalizer ? Math.sqrt(error / normalizer) : 0;
}

function buildAdjacency(nodeCount, edges) {
  const degrees = new Uint32Array(nodeCount);
  for (const { source, target } of edges) {
    degrees[source] += 1;
    degrees[target] += 1;
  }
  const offsets = new Uint32Array(nodeCount + 1);
  for (let index = 0; index < nodeCount; index += 1) offsets[index + 1] = offsets[index] + degrees[index];
  const neighbors = new Uint32Array(offsets[nodeCount]);
  const cursors = offsets.slice(0, nodeCount);
  for (const { source, target } of edges) {
    neighbors[cursors[source]++] = target;
    neighbors[cursors[target]++] = source;
  }
  return { offsets, neighbors };
}

function nearestNodes(positions, dimensions, source, count) {
  const heap = [];
  const nodeCount = positions.length / dimensions;
  for (let candidate = 0; candidate < nodeCount; candidate += 1) {
    if (candidate === source) continue;
    const squaredDistance = distanceSquared(positions, dimensions, source, candidate);
    if (heap.length < count) {
      heapPush(heap, { node: candidate, squaredDistance });
    } else if (squaredDistance < heap[0].squaredDistance) {
      heap[0] = { node: candidate, squaredDistance };
      heapDown(heap, 0);
    }
  }
  return heap.map(({ node }) => node);
}

function heapPush(heap, value) {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].squaredDistance >= value.squaredDistance) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = value;
}

function heapDown(heap, start) {
  const value = heap[start];
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right].squaredDistance > heap[left].squaredDistance ? right : left;
    if (heap[child].squaredDistance <= value.squaredDistance) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = value;
}

function sampleIndices(nodeCount, count, checksum) {
  const samples = [];
  const seen = new Set();
  let state = Number.parseInt(checksum, 16) >>> 0;
  while (samples.length < count) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    const index = state % nodeCount;
    if (seen.has(index)) continue;
    seen.add(index);
    samples.push(index);
  }
  return samples;
}

function distance(positions, dimensions, left, right) {
  return Math.sqrt(distanceSquared(positions, dimensions, left, right));
}

function distanceSquared(positions, dimensions, left, right) {
  let total = 0;
  const leftOffset = left * dimensions;
  const rightOffset = right * dimensions;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const delta = positions[leftOffset + dimension] - positions[rightOffset + dimension];
    total += delta * delta;
  }
  return total;
}
