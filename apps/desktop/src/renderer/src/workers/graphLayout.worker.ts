import type { GraphViewProjection } from "@exo/core";

import { hash32, seededGraphPositions } from "../graphScene";

interface LayoutRequest { projection: GraphViewProjection }

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { projection } = event.data;
  const positions = seededGraphPositions(projection);
  const count = projection.nodes.length;
  if (count === 0) {
    self.postMessage({ positions }, { transfer: [positions.buffer] });
    return;
  }
  const velocity = new Float32Array(count * 3);
  const force = new Float32Array(count * 3);
  const groups = [...new Set(projection.nodes.map((node) => node.group))].sort();
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const groupAnchors = new Float32Array(groups.length * 3);
  const groupCounts = new Uint32Array(groups.length);
  projection.nodes.forEach((node, index) => {
    const group = groupIndex.get(node.group) ?? 0;
    groupAnchors[group * 3] += positions[index * 3];
    groupAnchors[group * 3 + 1] += positions[index * 3 + 1];
    groupAnchors[group * 3 + 2] += positions[index * 3 + 2];
    groupCounts[group] += 1;
  });
  groups.forEach((_, group) => {
    const countInGroup = Math.max(1, groupCounts[group]);
    groupAnchors[group * 3] /= countInGroup;
    groupAnchors[group * 3 + 1] /= countInGroup;
    groupAnchors[group * 3 + 2] /= countInGroup;
  });
  const iterations = count > 5_000 ? 100 : count > 1_000 ? 150 : 220;
  const sampleCount = Math.min(24, Math.max(0, count - 1));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    force.fill(0);
    const heat = Math.max(0.035, 1 - iteration / iterations);
    for (const edge of projection.edges) {
      const source = edge.source * 3;
      const target = edge.target * 3;
      const dx = positions[target] - positions[source];
      const dy = positions[target + 1] - positions[source + 1];
      const dz = positions[target + 2] - positions[source + 2];
      const distance = Math.max(1, Math.hypot(dx, dy, dz));
      const pull = (distance - 82) * 0.0038;
      const fx = dx / distance * pull;
      const fy = dy / distance * pull;
      const fz = dz / distance * pull;
      force[source] += fx; force[source + 1] += fy; force[source + 2] += fz;
      force[target] -= fx; force[target + 1] -= fy; force[target + 2] -= fz;
    }
    for (let index = 0; index < count; index += 1) {
      const source = index * 3;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const candidate = (hash32(`${projection.seed}:${index}:${sample}`) + iteration * 2654435761) % count;
        if (candidate === index) continue;
        const target = candidate * 3;
        const dx = positions[source] - positions[target];
        const dy = positions[source + 1] - positions[target + 1];
        const dz = positions[source + 2] - positions[target + 2];
        const distanceSquared = Math.max(36, dx * dx + dy * dy + dz * dz);
        const repulsion = Math.min(1.1, 230 / distanceSquared);
        force[source] += dx * repulsion;
        force[source + 1] += dy * repulsion;
        force[source + 2] += dz * repulsion;
      }
      const group = groupIndex.get(projection.nodes[index].group) ?? 0;
      force[source] += (groupAnchors[group * 3] - positions[source]) * 0.0012;
      force[source + 1] += (groupAnchors[group * 3 + 1] - positions[source + 1]) * 0.0012;
      force[source + 2] += (groupAnchors[group * 3 + 2] - positions[source + 2]) * 0.0012;
      force[source] -= positions[source] * 0.000035;
      force[source + 1] -= positions[source + 1] * 0.000035;
      force[source + 2] -= positions[source + 2] * 0.000035;
    }
    for (let index = 0; index < positions.length; index += 1) {
      velocity[index] = (velocity[index] + force[index] * heat) * 0.82;
      positions[index] += velocity[index];
    }
  }
  self.postMessage({ positions }, { transfer: [positions.buffer] });
};
