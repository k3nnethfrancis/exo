import { describe, expect, it } from "vitest";

import { shouldPreserveGraphScene } from "./SpatialGraphView";

describe("SpatialGraphView refresh continuity", () => {
  it("preserves the settled scene when refresh returns the same complete graph epoch", () => {
    expect(shouldPreserveGraphScene("snapshot-1", "snapshot-1", 12, 4)).toBe(true);
  });

  it("rebuilds the scene for a changed epoch or incomplete position buffer", () => {
    expect(shouldPreserveGraphScene("snapshot-1", "snapshot-2", 12, 4)).toBe(false);
    expect(shouldPreserveGraphScene("snapshot-1", "snapshot-1", 9, 4)).toBe(false);
  });
});
