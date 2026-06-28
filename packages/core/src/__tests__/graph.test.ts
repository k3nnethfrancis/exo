import { describe, expect, it } from "vitest";

import type { CapabilityMetadata } from "../capabilities";
import { deriveGraphBacklinks, graphVisualizationFromCapability, graphVisualizationsFromPlugin, type GraphSnapshot } from "../graph";
import type { DiscoveredPlugin, PluginManifest } from "../plugin";

const graphCapability: CapabilityMetadata = {
  id: "default-graph.view",
  kind: "graphVisualization",
  label: "Default Graph",
  description: "Renders a core graph snapshot.",
  lifecycle: "experimental",
  owner: "default-graph.plugin",
  surfaces: ["desktop"],
  permissions: ["workspace:read", "notes:read"],
  compatibility: {
    graphVisualization: {
      graphDataVersion: "0.1",
      acceptedNodeKinds: ["note", "tag", "unresolved"],
      acceptedEdgeKinds: ["wikilink", "hasTag"],
      hostSurface: "editorPane",
      renderMode: "2d",
      preferredPlacement: "editorGrid",
    },
  },
};

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
      scope: { noteRootIds: ["notes"], projectRootIds: [], paths: ["notes/**/*.md"] },
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

  it("extracts graph visualization metadata from capabilities", () => {
    expect(graphVisualizationFromCapability(graphCapability)).toMatchObject({
      id: "default-graph.view",
      graphDataVersion: "0.1",
      acceptedNodeKinds: ["note", "tag", "unresolved"],
      acceptedEdgeKinds: ["wikilink", "hasTag"],
      hostSurface: "editorPane",
      renderMode: "2d",
      preferredPlacement: "editorGrid",
      data: {
        snapshotVersion: "0.1",
        acceptedNodeKinds: ["note", "tag", "unresolved"],
        acceptedEdgeKinds: ["wikilink", "hasTag"],
      },
      surface: {
        hostSurface: "editorPane",
        renderMode: "2d",
        preferredPlacement: "editorGrid",
      },
      sourceCapabilityId: "default-graph.view",
    });
  });

  it("defaults accepted graph data kinds when a visualization omits them", () => {
    expect(
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphVisualization: { graphDataVersion: "0.1", hostSurface: "webPreview", renderMode: "3d" } },
      }),
    ).toMatchObject({
      acceptedNodeKinds: ["note", "tag", "external", "unresolved"],
      acceptedEdgeKinds: ["wikilink", "markdownLink", "hasTag"],
      hostSurface: "webPreview",
      renderMode: "3d",
      preferredPlacement: "webPreview",
    });
  });

  it("accepts the legacy flat graph visualization payload during manifest migration", () => {
    expect(
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphDataVersion: "0.1", hostSurface: "editorPane" },
      }),
    ).toMatchObject({
      graphDataVersion: "0.1",
      hostSurface: "editorPane",
    });
  });

  it("filters graph visualization capabilities by lifecycle and surface", () => {
    const plugin = discovered({
      capabilities: [
        graphCapability,
        {
          ...graphCapability,
          id: "disabled.view",
          lifecycle: "disabled",
        },
      ],
    });

    expect(graphVisualizationsFromPlugin(plugin).map((view) => view.id)).toEqual(["default-graph.view"]);
    expect(graphVisualizationsFromPlugin(plugin, { includeDisabled: true }).map((view) => view.id)).toEqual([
      "default-graph.view",
      "disabled.view",
    ]);
    expect(graphVisualizationsFromPlugin(plugin, { surface: "mcp" })).toEqual([]);
  });

  it("rejects unsupported graph visualization metadata", () => {
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphVisualization: { graphDataVersion: "9.9", hostSurface: "editorPane" } },
      }),
    ).toThrow("graphDataVersion is unsupported");
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphVisualization: { graphDataVersion: "0.1", hostSurface: "floatingPortal" } },
      }),
    ).toThrow("hostSurface is unsupported");
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphVisualization: { graphDataVersion: "0.1", acceptedNodeKinds: ["person"] } },
      }),
    ).toThrow("acceptedNodeKinds contains unsupported value");
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphVisualization: { graphDataVersion: "0.1", renderMode: "immersive-vr" } },
      }),
    ).toThrow("renderMode is unsupported");
  });
});

function discovered(overrides: Partial<PluginManifest> = {}): DiscoveredPlugin {
  const manifest: PluginManifest = {
    id: "default-graph.plugin",
    name: "Default Graph",
    version: "0.1.0",
    exoApiVersion: "0.1",
    capabilities: [graphCapability],
    permissions: ["workspace:read", "notes:read"],
    surfaces: ["desktop"],
    ...overrides,
  };
  return {
    manifest,
    manifestPath: "/plugins/default-graph/exo.plugin.json",
    rootDirectory: "/plugins/default-graph",
    source: "dev",
    trust: "trusted",
    enabled: true,
    manifestHash: "hash-default-graph",
  };
}
