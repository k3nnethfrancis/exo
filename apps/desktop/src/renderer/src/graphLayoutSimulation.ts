import type { GraphLayoutFrame, GraphLayoutInput } from "./graphSceneFoundation";

export interface GraphLayoutSimulation {
  readonly input: GraphLayoutInput;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly forces: Float32Array;
  readonly warmAnchors: Float32Array;
  readonly groupAnchors: Float32Array;
  readonly groupOfNode: Uint32Array;
  readonly edgeSources: Uint32Array;
  readonly edgeTargets: Uint32Array;
  readonly spatial: GraphLayoutSpatialIndex;
  alpha: number;
  energy: number;
  iterations: number;
  settled: boolean;
}

export interface GraphLayoutSpatialIndex {
  readonly nextInCell: Int32Array;
  readonly tableStamp: Uint32Array;
  readonly tableX: Int32Array;
  readonly tableY: Int32Array;
  readonly tableZ: Int32Array;
  readonly tableHead: Int32Array;
  readonly tableCount: Uint32Array;
  readonly tableSumX: Float64Array;
  readonly tableSumY: Float64Array;
  readonly tableSumZ: Float64Array;
  readonly tableForceX: Float64Array;
  readonly tableForceY: Float64Array;
  readonly tableForceZ: Float64Array;
  readonly occupiedSlots: Int32Array;
  occupiedCount: number;
  mask: number;
  stamp: number;
  cellSize: number;
  exactCellPairLimit: number;
  exactInternalCellLimit: number;
}

export interface GraphLayoutRunResult {
  frame: GraphLayoutFrame;
  checksum: string;
  energy: number;
  iterations: number;
  estimatedBytes: number;
  converged: boolean;
}

export class NonFiniteGraphLayoutError extends Error {
  constructor(iteration: number) {
    super(`Graph layout became non-finite at iteration ${iteration}.`);
    this.name = "NonFiniteGraphLayoutError";
  }
}

const BASE_CELL_SIZE = 76;
const REPULSION = 520;
const MAX_SPEED = 7.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const WARM_ANCHOR_STRENGTH = 0.32;
const FORWARD_NEIGHBORS = new Int8Array([
  0, 0, 1,
  0, 1, -1, 0, 1, 0, 0, 1, 1,
  1, -1, -1, 1, -1, 0, 1, -1, 1,
  1, 0, -1, 1, 0, 0, 1, 0, 1,
  1, 1, -1, 1, 1, 0, 1, 1, 1,
]);

export function validateGraphLayoutInput(input: GraphLayoutInput): string[] {
  const issues: string[] = [];
  const nodeCount = input.nodeSeeds.length;
  if (!input.topologyHash) issues.push("topologyHash must not be empty");
  if (!input.layoutEpochId) issues.push("layoutEpochId must not be empty");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) issues.push("sequence must be a positive safe integer");
  if (input.nodeGroups.length !== nodeCount) issues.push("nodeGroups length must equal nodeSeeds length");
  if (input.initialPositions.length !== nodeCount * 3) issues.push("initialPositions must contain one xyz triple per node");
  if (input.continuityMask.length !== nodeCount) issues.push("continuityMask length must equal nodeSeeds length");
  if (input.edgeEndpoints.length % 2 !== 0) issues.push("edgeEndpoints must contain source/target pairs");
  if (!allFinite(input.initialPositions)) issues.push("initialPositions must be finite");
  for (let index = 0; index < input.continuityMask.length; index += 1) {
    if ((input.continuityMask[index] ?? 0) > 1) {
      issues.push("continuityMask values must be zero or one");
      break;
    }
  }
  for (let edge = 0; edge < input.edgeEndpoints.length / 2; edge += 1) {
    const source = input.edgeEndpoints[edge * 2] ?? nodeCount;
    const target = input.edgeEndpoints[edge * 2 + 1] ?? nodeCount;
    if (source >= nodeCount || target >= nodeCount || source === target) {
      issues.push(`edge ${edge} must contain distinct in-bounds endpoints`);
      break;
    }
  }
  return issues;
}

export function createGraphLayoutSimulation(input: GraphLayoutInput): GraphLayoutSimulation {
  const issues = validateGraphLayoutInput(input);
  if (issues.length) throw new Error(`Invalid graph layout input: ${issues.join("; ")}`);
  const nodeCount = input.nodeSeeds.length;
  const edgeCount = input.edgeEndpoints.length / 2;
  const positions = new Float32Array(input.initialPositions);
  const velocities = new Float32Array(nodeCount * 3);
  const forces = new Float32Array(nodeCount * 3);
  const warmAnchors = new Float32Array(nodeCount * 3);
  const groupIds = [...new Set(input.nodeGroups)].sort((left, right) => left - right);
  const groupIndex = new Map(groupIds.map((group, index) => [group, index]));
  const groupOfNode = new Uint32Array(nodeCount);
  const groupAnchors = createGroupAnchors(groupIds.length, nodeCount);
  let continuityCount = 0;
  for (let index = 0; index < nodeCount; index += 1) {
    groupOfNode[index] = groupIndex.get(input.nodeGroups[index] ?? 0) ?? 0;
    if (input.continuityMask[index] !== 1) continue;
    continuityCount += 1;
    warmAnchors.set(positions.subarray(index * 3, index * 3 + 3), index * 3);
  }
  const edgeSources = new Uint32Array(edgeCount);
  const edgeTargets = new Uint32Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    edgeSources[edge] = input.edgeEndpoints[edge * 2] ?? 0;
    edgeTargets[edge] = input.edgeEndpoints[edge * 2 + 1] ?? 0;
  }
  const densityScale = Math.sqrt(Math.max(1, nodeCount / 250));
  const spatial = createSpatialIndex(nodeCount, {
    cellSize: Math.min(160, BASE_CELL_SIZE * Math.pow(Math.max(1, nodeCount / 250), 1 / 6)),
    exactCellPairLimit: Math.max(8, Math.floor(96 / densityScale)),
    exactInternalCellLimit: Math.max(8, Math.floor(40 / densityScale)),
  });
  return {
    input,
    nodeCount,
    edgeCount,
    positions,
    velocities,
    forces,
    warmAnchors,
    groupAnchors,
    groupOfNode,
    edgeSources,
    edgeTargets,
    spatial,
    alpha: continuityCount ? 0.38 : 1,
    energy: nodeCount ? Number.POSITIVE_INFINITY : 0,
    iterations: 0,
    settled: nodeCount === 0,
  };
}

export function stepGraphLayoutSimulation(simulation: GraphLayoutSimulation, count = 1): void {
  const steps = Math.max(0, Math.floor(count));
  for (let step = 0; step < steps && !simulation.settled; step += 1) {
    simulation.forces.fill(0);
    buildSpatialIndex(simulation);
    applyRepulsion(simulation);
    for (let edge = 0; edge < simulation.edgeCount; edge += 1) {
      applySpring(simulation, simulation.edgeSources[edge] ?? 0, simulation.edgeTargets[edge] ?? 0);
    }
    let energy = 0;
    for (let node = 0; node < simulation.nodeCount; node += 1) {
      const offset = node * 3;
      const anchor = (simulation.groupOfNode[node] ?? 0) * 3;
      simulation.forces[offset] += (((simulation.groupAnchors[anchor] ?? 0) - (simulation.positions[offset] ?? 0)) * 0.00145
        - (simulation.positions[offset] ?? 0) * 0.00008) * simulation.alpha;
      simulation.forces[offset + 1] += (((simulation.groupAnchors[anchor + 1] ?? 0) - (simulation.positions[offset + 1] ?? 0)) * 0.00145
        - (simulation.positions[offset + 1] ?? 0) * 0.00008) * simulation.alpha;
      simulation.forces[offset + 2] += (((simulation.groupAnchors[anchor + 2] ?? 0) - (simulation.positions[offset + 2] ?? 0)) * 0.00145
        - (simulation.positions[offset + 2] ?? 0) * 0.00008) * simulation.alpha;
      if (simulation.input.continuityMask[node] === 1) {
        simulation.forces[offset] += ((simulation.warmAnchors[offset] ?? 0) - (simulation.positions[offset] ?? 0)) * WARM_ANCHOR_STRENGTH * simulation.alpha;
        simulation.forces[offset + 1] += ((simulation.warmAnchors[offset + 1] ?? 0) - (simulation.positions[offset + 1] ?? 0)) * WARM_ANCHOR_STRENGTH * simulation.alpha;
        simulation.forces[offset + 2] += ((simulation.warmAnchors[offset + 2] ?? 0) - (simulation.positions[offset + 2] ?? 0)) * WARM_ANCHOR_STRENGTH * simulation.alpha;
      }
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = offset + axis;
        const velocity = clamp(((simulation.velocities[coordinate] ?? 0) + (simulation.forces[coordinate] ?? 0)) * 0.82, -MAX_SPEED, MAX_SPEED);
        simulation.positions[coordinate] = (simulation.positions[coordinate] ?? 0) + velocity;
        simulation.velocities[coordinate] = velocity;
        energy += velocity * velocity;
      }
    }
    simulation.iterations += 1;
    if (!Number.isFinite(energy)) throw new NonFiniteGraphLayoutError(simulation.iterations);
    simulation.alpha *= 0.974;
    simulation.energy = energy / Math.max(1, simulation.nodeCount);
    if (simulation.alpha < 0.002 || (simulation.alpha < 0.06 && simulation.energy < 0.0008)) {
      simulation.alpha = 0;
      simulation.velocities.fill(0);
      simulation.settled = true;
    }
  }
}

export function runGraphLayoutToTerminal(input: GraphLayoutInput, maximumIterations = 320): GraphLayoutRunResult {
  const simulation = createGraphLayoutSimulation(input);
  stepGraphLayoutSimulation(simulation, maximumIterations);
  const positions = new Float32Array(simulation.positions);
  return {
    frame: {
      topologyHash: input.topologyHash,
      layoutEpochId: input.layoutEpochId,
      sequence: input.sequence,
      positions,
      settled: true,
    },
    checksum: graphLayoutChecksum(positions),
    energy: simulation.energy,
    iterations: simulation.iterations,
    estimatedBytes: estimateGraphLayoutBytes(simulation) + positions.byteLength,
    converged: simulation.settled,
  };
}

export function graphLayoutChecksum(positions: Float32Array): string {
  const words = new Uint32Array(positions.buffer, positions.byteOffset, positions.byteLength / 4);
  let hash = 2166136261;
  for (let index = 0; index < words.length; index += 1) hash = Math.imul(hash ^ (words[index] ?? 0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function estimateGraphLayoutBytes(simulation: GraphLayoutSimulation): number {
  const arrays: ArrayBufferView[] = [
    simulation.input.nodeSeeds,
    simulation.input.nodeGroups,
    simulation.input.edgeEndpoints,
    simulation.input.initialPositions,
    simulation.input.continuityMask,
    simulation.positions,
    simulation.velocities,
    simulation.forces,
    simulation.warmAnchors,
    simulation.groupAnchors,
    simulation.groupOfNode,
    simulation.edgeSources,
    simulation.edgeTargets,
    simulation.spatial.nextInCell,
    simulation.spatial.tableStamp,
    simulation.spatial.tableX,
    simulation.spatial.tableY,
    simulation.spatial.tableZ,
    simulation.spatial.tableHead,
    simulation.spatial.tableCount,
    simulation.spatial.tableSumX,
    simulation.spatial.tableSumY,
    simulation.spatial.tableSumZ,
    simulation.spatial.tableForceX,
    simulation.spatial.tableForceY,
    simulation.spatial.tableForceZ,
    simulation.spatial.occupiedSlots,
  ];
  return arrays.reduce((total, array) => total + array.byteLength, 0);
}

function createGroupAnchors(groupCount: number, nodeCount: number): Float32Array {
  const anchors = new Float32Array(groupCount * 3);
  const radius = Math.max(130, Math.sqrt(nodeCount) * 24);
  for (let index = 0; index < groupCount; index += 1) {
    const y = groupCount === 1 ? 0 : 1 - (index / Math.max(1, groupCount - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE;
    anchors[index * 3] = Math.cos(angle) * ring * radius;
    anchors[index * 3 + 1] = y * radius * 0.78;
    anchors[index * 3 + 2] = Math.sin(angle) * ring * radius;
  }
  return anchors;
}

function createSpatialIndex(
  nodeCount: number,
  options: Pick<GraphLayoutSpatialIndex, "cellSize" | "exactCellPairLimit" | "exactInternalCellLimit">,
): GraphLayoutSpatialIndex {
  let capacity = 16;
  while (capacity < nodeCount * 2) capacity <<= 1;
  return {
    nextInCell: new Int32Array(nodeCount),
    tableStamp: new Uint32Array(capacity),
    tableX: new Int32Array(capacity),
    tableY: new Int32Array(capacity),
    tableZ: new Int32Array(capacity),
    tableHead: new Int32Array(capacity),
    tableCount: new Uint32Array(capacity),
    tableSumX: new Float64Array(capacity),
    tableSumY: new Float64Array(capacity),
    tableSumZ: new Float64Array(capacity),
    tableForceX: new Float64Array(capacity),
    tableForceY: new Float64Array(capacity),
    tableForceZ: new Float64Array(capacity),
    occupiedSlots: new Int32Array(nodeCount),
    occupiedCount: 0,
    mask: capacity - 1,
    stamp: 0,
    ...options,
  };
}

function buildSpatialIndex(simulation: GraphLayoutSimulation): void {
  const spatial = simulation.spatial;
  spatial.stamp = (spatial.stamp + 1) >>> 0;
  if (spatial.stamp === 0) {
    spatial.tableStamp.fill(0);
    spatial.stamp = 1;
  }
  spatial.occupiedCount = 0;
  for (let node = 0; node < simulation.nodeCount; node += 1) {
    const offset = node * 3;
    const x = Math.floor((simulation.positions[offset] ?? 0) / spatial.cellSize);
    const y = Math.floor((simulation.positions[offset + 1] ?? 0) / spatial.cellSize);
    const z = Math.floor((simulation.positions[offset + 2] ?? 0) / spatial.cellSize);
    const slot = findCellSlot(spatial, x, y, z, true);
    spatial.nextInCell[node] = spatial.tableHead[slot] ?? -1;
    spatial.tableHead[slot] = node;
    spatial.tableCount[slot] += 1;
    spatial.tableSumX[slot] += simulation.positions[offset] ?? 0;
    spatial.tableSumY[slot] += simulation.positions[offset + 1] ?? 0;
    spatial.tableSumZ[slot] += simulation.positions[offset + 2] ?? 0;
  }
}

function applyRepulsion(simulation: GraphLayoutSimulation): void {
  const spatial = simulation.spatial;
  for (let occupied = 0; occupied < spatial.occupiedCount; occupied += 1) {
    const slot = spatial.occupiedSlots[occupied] ?? 0;
    const head = spatial.tableHead[slot] ?? -1;
    if ((spatial.tableCount[slot] ?? 0) <= spatial.exactInternalCellLimit) {
      for (let left = head; left >= 0; left = spatial.nextInCell[left] ?? -1) {
        for (let right = spatial.nextInCell[left] ?? -1; right >= 0; right = spatial.nextInCell[right] ?? -1) repelPair(simulation, left, right);
      }
    } else {
      repelWithinDenseCell(simulation, slot);
    }
    for (let offset = 0; offset < FORWARD_NEIGHBORS.length; offset += 3) {
      const neighbor = findCellSlot(
        spatial,
        (spatial.tableX[slot] ?? 0) + (FORWARD_NEIGHBORS[offset] ?? 0),
        (spatial.tableY[slot] ?? 0) + (FORWARD_NEIGHBORS[offset + 1] ?? 0),
        (spatial.tableZ[slot] ?? 0) + (FORWARD_NEIGHBORS[offset + 2] ?? 0),
        false,
      );
      if (neighbor < 0) continue;
      if ((spatial.tableCount[slot] ?? 0) * (spatial.tableCount[neighbor] ?? 0) <= spatial.exactCellPairLimit) {
        for (let left = head; left >= 0; left = spatial.nextInCell[left] ?? -1) {
          for (let right = spatial.tableHead[neighbor] ?? -1; right >= 0; right = spatial.nextInCell[right] ?? -1) repelPair(simulation, left, right);
        }
      } else {
        repelCellPair(simulation, slot, neighbor);
      }
    }
  }
  distributeCellForces(simulation);
}

function findCellSlot(spatial: GraphLayoutSpatialIndex, x: number, y: number, z: number, create: boolean): number {
  let slot = hashCell(x, y, z) & spatial.mask;
  while (spatial.tableStamp[slot] === spatial.stamp) {
    if (spatial.tableX[slot] === x && spatial.tableY[slot] === y && spatial.tableZ[slot] === z) return slot;
    slot = (slot + 1) & spatial.mask;
  }
  if (!create) return -1;
  spatial.tableStamp[slot] = spatial.stamp;
  spatial.tableX[slot] = x;
  spatial.tableY[slot] = y;
  spatial.tableZ[slot] = z;
  spatial.tableHead[slot] = -1;
  spatial.tableCount[slot] = 0;
  spatial.tableSumX[slot] = 0;
  spatial.tableSumY[slot] = 0;
  spatial.tableSumZ[slot] = 0;
  spatial.tableForceX[slot] = 0;
  spatial.tableForceY[slot] = 0;
  spatial.tableForceZ[slot] = 0;
  spatial.occupiedSlots[spatial.occupiedCount++] = slot;
  return slot;
}

function repelWithinDenseCell(simulation: GraphLayoutSimulation, slot: number): void {
  const spatial = simulation.spatial;
  const count = spatial.tableCount[slot] ?? 0;
  const otherCount = count - 1;
  for (let node = spatial.tableHead[slot] ?? -1; node >= 0; node = spatial.nextInCell[node] ?? -1) {
    const offset = node * 3;
    applyAggregateToNode(
      simulation,
      node,
      ((spatial.tableSumX[slot] ?? 0) - (simulation.positions[offset] ?? 0)) / otherCount,
      ((spatial.tableSumY[slot] ?? 0) - (simulation.positions[offset + 1] ?? 0)) / otherCount,
      ((spatial.tableSumZ[slot] ?? 0) - (simulation.positions[offset + 2] ?? 0)) / otherCount,
      otherCount,
    );
  }
}

function applyAggregateToNode(simulation: GraphLayoutSimulation, node: number, centerX: number, centerY: number, centerZ: number, mass: number): void {
  const offset = node * 3;
  let dx = (simulation.positions[offset] ?? 0) - centerX;
  let dy = (simulation.positions[offset + 1] ?? 0) - centerY;
  let dz = (simulation.positions[offset + 2] ?? 0) - centerZ;
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = mix32((simulation.input.nodeSeeds[node] ?? 0) ^ 0x85ebca6b);
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(simulation, distanceSquared) * mass;
  simulation.forces[offset] += dx * strength;
  simulation.forces[offset + 1] += dy * strength;
  simulation.forces[offset + 2] += dz * strength;
}

function repelCellPair(simulation: GraphLayoutSimulation, left: number, right: number): void {
  const spatial = simulation.spatial;
  const leftCount = spatial.tableCount[left] ?? 1;
  const rightCount = spatial.tableCount[right] ?? 1;
  let dx = (spatial.tableSumX[left] ?? 0) / leftCount - (spatial.tableSumX[right] ?? 0) / rightCount;
  let dy = (spatial.tableSumY[left] ?? 0) / leftCount - (spatial.tableSumY[right] ?? 0) / rightCount;
  let dz = (spatial.tableSumZ[left] ?? 0) / leftCount - (spatial.tableSumZ[right] ?? 0) / rightCount;
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = hashCell(
      (spatial.tableX[left] ?? 0) ^ (spatial.tableX[right] ?? 0),
      (spatial.tableY[left] ?? 0) ^ (spatial.tableY[right] ?? 0),
      (spatial.tableZ[left] ?? 0) ^ (spatial.tableZ[right] ?? 0),
    );
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(simulation, distanceSquared) * leftCount * rightCount;
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  spatial.tableForceX[left] += fx;
  spatial.tableForceY[left] += fy;
  spatial.tableForceZ[left] += fz;
  spatial.tableForceX[right] -= fx;
  spatial.tableForceY[right] -= fy;
  spatial.tableForceZ[right] -= fz;
}

function distributeCellForces(simulation: GraphLayoutSimulation): void {
  const spatial = simulation.spatial;
  for (let occupied = 0; occupied < spatial.occupiedCount; occupied += 1) {
    const slot = spatial.occupiedSlots[occupied] ?? 0;
    const count = spatial.tableCount[slot] ?? 1;
    if (!spatial.tableForceX[slot] && !spatial.tableForceY[slot] && !spatial.tableForceZ[slot]) continue;
    const fx = (spatial.tableForceX[slot] ?? 0) / count;
    const fy = (spatial.tableForceY[slot] ?? 0) / count;
    const fz = (spatial.tableForceZ[slot] ?? 0) / count;
    for (let node = spatial.tableHead[slot] ?? -1; node >= 0; node = spatial.nextInCell[node] ?? -1) {
      const offset = node * 3;
      simulation.forces[offset] += fx;
      simulation.forces[offset + 1] += fy;
      simulation.forces[offset + 2] += fz;
    }
  }
}

function repelPair(simulation: GraphLayoutSimulation, left: number, right: number): void {
  const a = left * 3;
  const b = right * 3;
  let dx = (simulation.positions[a] ?? 0) - (simulation.positions[b] ?? 0);
  let dy = (simulation.positions[a + 1] ?? 0) - (simulation.positions[b + 1] ?? 0);
  let dz = (simulation.positions[a + 2] ?? 0) - (simulation.positions[b + 2] ?? 0);
  let distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared < 0.01) {
    const seed = mix32((simulation.input.nodeSeeds[left] ?? 0) ^ Math.imul(simulation.input.nodeSeeds[right] ?? 0, 0x9e3779b1));
    dx = ((seed & 255) / 255 - 0.5) * 0.2;
    dy = (((seed >>> 8) & 255) / 255 - 0.5) * 0.2;
    dz = (((seed >>> 16) & 255) / 255 - 0.5) * 0.2;
    distanceSquared = Math.max(0.000001, dx * dx + dy * dy + dz * dz);
  }
  const strength = repulsionStrength(simulation, distanceSquared);
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  simulation.forces[a] += fx;
  simulation.forces[a + 1] += fy;
  simulation.forces[a + 2] += fz;
  simulation.forces[b] -= fx;
  simulation.forces[b + 1] -= fy;
  simulation.forces[b + 2] -= fz;
}

function repulsionStrength(simulation: GraphLayoutSimulation, distanceSquared: number): number {
  return Math.min(1.7, REPULSION / (distanceSquared + 120)) * simulation.alpha / Math.sqrt(distanceSquared);
}

function applySpring(simulation: GraphLayoutSimulation, source: number, target: number): void {
  const a = source * 3;
  const b = target * 3;
  const dx = (simulation.positions[b] ?? 0) - (simulation.positions[a] ?? 0);
  const dy = (simulation.positions[b + 1] ?? 0) - (simulation.positions[a + 1] ?? 0);
  const dz = (simulation.positions[b + 2] ?? 0) - (simulation.positions[a + 2] ?? 0);
  const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
  const sameGroup = simulation.groupOfNode[source] === simulation.groupOfNode[target];
  const restLength = sameGroup ? 44 : 104;
  const strength = (distance - restLength) * (sameGroup ? 0.0105 : 0.0075) * simulation.alpha / distance;
  const fx = dx * strength;
  const fy = dy * strength;
  const fz = dz * strength;
  simulation.forces[a] += fx;
  simulation.forces[a + 1] += fy;
  simulation.forces[a + 2] += fz;
  simulation.forces[b] -= fx;
  simulation.forces[b + 1] -= fy;
  simulation.forces[b + 2] -= fz;
}

function hashCell(x: number, y: number, z: number): number {
  return mix32(Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f));
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function allFinite(values: Float32Array): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
