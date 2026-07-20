import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import type { GraphTopology } from "@exo/core";

import {
  createDeterministicLayout,
  createGraphLayoutInput,
  reconcileGraphLayout,
  type GraphLayoutInput,
  type GraphTopologyArrays,
} from "./graphSceneFoundation";
import {
  createGraphLayoutSimulation,
  estimateGraphLayoutBytes,
  graphLayoutChecksum,
  runGraphLayoutToTerminal,
  stepGraphLayoutSimulation,
  validateGraphLayoutInput,
} from "./graphLayoutSimulation";

function topology(nodeCount: number, edgeCount: number, suffix = "base"): GraphTopologyArrays {
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const visualClasses = new Uint8Array(nodeCount);
  const endpoints = new Uint32Array(edgeCount * 2);
  for (let node = 0; node < nodeCount; node += 1) {
    identityKeys[node * 2] = node + 1;
    identityKeys[node * 2 + 1] = (node ^ 0xa5a5a5a5) >>> 0;
    seeds[node] = Math.imul(node + 1, 0x9e3779b1) >>> 0;
    groups[node] = node % 12;
  }
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const source = edge % nodeCount;
    let target = (Math.imul(edge, 7919) + 17) % nodeCount;
    if (target === source) target = (target + 1) % nodeCount;
    endpoints[edge * 2] = source;
    endpoints[edge * 2 + 1] = target;
    degrees[source] += 1;
    degrees[target] += 1;
  }
  return {
    topologyHash: `topology-${suffix}`,
    layoutEpochId: `layout-${suffix}`,
    seed: 17,
    nodes: { identityKeys, seeds, groups, degrees, visualClasses },
    edges: { endpoints, visualClasses: new Uint8Array(edgeCount) },
  } as Pick<GraphTopology, "topologyHash" | "layoutEpochId" | "seed" | "nodes" | "edges">;
}

function input(graph: GraphTopologyArrays): GraphLayoutInput {
  return createGraphLayoutInput(graph, createDeterministicLayout(graph));
}

function extendTopology(base: GraphTopologyArrays, addedCount: number): GraphTopologyArrays {
  const oldCount = base.nodes.seeds.length;
  const nodeCount = oldCount + addedCount;
  const identityKeys = new Uint32Array(nodeCount * 2);
  const seeds = new Uint32Array(nodeCount);
  const groups = new Uint32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const visualClasses = new Uint8Array(nodeCount);
  identityKeys.set(base.nodes.identityKeys);
  seeds.set(base.nodes.seeds);
  groups.set(base.nodes.groups);
  visualClasses.set(base.nodes.visualClasses);
  for (let node = oldCount; node < nodeCount; node += 1) {
    identityKeys[node * 2] = node + 1;
    identityKeys[node * 2 + 1] = (node ^ 0xa5a5a5a5) >>> 0;
    seeds[node] = Math.imul(node + 1, 0x9e3779b1) >>> 0;
    groups[node] = node % 12;
  }
  const oldEdgeCount = base.edges.visualClasses.length;
  const edgeCount = oldEdgeCount + addedCount * 2;
  const endpoints = new Uint32Array(edgeCount * 2);
  endpoints.set(base.edges.endpoints);
  for (let added = 0; added < addedCount; added += 1) {
    const node = oldCount + added;
    endpoints[(oldEdgeCount + added * 2) * 2] = node;
    endpoints[(oldEdgeCount + added * 2) * 2 + 1] = added % oldCount;
    endpoints[(oldEdgeCount + added * 2 + 1) * 2] = node;
    endpoints[(oldEdgeCount + added * 2 + 1) * 2 + 1] = (added * 97 + 31) % oldCount;
  }
  for (let edge = 0; edge < edgeCount; edge += 1) {
    degrees[endpoints[edge * 2] ?? 0] += 1;
    degrees[endpoints[edge * 2 + 1] ?? 0] += 1;
  }
  return {
    topologyHash: "topology-incremental",
    layoutEpochId: "layout-incremental",
    seed: base.seed,
    nodes: { identityKeys, seeds, groups, degrees, visualClasses },
    edges: { endpoints, visualClasses: new Uint8Array(edgeCount) },
  } as Pick<GraphTopology, "topologyHash" | "layoutEpochId" | "seed" | "nodes" | "edges">;
}

describe("graph layout simulation", () => {
  it("settles to a deterministic checksum for identical typed input", () => {
    const fixture = input(topology(240, 480));
    const first = runGraphLayoutToTerminal(fixture);
    const second = runGraphLayoutToTerminal(fixture);
    expect(first.converged).toBe(true);
    expect(first.checksum).toBe("1cbe14ad");
    expect(first.checksum).toBe(second.checksum);
    expect(first.frame.positions).toEqual(second.frame.positions);
    expect(first.frame).toMatchObject({ topologyHash: fixture.topologyHash, layoutEpochId: fixture.layoutEpochId, sequence: 1, settled: true });
    expect(first.iterations).toBe(second.iterations);
  });

  it("rejects malformed arrays and non-finite state before simulation", () => {
    const fixture = input(topology(4, 3));
    const malformed = {
      ...fixture,
      initialPositions: new Float32Array([Number.NaN]),
      continuityMask: new Uint8Array([2]),
      edgeEndpoints: new Uint32Array([0, 99, 2]),
    };
    expect(validateGraphLayoutInput(malformed)).toEqual(expect.arrayContaining([
      "initialPositions must contain one xyz triple per node",
      "continuityMask length must equal nodeSeeds length",
      "edgeEndpoints must contain source/target pairs",
      "initialPositions must be finite",
      "continuityMask values must be zero or one",
      "edge 0 must contain distinct in-bounds endpoints",
    ]));
    expect(() => createGraphLayoutSimulation(malformed)).toThrow("Invalid graph layout input");
  });

  it("rejects non-finite state instead of emitting a corrupt frame", () => {
    const simulation = createGraphLayoutSimulation(input(topology(4, 3)));
    simulation.positions[0] = Number.NaN;
    expect(() => stepGraphLayoutSimulation(simulation)).toThrow("Graph layout became non-finite at iteration 1");
  });

  it("emits the best finite terminal state when an explicit iteration cap is reached", () => {
    const result = runGraphLayoutToTerminal(input(topology(80, 160)), 1);
    expect(result.converged).toBe(false);
    expect(result.frame.settled).toBe(true);
    expect(result.iterations).toBe(1);
    expect([...result.frame.positions].every(Number.isFinite)).toBe(true);
  });

  it("preserves a 1% topology update within normalized Procrustes p95 <= 0.10", () => {
    const baseTopology = topology(1_000, 2_000);
    const base = runGraphLayoutToTerminal(input(baseTopology));
    const nextTopology = extendTopology(baseTopology, 10);
    const previousLayout = {
      topologyHash: baseTopology.topologyHash,
      layoutEpochId: baseTopology.layoutEpochId,
      sequence: base.frame.sequence,
      positions: base.frame.positions,
      continuityMask: new Uint8Array(baseTopology.nodes.seeds.length),
      settled: true,
    };
    const warm = reconcileGraphLayout(baseTopology, previousLayout, nextTopology);
    const next = runGraphLayoutToTerminal(createGraphLayoutInput(nextTopology, warm));
    const unchanged = next.frame.positions.slice(0, base.frame.positions.length);
    expect(warm.continuityMask.reduce((sum, value) => sum + value, 0)).toBe(1_000);
    expect(procrustesP95(base.frame.positions, unchanged)).toBeLessThanOrEqual(0.10);
  }, 15_000);

  it("keeps 10K-node/50K-edge simulation bounded in time and typed-array memory", () => {
    const fixture = input(topology(10_000, 50_000, "10k-50k"));
    const simulation = createGraphLayoutSimulation(fixture);
    const allocatedBytes = estimateGraphLayoutBytes(simulation);
    const started = performance.now();
    stepGraphLayoutSimulation(simulation, 320);
    const elapsed = performance.now() - started;
    expect(simulation.settled).toBe(true);
    expect(graphLayoutChecksum(simulation.positions)).toMatch(/^[0-9a-f]{8}$/u);
    expect(allocatedBytes).toBeLessThan(16 * 1024 * 1024);
    expect(elapsed).toBeLessThan(5_000);
  }, 15_000);
});

function procrustesP95(reference: Float32Array, candidate: Float32Array): number {
  const count = reference.length / 3;
  const referenceCenter = centroid(reference);
  const candidateCenter = centroid(candidate);
  const covariance = new Float64Array(9);
  let referenceEnergy = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = (reference[offset] ?? 0) - referenceCenter[0];
    const py = (reference[offset + 1] ?? 0) - referenceCenter[1];
    const pz = (reference[offset + 2] ?? 0) - referenceCenter[2];
    const qx = (candidate[offset] ?? 0) - candidateCenter[0];
    const qy = (candidate[offset + 1] ?? 0) - candidateCenter[1];
    const qz = (candidate[offset + 2] ?? 0) - candidateCenter[2];
    covariance[0] += px * qx; covariance[1] += px * qy; covariance[2] += px * qz;
    covariance[3] += py * qx; covariance[4] += py * qy; covariance[5] += py * qz;
    covariance[6] += pz * qx; covariance[7] += pz * qy; covariance[8] += pz * qz;
    referenceEnergy += px * px + py * py + pz * pz;
  }
  const rotation = quaternionMatrix(dominantQuaternion(covariance));
  let scaleNumerator = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = (reference[offset] ?? 0) - referenceCenter[0];
    const py = (reference[offset + 1] ?? 0) - referenceCenter[1];
    const pz = (reference[offset + 2] ?? 0) - referenceCenter[2];
    const rx = rotation[0] * px + rotation[1] * py + rotation[2] * pz;
    const ry = rotation[3] * px + rotation[4] * py + rotation[5] * pz;
    const rz = rotation[6] * px + rotation[7] * py + rotation[8] * pz;
    scaleNumerator += rx * ((candidate[offset] ?? 0) - candidateCenter[0])
      + ry * ((candidate[offset + 1] ?? 0) - candidateCenter[1])
      + rz * ((candidate[offset + 2] ?? 0) - candidateCenter[2]);
  }
  const scale = referenceEnergy > 1e-12 ? scaleNumerator / referenceEnergy : 1;
  const rms = Math.sqrt(referenceEnergy / Math.max(1, count)) || 1;
  const displacement = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const px = (reference[offset] ?? 0) - referenceCenter[0];
    const py = (reference[offset + 1] ?? 0) - referenceCenter[1];
    const pz = (reference[offset + 2] ?? 0) - referenceCenter[2];
    const x = candidateCenter[0] + scale * (rotation[0] * px + rotation[1] * py + rotation[2] * pz);
    const y = candidateCenter[1] + scale * (rotation[3] * px + rotation[4] * py + rotation[5] * pz);
    const z = candidateCenter[2] + scale * (rotation[6] * px + rotation[7] * py + rotation[8] * pz);
    displacement[index] = Math.hypot(x - (candidate[offset] ?? 0), y - (candidate[offset + 1] ?? 0), z - (candidate[offset + 2] ?? 0)) / rms;
  }
  displacement.sort((left, right) => left - right);
  return displacement[Math.floor((displacement.length - 1) * 0.95)] ?? 0;
}

function centroid(positions: Float32Array): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  const count = positions.length / 3;
  for (let index = 0; index < positions.length; index += 3) {
    center[0] += positions[index] ?? 0;
    center[1] += positions[index + 1] ?? 0;
    center[2] += positions[index + 2] ?? 0;
  }
  return [center[0] / count, center[1] / count, center[2] / count];
}

function dominantQuaternion(h: Float64Array): [number, number, number, number] {
  const [hxx, hxy, hxz, hyx, hyy, hyz, hzx, hzy, hzz] = h;
  const trace = (hxx ?? 0) + (hyy ?? 0) + (hzz ?? 0);
  const matrix = new Float64Array([
    trace, (hyz ?? 0) - (hzy ?? 0), (hzx ?? 0) - (hxz ?? 0), (hxy ?? 0) - (hyx ?? 0),
    (hyz ?? 0) - (hzy ?? 0), (hxx ?? 0) - (hyy ?? 0) - (hzz ?? 0), (hxy ?? 0) + (hyx ?? 0), (hzx ?? 0) + (hxz ?? 0),
    (hzx ?? 0) - (hxz ?? 0), (hxy ?? 0) + (hyx ?? 0), -(hxx ?? 0) + (hyy ?? 0) - (hzz ?? 0), (hyz ?? 0) + (hzy ?? 0),
    (hxy ?? 0) - (hyx ?? 0), (hzx ?? 0) + (hxz ?? 0), (hyz ?? 0) + (hzy ?? 0), -(hxx ?? 0) - (hyy ?? 0) + (hzz ?? 0),
  ]);
  let bound = 1;
  for (let row = 0; row < 4; row += 1) {
    let sum = 0;
    for (let column = 0; column < 4; column += 1) sum += Math.abs(matrix[row * 4 + column] ?? 0);
    bound = Math.max(bound, sum);
  }
  for (let index = 0; index < 4; index += 1) matrix[index * 4 + index] += bound;
  let vector: [number, number, number, number] = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const next: [number, number, number, number] = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) next[row] += (matrix[row * 4 + column] ?? 0) * (vector[column] ?? 0);
    }
    const length = Math.hypot(...next) || 1;
    vector = [next[0] / length, next[1] / length, next[2] / length, next[3] / length];
  }
  return vector;
}

function quaternionMatrix([w, x, y, z]: [number, number, number, number]): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
