import { describe, expect, it } from "vitest";

import type { CapabilityMetadata } from "../capabilities";
import { graphVisualizationFromCapability, graphVisualizationsFromPlugin, type GraphSnapshot } from "../graph";
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
    graphDataVersion: "0.1",
    acceptedNodeKinds: ["note", "tag", "unresolved"],
    acceptedEdgeKinds: ["wikilink", "hasTag"],
    hostSurface: "editorPane",
  },
};

describe("graph contracts", () => {
  it("defines read-only graph snapshots with outgoing edges as canonical facts", () => {
    const snapshot: GraphSnapshot = {
      version: "0.1",
      generatedAt: "2026-06-26T00:00:00.000Z",
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
  });

  it("extracts graph visualization metadata from capabilities", () => {
    expect(graphVisualizationFromCapability(graphCapability)).toMatchObject({
      id: "default-graph.view",
      graphDataVersion: "0.1",
      acceptedNodeKinds: ["note", "tag", "unresolved"],
      acceptedEdgeKinds: ["wikilink", "hasTag"],
      hostSurface: "editorPane",
      sourceCapabilityId: "default-graph.view",
    });
  });

  it("defaults accepted graph data kinds when a visualization omits them", () => {
    expect(
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphDataVersion: "0.1", hostSurface: "webPreview" },
      }),
    ).toMatchObject({
      acceptedNodeKinds: ["note", "tag", "external", "unresolved"],
      acceptedEdgeKinds: ["wikilink", "markdownLink", "hasTag"],
      hostSurface: "webPreview",
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
        compatibility: { graphDataVersion: "9.9", hostSurface: "editorPane" },
      }),
    ).toThrow("graphDataVersion is unsupported");
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphDataVersion: "0.1", hostSurface: "floatingPortal" },
      }),
    ).toThrow("hostSurface is unsupported");
    expect(() =>
      graphVisualizationFromCapability({
        ...graphCapability,
        compatibility: { graphDataVersion: "0.1", acceptedNodeKinds: ["person"] },
      }),
    ).toThrow("acceptedNodeKinds contains unsupported value");
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
