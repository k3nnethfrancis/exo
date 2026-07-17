let nodeCount = 0;
let edgeSources = new Uint32Array();
let edgeTargets = new Uint32Array();
let positions = new Float32Array();
let velocities = new Float32Array();
let forces = new Float32Array();
let nodeSeeds = new Uint32Array();
let groupAnchors = new Float32Array();
let groupOfNode = new Uint32Array();

// Pin state is dense because it is checked for every node on every tick. Keeping
// it out of a Map removes a hash lookup and a temporary tuple from the hot path.
let pinnedMask = new Uint8Array();
let pinnedPositions = new Float32Array();
let pinnedCount = 0;

// The spatial index is an open-addressed hash table. A monotonically increasing
// stamp makes rebuilding it O(n) without clearing the table or allocating cells.
let nextInCell = new Int32Array();
let tableStamp = new Uint32Array();
let tableX = new Int32Array();
let tableY = new Int32Array();
let tableZ = new Int32Array();
let tableHead = new Int32Array();
let tableCount = new Uint32Array();
let tableSumX = new Float64Array();
let tableSumY = new Float64Array();
let tableSumZ = new Float64Array();
let tableForceX = new Float64Array();
let tableForceY = new Float64Array();
let tableForceZ = new Float64Array();
let occupiedSlots = new Int32Array();
let occupiedCount = 0;
let tableMask = 0;
let spatialStamp = 0;
let cellSize = 76;
let exactCellPairLimit = 96;
let exactInternalCellLimit = 40;

let recycledFrames = [];
let timer = null;
let alpha = 1;
let epoch = 0;
let settled = false;

const BASE_CELL_SIZE = 76;
const REPULSION = 520;
const MAX_SPEED = 7.5;
const STEP_INTERVAL = 1000 / 60;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_RECYCLED_FRAMES = 3;
// Exactly one side of the 3x3x3 neighborhood. Cell pairs are visited once,
// rather than looking up the same 27 cells separately for every node.
const FORWARD_NEIGHBORS = new Int8Array([
  0, 0, 1,
  0, 1, -1, 0, 1, 0, 0, 1, 1,
  1, -1, -1, 1, -1, 0, 1, -1, 1,
  1, 0, -1, 1, 0, 0, 1, 0, 1,
  1, 1, -1, 1, 1, 0, 1, 1, 1,
]);

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init': initialize(data); break;
    case 'recycle': recycle(data.buffer); break;
    case 'pin': pin(data); break;
    case 'release': release(data); break;
    case 'reheat': reheat(data.alpha || 0.35); break;
    case 'dispose': dispose(); break;
  }
};

function initialize(data) {
  stopTimer();

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  nodeCount = nodes.length;
  positions = new Float32Array(nodeCount * 3);
  velocities = new Float32Array(nodeCount * 3);
  forces = new Float32Array(nodeCount * 3);
  nodeSeeds = new Uint32Array(nodeCount);
  groupOfNode = new Uint32Array(nodeCount);
  pinnedMask = new Uint8Array(nodeCount);
  pinnedPositions = new Float32Array(nodeCount * 3);
  pinnedCount = 0;
  recycledFrames = [];
  alpha = 1;
  epoch = 0;
  settled = nodeCount === 0;

  // Preserve exact local physics for the normal graph while coarsening smoothly
  // at large cardinalities. The sixth-root growth is deliberately gentle:
  // 250 nodes use 76-unit cells; 10k nodes use ~140-unit cells.
  const densityScale = Math.sqrt(Math.max(1, nodeCount / 250));
  cellSize = Math.min(160, BASE_CELL_SIZE * Math.pow(Math.max(1, nodeCount / 250), 1 / 6));
  exactCellPairLimit = Math.max(8, Math.floor(96 / densityScale));
  exactInternalCellLimit = Math.max(8, Math.floor(40 / densityScale));

  initializeSpatialIndex(nodeCount);

  const groups = [...new Set(nodes.map((node) => node.group || 'notes'))].sort();
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  groupAnchors = new Float32Array(groups.length * 3);
  const anchorRadius = Math.max(130, Math.sqrt(nodeCount) * 24);

  for (let index = 0; index < groups.length; index++) {
    const y = groups.length === 1 ? 0 : 1 - (index / (groups.length - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE;
    groupAnchors[index * 3] = Math.cos(angle) * ring * anchorRadius;
    groupAnchors[index * 3 + 1] = y * anchorRadius * 0.78;
    groupAnchors[index * 3 + 2] = Math.sin(angle) * ring * anchorRadius;
  }

  for (let index = 0; index < nodeCount; index++) {
    const id = nodes[index].id || String(index);
    const seed = hash(id);
    const group = groupIndex.get(nodes[index].group || 'notes') || 0;
    const anchor = group * 3;
    const offset = index * 3;
    const theta = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
    const z = (((seed >>> 16) & 0xffff) / 0xffff) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const radiusSeed = mix32(seed ^ 0x9e3779b9);
    const radius = 22 + (radiusSeed / 0xffffffff) * (38 + Math.sqrt(nodeCount) * 1.8);

    nodeSeeds[index] = seed;
    groupOfNode[index] = group;
    positions[offset] = groupAnchors[anchor] + Math.cos(theta) * radial * radius;
    positions[offset + 1] = groupAnchors[anchor + 1] + z * radius;
    positions[offset + 2] = groupAnchors[anchor + 2] + Math.sin(theta) * radial * radius;
  }

  // Validate and flatten edges once. The simulation then walks contiguous memory
  // rather than object properties, and malformed fixture edges cannot poison it.
  let validEdgeCount = 0;
  for (let index = 0; index < edges.length; index++) {
    const source = edges[index].source;
    const target = edges[index].target;
    if (Number.isInteger(source) && Number.isInteger(target)
      && source >= 0 && target >= 0 && source < nodeCount && target < nodeCount
      && source !== target) validEdgeCount++;
  }
  edgeSources = new Uint32Array(validEdgeCount);
  edgeTargets = new Uint32Array(validEdgeCount);
  let edgeOffset = 0;
  for (let index = 0; index < edges.length; index++) {
    const source = edges[index].source;
    const target = edges[index].target;
    if (!Number.isInteger(source) || !Number.isInteger(target)
      || source < 0 || target < 0 || source >= nodeCount || target >= nodeCount
      || source === target) continue;
    edgeSources[edgeOffset] = source;
    edgeTargets[edgeOffset] = target;
    edgeOffset++;
  }

  emitFrame(true, Number.POSITIVE_INFINITY);
  if (!settled) scheduleStep(0);
}

function initializeSpatialIndex(count) {
  nextInCell = new Int32Array(count);

  // Keep load below 0.5. This makes the expected probe count effectively
  // constant while using only a few megabytes at 10k nodes.
  let capacity = 16;
  while (capacity < count * 2) capacity <<= 1;
  tableStamp = new Uint32Array(capacity);
  tableX = new Int32Array(capacity);
  tableY = new Int32Array(capacity);
  tableZ = new Int32Array(capacity);
  tableHead = new Int32Array(capacity);
  tableCount = new Uint32Array(capacity);
  tableSumX = new Float64Array(capacity);
  tableSumY = new Float64Array(capacity);
  tableSumZ = new Float64Array(capacity);
  tableForceX = new Float64Array(capacity);
  tableForceY = new Float64Array(capacity);
  tableForceZ = new Float64Array(capacity);
  occupiedSlots = new Int32Array(count);
  occupiedCount = 0;
  tableMask = capacity - 1;
  spatialStamp = 0;
}

function step() {
  timer = null;
  if (!nodeCount || settled) return;
  const startedAt = performance.now();

  forces.fill(0);
  buildSpatialIndex();
  applyRepulsion();

  for (let index = 0; index < edgeSources.length; index++) {
    spring(edgeSources[index], edgeTargets[index]);
  }

  let energy = 0;
  for (let index = 0; index < nodeCount; index++) {
    const offset = index * 3;
    if (pinnedMask[index]) {
      positions[offset] = pinnedPositions[offset];
      positions[offset + 1] = pinnedPositions[offset + 1];
      positions[offset + 2] = pinnedPositions[offset + 2];
      velocities[offset] = 0;
      velocities[offset + 1] = 0;
      velocities[offset + 2] = 0;
      continue;
    }

    const anchor = groupOfNode[index] * 3;
    forces[offset] += ((groupAnchors[anchor] - positions[offset]) * 0.00145 - positions[offset] * 0.00008) * alpha;
    forces[offset + 1] += ((groupAnchors[anchor + 1] - positions[offset + 1]) * 0.00145 - positions[offset + 1] * 0.00008) * alpha;
    forces[offset + 2] += ((groupAnchors[anchor + 2] - positions[offset + 2]) * 0.00145 - positions[offset + 2] * 0.00008) * alpha;

    for (let axis = 0; axis < 3; axis++) {
      const coordinate = offset + axis;
      const velocity = clamp((velocities[coordinate] + forces[coordinate]) * 0.82, -MAX_SPEED, MAX_SPEED);
      positions[coordinate] += velocity;
      velocities[coordinate] = velocity;
      energy += velocity * velocity;
    }
  }

  alpha *= pinnedCount ? 0.997 : 0.974;
  const meanEnergy = energy / Math.max(1, nodeCount);
  if (alpha < 0.002 || (alpha < 0.06 && meanEnergy < 0.0008)) {
    alpha = 0;
    velocities.fill(0);
    settled = true;
  }

  // One published epoch is one simulation tick. This is deterministic across
  // machines; wall-clock time affects only when a tick runs, never its result.
  emitFrame(false, meanEnergy);
  if (!settled) scheduleStep(Math.max(0, STEP_INTERVAL - (performance.now() - startedAt)));
}

function buildSpatialIndex() {
  spatialStamp = (spatialStamp + 1) >>> 0;
  if (spatialStamp === 0) {
    tableStamp.fill(0);
    spatialStamp = 1;
  }
  occupiedCount = 0;

  for (let index = 0; index < nodeCount; index++) {
    const offset = index * 3;
    const x = Math.floor(positions[offset] / cellSize);
    const y = Math.floor(positions[offset + 1] / cellSize);
    const z = Math.floor(positions[offset + 2] / cellSize);
    const slot = findCellSlot(x, y, z, true);
    nextInCell[index] = tableHead[slot];
    tableHead[slot] = index;
    tableCount[slot]++;
    tableSumX[slot] += positions[offset];
    tableSumY[slot] += positions[offset + 1];
    tableSumZ[slot] += positions[offset + 2];
  }
}

function applyRepulsion() {
  for (let occupiedIndex = 0; occupiedIndex < occupiedCount; occupiedIndex++) {
    const slot = occupiedSlots[occupiedIndex];
    const head = tableHead[slot];

    // Small cells remain exact. Dense cells use each node's force against the
    // center of mass of its peers, avoiding a quadratic singularity.
    if (tableCount[slot] <= exactInternalCellLimit) {
      for (let left = head; left >= 0; left = nextInCell[left]) {
        for (let right = nextInCell[left]; right >= 0; right = nextInCell[right]) {
          repelPair(left, right);
        }
      }
    } else {
      repelWithinDenseCell(slot);
    }

    // Pairs crossing into each forward neighboring cell. Restricting traversal
    // to a half-neighborhood means every pair is computed exactly once.
    for (let offset = 0; offset < FORWARD_NEIGHBORS.length; offset += 3) {
      const neighborSlot = findCellSlot(
        tableX[slot] + FORWARD_NEIGHBORS[offset],
        tableY[slot] + FORWARD_NEIGHBORS[offset + 1],
        tableZ[slot] + FORWARD_NEIGHBORS[offset + 2],
        false,
      );
      if (neighborSlot < 0) continue;
      if (tableCount[slot] * tableCount[neighborSlot] <= exactCellPairLimit) {
        for (let left = head; left >= 0; left = nextInCell[left]) {
          for (let right = tableHead[neighborSlot]; right >= 0; right = nextInCell[right]) {
            repelPair(left, right);
          }
        }
      } else {
        repelCellPair(slot, neighborSlot);
      }
    }
  }
  distributeCellForces();
}

function findCellSlot(x, y, z, create) {
  let slot = hashCell(x, y, z) & tableMask;
  while (tableStamp[slot] === spatialStamp) {
    if (tableX[slot] === x && tableY[slot] === y && tableZ[slot] === z) return slot;
    slot = (slot + 1) & tableMask;
  }
  if (!create) return -1;
  tableStamp[slot] = spatialStamp;
  tableX[slot] = x;
  tableY[slot] = y;
  tableZ[slot] = z;
  tableHead[slot] = -1;
  tableCount[slot] = 0;
  tableSumX[slot] = 0;
  tableSumY[slot] = 0;
  tableSumZ[slot] = 0;
  tableForceX[slot] = 0;
  tableForceY[slot] = 0;
  tableForceZ[slot] = 0;
  occupiedSlots[occupiedCount++] = slot;
  return slot;
}

function repelWithinDenseCell(slot) {
  const count = tableCount[slot];
  const otherCount = count - 1;
  for (let index = tableHead[slot]; index >= 0; index = nextInCell[index]) {
    const offset = index * 3;
    const centerX = (tableSumX[slot] - positions[offset]) / otherCount;
    const centerY = (tableSumY[slot] - positions[offset + 1]) / otherCount;
    const centerZ = (tableSumZ[slot] - positions[offset + 2]) / otherCount;
    applyAggregateToNode(index, centerX, centerY, centerZ, otherCount);
  }
}

function applyAggregateToNode(index, centerX, centerY, centerZ, mass) {
  const offset = index * 3;
  let dx = positions[offset] - centerX;
  let dy = positions[offset + 1] - centerY;
  let dz = positions[offset + 2] - centerZ;
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = mix32(nodeSeeds[index] ^ 0x85ebca6b);
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(distanceSquared) * mass;
  forces[offset] += dx * strength;
  forces[offset + 1] += dy * strength;
  forces[offset + 2] += dz * strength;
}

function repelCellPair(leftSlot, rightSlot) {
  const leftCount = tableCount[leftSlot];
  const rightCount = tableCount[rightSlot];
  let dx = tableSumX[leftSlot] / leftCount - tableSumX[rightSlot] / rightCount;
  let dy = tableSumY[leftSlot] / leftCount - tableSumY[rightSlot] / rightCount;
  let dz = tableSumZ[leftSlot] / leftCount - tableSumZ[rightSlot] / rightCount;
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = hashCell(
      tableX[leftSlot] ^ tableX[rightSlot],
      tableY[leftSlot] ^ tableY[rightSlot],
      tableZ[leftSlot] ^ tableZ[rightSlot],
    );
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(distanceSquared) * leftCount * rightCount;
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  tableForceX[leftSlot] += fx;
  tableForceY[leftSlot] += fy;
  tableForceZ[leftSlot] += fz;
  tableForceX[rightSlot] -= fx;
  tableForceY[rightSlot] -= fy;
  tableForceZ[rightSlot] -= fz;
}

function distributeCellForces() {
  for (let occupiedIndex = 0; occupiedIndex < occupiedCount; occupiedIndex++) {
    const slot = occupiedSlots[occupiedIndex];
    const count = tableCount[slot];
    if (!tableForceX[slot] && !tableForceY[slot] && !tableForceZ[slot]) continue;
    const fx = tableForceX[slot] / count;
    const fy = tableForceY[slot] / count;
    const fz = tableForceZ[slot] / count;
    for (let index = tableHead[slot]; index >= 0; index = nextInCell[index]) {
      const offset = index * 3;
      forces[offset] += fx;
      forces[offset + 1] += fy;
      forces[offset + 2] += fz;
    }
  }
}

function repelPair(left, right) {
  const a = left * 3;
  const b = right * 3;
  let dx = positions[a] - positions[b];
  let dy = positions[a + 1] - positions[b + 1];
  let dz = positions[a + 2] - positions[b + 2];
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = mix32(nodeSeeds[left] ^ Math.imul(nodeSeeds[right], 0x9e3779b1));
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(distanceSquared);
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  forces[a] += fx; forces[a + 1] += fy; forces[a + 2] += fz;
  forces[b] -= fx; forces[b + 1] -= fy; forces[b + 2] -= fz;
}

function repulsionStrength(distanceSquared) {
  return Math.min(1.7, REPULSION / (distanceSquared + 120)) * alpha / Math.sqrt(distanceSquared);
}

function spring(source, target) {
  const a = source * 3;
  const b = target * 3;
  const dx = positions[b] - positions[a];
  const dy = positions[b + 1] - positions[a + 1];
  const dz = positions[b + 2] - positions[a + 2];
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const sameGroup = groupOfNode[source] === groupOfNode[target];
  const restLength = sameGroup ? 44 : 104;
  const strength = (distance - restLength) * (sameGroup ? 0.0105 : 0.0075) * alpha / distance;
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  forces[a] += fx; forces[a + 1] += fy; forces[a + 2] += fz;
  forces[b] -= fx; forces[b + 1] -= fy; forces[b + 2] -= fz;
}

function pin(data) {
  const index = data.index;
  if (!Number.isInteger(index) || index < 0 || index >= nodeCount) return;
  const offset = index * 3;
  if (!pinnedMask[index]) pinnedCount++;
  pinnedMask[index] = 1;
  pinnedPositions[offset] = finiteOr(data.x, positions[offset]);
  pinnedPositions[offset + 1] = finiteOr(data.y, positions[offset + 1]);
  pinnedPositions[offset + 2] = finiteOr(data.z, positions[offset + 2]);
  reheat(0.26);
}

function release(data) {
  const index = data.index;
  if (!Number.isInteger(index) || index < 0 || index >= nodeCount || !pinnedMask[index]) return;
  pinnedMask[index] = 0;
  pinnedCount--;
  reheat(0.32);
}

function reheat(nextAlpha) {
  alpha = Math.max(alpha, finiteOr(nextAlpha, 0.35));
  settled = false;
  scheduleStep(0);
}

function scheduleStep(delay) {
  if (timer !== null || settled || !nodeCount) return;
  timer = setTimeout(step, delay);
}

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function recycle(buffer) {
  if (!(buffer instanceof ArrayBuffer)
    || buffer.byteLength !== positions.byteLength
    || recycledFrames.length >= MAX_RECYCLED_FRAMES) return;
  recycledFrames.push(buffer);
}

function emitFrame(initial, energy) {
  epoch++;
  const byteLength = positions.byteLength;
  const buffer = recycledFrames.pop() || new ArrayBuffer(byteLength);
  const output = new Float32Array(buffer, 0, positions.length);
  output.set(positions);
  self.postMessage({
    type: 'frame',
    positions: output,
    epoch,
    energy,
    settled,
    initial,
  }, [buffer]);
}

function dispose() {
  stopTimer();
  close();
}

function hashCell(x, y, z) {
  return mix32(Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f));
}

function mix32(value) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function finiteOr(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}
