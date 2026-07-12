import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { deriveGraphBacklinks, type GraphSnapshot } from "../graph";

describe("graph contracts", () => {
  it("defines read-only graph snapshots with outgoing edges as canonical facts", () => {
    const snapshot: GraphSnapshot = {
      version: "0.1",
      snapshotId: "graph-snapshot:0.1:test",
      generatedAt: "2026-06-26T00:00:00.000Z",
      schema: {
        version: "0.1",
        nodeKinds: ["note", "tag", "external", "unresolved"],
        edgeKinds: ["wikilink", "markdownLink", "hasTag"],
        canonicalEdgeDirection: "outgoing",
        backlinks: "derived",
      },
      scope: { noteRootIds: ["notes"], paths: ["notes/**/*.md"] },
      nodes: [
        {
          id: "note:/vault/A.md",
          kind: "note",
          label: "A",
          filePath: "/vault/A.md",
          metadata: { tags: ["research"] },
        },
        {
          id: "note:/vault/B.md",
          kind: "note",
          label: "B",
          filePath: "/vault/B.md",
          metadata: {},
        },
      ],
      edges: [
        {
          id: "note:/vault/A.md->note:/vault/B.md#wikilink:0",
          kind: "wikilink",
          source: "note:/vault/A.md",
          target: "note:/vault/B.md",
          directed: true,
          resolution: "resolved",
          metadata: { targetText: "B", sourceFilePath: "/vault/A.md" },
        },
      ],
      warnings: [],
    };

    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]?.kind).toBe("wikilink");
    expect(deriveGraphBacklinks(snapshot)).toEqual([
      {
        source: "note:/vault/B.md",
        target: "note:/vault/A.md",
        edgeId: "note:/vault/A.md->note:/vault/B.md#wikilink:0",
        kind: "wikilink",
        resolution: "resolved",
      },
    ]);
  });

  it("keeps graph model files decoupled from plugin and capability metadata", () => {
    const source = readFileSync(new URL("../graph.ts", import.meta.url), "utf8");

    expect(source).not.toContain("./capabilities");
    expect(source).not.toContain("./plugin");
    expect(source).not.toContain("graphVisualizationFromCapability");
    expect(source).not.toContain("graphVisualizationsFromPlugin");
  });
});
