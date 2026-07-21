import { describe, expect, it } from "vitest";

import type { RendererGraphNeighborhood } from "./graphAffordances";
import {
  compileGraphNeighborhoodPresentation,
  projectGraphNeighborhoodTopology,
} from "./graphNeighborhoodPresentation";
import type { GraphPresentationPalette } from "./graphPresentation";

const neighborhood: RendererGraphNeighborhood = {
  focusPath: "/notes/focus.md",
  nodes: [
    { id: "focus", label: "Focus", kind: "note", target: "/notes/focus.md" },
    { id: "source", label: "Source", kind: "note", target: "/notes/source.md" },
    { id: "external", label: "External", kind: "external", target: "https://example.com" },
  ],
  edges: [
    { id: "backlink", label: "Source", source: "source", target: "focus", kind: "wikilink" },
    { id: "outgoing", label: "External", source: "focus", target: "external", kind: "markdownLink" },
    { id: "missing", label: "Missing", source: "focus", target: "unresolved:missing", kind: "wikilink" },
  ],
};

describe("Connections graph presentation", () => {
  it("compiles the bounded canonical neighborhood into deterministic string-free topology", () => {
    const shuffled = { ...neighborhood, nodes: [neighborhood.nodes[2]!, neighborhood.nodes[1]!, neighborhood.nodes[0]!] };
    const first = projectGraphNeighborhoodTopology(shuffled);
    const second = projectGraphNeighborhoodTopology(neighborhood);

    expect(first.nodes.map((node) => node.id)).toEqual(["focus", "external", "source"]);
    expect(first.edges.map((edge) => edge.id)).toEqual(["backlink", "outgoing"]);
    expect(first.topology.topologyHash).toBe(second.topology.topologyHash);
    expect(first.topology.layoutEpochId).toBe(second.topology.layoutEpochId);
    expect([...first.topology.nodes.degrees]).toEqual([2, 1, 1]);
    expect([...first.topology.edges.endpoints]).toEqual([2, 0, 0, 1]);
    expect(first.topology.nodes.seeds).toBeInstanceOf(Uint32Array);
    expect(first.topology.edges.visualClasses).toBeInstanceOf(Uint8Array);
    expect(Object.values(first.topology.nodes).some((value) => typeof value === "string")).toBe(false);
  });

  it("uses the production scene, focal label, and presentation contracts", () => {
    const compiled = compileGraphNeighborhoodPresentation(
      neighborhood,
      { width: 240, height: 156 },
      palette(),
    );

    expect(compiled.scene.interaction.selected).toBe(0);
    expect([...compiled.scene.interaction.pathNodes]).toEqual([0, 0, 0]);
    expect([...compiled.scene.interaction.pathEdges]).toEqual([0, 0]);
    expect(compiled.plan.profile).toBe("focus");
    expect(compiled.plan.nodes.indices).toHaveLength(3);
    expect(compiled.plan.edges.indices).toHaveLength(2);
    expect(compiled.plan.labels.placements.some((label) => label.text === "Focus" && label.required)).toBe(true);
    expect(compiled.plan.topologyHash).toBe(compiled.scene.topology.topologyHash);
  });

  it("caps local work at eight nodes and induced edges", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
      kind: "note" as const,
      target: `/notes/${index}.md`,
    }));
    const edges = Array.from({ length: 11 }, (_, index) => ({
      id: `edge-${index}`,
      label: `Edge ${index}`,
      source: "node-0",
      target: `node-${index + 1}`,
      kind: "wikilink" as const,
    }));
    const projected = projectGraphNeighborhoodTopology({ focusPath: nodes[0].target, nodes, edges });

    expect(projected.nodes).toHaveLength(8);
    expect(projected.edges).toHaveLength(7);
    expect(projected.topology.nodes.seeds).toHaveLength(8);
    expect(projected.topology.edges.visualClasses).toHaveLength(7);
  });
});

function palette(): GraphPresentationPalette {
  return {
    clearColor: null,
    text: 0x202020ff,
    muted: 0x777777ff,
    accent: 0x4d8d84ff,
    path: 0xbe743cff,
    unresolved: 0xb14f4fff,
    external: 0x888888ff,
    nodeColors: new Uint32Array([0x4d8d84ff, 0xbe743cff, 0x888888ff]),
  };
}
