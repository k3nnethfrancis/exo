import { describe, expect, it } from "vitest";
import type { GraphViewProjection } from "@exo/core";

import {
  frameGraphCamera,
  graphNeighbors,
  projectGraphPositions,
  seededGraphPositions,
  shortestGraphPath,
} from "./graphScene";

const projection: GraphViewProjection = {
  version: "0.1",
  layoutVersion: "finite-force-0.1",
  sourceSnapshotId: "fixture",
  seed: 17,
  nodes: [
    { id: "a", label: "A", path: "a.md", group: "one", kind: "concept", degree: 1 },
    { id: "b", label: "B", path: "b.md", group: "one", kind: "concept", degree: 2 },
    { id: "c", label: "C", path: "c.md", group: "two", kind: "concept", degree: 1 },
  ],
  edges: [
    { id: "ab", source: 0, target: 1, family: "link", authority: "authored", resolution: "resolved", directed: true },
    { id: "bc", source: 1, target: 2, family: "link", authority: "authored", resolution: "resolved", directed: true },
  ],
  omitted: { tagConcepts: 0, tagRelations: 0 },
};

describe("graph scene", () => {
  it("creates deterministic spatial seeds and a finite framing camera", () => {
    const positions = seededGraphPositions(projection);
    expect([...positions]).toEqual([...seededGraphPositions(projection)]);
    expect(new Set([...positions]).size).toBeGreaterThan(3);
    expect(frameGraphCamera(positions)).toMatchObject({ distance: expect.any(Number), target: [expect.any(Number), expect.any(Number), expect.any(Number)] });
  });

  it("keeps pathfinding and neighborhood meaning outside the renderer", () => {
    expect([...graphNeighbors(projection, 1)].sort()).toEqual([0, 2]);
    const path = shortestGraphPath(projection, 0, 2);
    expect(path.status).toBe("found");
    expect([...path.nodes].sort()).toEqual([0, 1, 2]);
    expect([...path.edgeIds].sort()).toEqual(["ab", "bc"]);
  });

  it("reports an unreachable target without inventing a path", () => {
    const isolated = { ...projection, edges: projection.edges.slice(0, 1) };
    expect(shortestGraphPath(isolated, 0, 2)).toMatchObject({ status: "unreachable" });
    expect(shortestGraphPath(isolated, 0, 2).edgeIds.size).toBe(0);
  });

  it("projects spatial coordinates into a bounded viewport without mutating topology", () => {
    const positions = seededGraphPositions(projection);
    const camera = frameGraphCamera(positions);
    const projected = projectGraphPositions(positions, camera, 800, 600);
    expect(projected).toHaveLength(3);
    expect(projected.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.depth))).toBe(true);
    expect(projection.edges).toHaveLength(2);
  });
});
